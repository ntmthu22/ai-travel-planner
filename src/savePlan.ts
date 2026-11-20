import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import type { Deps } from "./app.js";
import { validationContext } from "./plans.js";
import { ProblemError } from "./problem.js";
import type { Plan, Store } from "./store.js";
import { validatePlan, validateSchedule, type Violation } from "./validator.js";

interface SaveBody {
  confirmed: true;
  note?: string;
}

function parseBody(raw: unknown): SaveBody {
  const fail = (detail: string) =>
    new ProblemError(400, "validation-error", "Request validation failed", detail);
  if (typeof raw !== "object" || raw === null) throw fail("Body must be a JSON object.");
  const b = raw as Record<string, unknown>;
  if (b.confirmed !== true) throw fail("Field 'confirmed' must be the boolean true.");
  if (b.note !== undefined && (typeof b.note !== "string" || b.note.length > 200)) {
    throw fail("Field 'note' must be a string of at most 200 characters.");
  }
  return { confirmed: true, note: b.note as string | undefined };
}

/**
 * The validator, in the backend, on the stops as they are now (H3). A plan with a schedule is checked
 * with V1-V5 against the data, the caps and total of the group at this moment, and the weather now.
 * A plan without stops is a PA#2 fixture: only the old total check applies.
 */
async function violationsOf(store: Store, deps: Deps, plan: Plan): Promise<Violation[]> {
  if (!plan.stops) return validatePlan(plan);
  return validateSchedule(plan.stops, await validationContext(store, deps, plan));
}

/** POST /plans/:planId/save. See docs/contract/save-plan.md. */
export function savePlanHandler(store: Store, deps: Deps, userOf: (req: Request) => string) {
  return async (req: Request, res: Response): Promise<void> => {
    // 1. Authentication (bearer token, or the development X-User-Id stub)
    const userId = userOf(req);

    // 2. Plan existence and membership. Non-members get 404 so a plan's existence is not leaked.
    const planId = String(req.params.planId);
    const plan = store.plans.get(planId);
    if (!plan || !plan.memberIds.includes(userId)) {
      throw new ProblemError(404, "plan-not-found", "Plan not found", `No plan ${planId}.`);
    }

    // 3. Ownership: only the creator may save.
    if (plan.ownerId !== userId) {
      throw new ProblemError(
        403,
        "not-plan-owner",
        "Only the plan owner can save",
        "Only the member who created this plan can save it.",
      );
    }

    // 4. Request validation
    const key = req.header("Idempotency-Key");
    if (!key || key.length > 128) {
      throw new ProblemError(
        400,
        "validation-error",
        "Request validation failed",
        "Header 'Idempotency-Key' is required (max 128 characters).",
      );
    }
    const body = parseBody(req.body);

    // 5. Idempotency replay
    const bodyHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const recordKey = `${userId}:${planId}:${key}`;
    const prior = store.idempotency.get(recordKey);
    if (prior) {
      if (prior.bodyHash !== bodyHash) {
        throw new ProblemError(
          422,
          "idempotency-key-reuse",
          "Idempotency-Key reused with a different body",
          "This Idempotency-Key was already used with a different request body.",
        );
      }
      res.set("Idempotent-Replayed", "true").status(200).json(prior.responseBody);
      return;
    }

    // 6. Already saved (with another key): repeating Save is safe and returns the same result.
    // 7. Otherwise the validator must pass before anything is shared.
    // A function, not a comparison: TypeScript would otherwise narrow the status and hide the race.
    const isSaved = () => plan.status === "saved";
    if (!isSaved()) {
      const violations = await violationsOf(store, deps, plan);
      // Another Save may have finished while the forecast was being read: look again, then decide.
      if (!isSaved()) {
        if (violations.length > 0) {
          throw new ProblemError(
            422,
            "plan-violates-constraints",
            "Plan violates constraints",
            "The validator rejected this plan; it was not saved or shared.",
            { violations },
          );
        }
        const group = plan.groupId ? store.groups.get(plan.groupId) : undefined;
        if (group) plan.memberIds = [...group.memberIds]; // share with everyone in the group now
        plan.status = "saved";
        plan.savedAt = new Date().toISOString();
      }
    }

    const responseBody = {
      id: plan.id,
      status: plan.status,
      savedAt: plan.savedAt,
      sharedWith: plan.memberIds,
    };
    store.idempotency.set(recordKey, { bodyHash, responseBody });
    res.status(200).json(responseBody);
  };
}
