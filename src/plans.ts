import type { Request, Response } from "express";
import { runAgent, type AgentResult, type AgentTask } from "./agent.js";
import type { Deps } from "./app.js";
import { computeCost } from "./cost.js";
import type { Forecast } from "./data.js";
import { memberGroup } from "./groups.js";
import { ProblemError } from "./problem.js";
import { parseStops, type Stop } from "./schedule.js";
import { weekdayOf } from "./search.js";
import type { Group, Plan, Proposal, Store } from "./store.js";
import { scheduleTask, shortlistTask, type AgentRequest } from "./tasks.js";
import { createTools, type ToolContext } from "./tools.js";
import { validateSchedule, type Violation } from "./validator.js";

type UserOf = (req: Request) => string;

const bad = (detail: string) =>
  new ProblemError(400, "validation-error", "Request validation failed", detail);
const proposalNotFound = () =>
  new ProblemError(404, "proposal-not-found", "Proposal not found", "No such proposal.");
const planNotFound = (id: string) =>
  new ProblemError(404, "plan-not-found", "Plan not found", `No plan ${id}.`);

/** The context of one agent run, built from the session and the group: never from the model. */
export function buildToolContext(
  store: Store,
  deps: Deps,
  group: Group,
  userId: string,
  date: string,
): ToolContext {
  const users = group.memberIds.map((m) => store.users.get(m));
  return {
    userId,
    groupId: group.id,
    date,
    memberIds: [...group.memberIds],
    caps: { ...group.caps },
    interests: Object.fromEntries(group.memberIds.map((m, i) => [m, users[i]?.interests ?? []])),
    groupTotal: group.total,
    places: deps.dataset.places,
    weather: deps.weather,
    holidays: deps.holidays,
    // Names and emails must never reach a model, not even inside an interest someone typed.
    redactTerms: users.flatMap((u) => (u ? [u.name, u.email] : [])),
    seenPlaceIds: new Set(),
  };
}

async function runModel<T>(
  store: Store,
  deps: Deps,
  kind: "shortlist" | "schedule",
  ctx: ToolContext,
  task: AgentTask<T>,
): Promise<{ result: AgentResult<T>; runId: string }> {
  if (!deps.model) {
    throw new ProblemError(
      503,
      "model-unavailable",
      "Model unavailable",
      "No model is configured.",
    );
  }
  const model = deps.model();
  const startedAt = new Date().toISOString();
  const result = await runAgent({
    model,
    tools: createTools(ctx),
    task,
    limits: deps.limits,
    clock: deps.clock,
  });
  const runId = store.nextId("run");
  store.runs.push({
    id: runId,
    kind,
    groupId: ctx.groupId,
    userId: ctx.userId,
    model: model.name,
    startedAt,
    seconds: result.seconds,
    modelCalls: result.modelCalls,
    repairRounds: result.repairRounds,
    toolCalls: result.toolCalls.map((c) => ({
      seq: c.seq,
      name: c.name,
      args: c.args,
      ok: c.ok,
      ms: c.ms,
    })),
    warning: result.warning,
    usage: result.usage,
    messages: result.messages,
  });
  return { result, runId };
}

function parseRequest(body: unknown): AgentRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const date = b.date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw bad("'date' must be YYYY-MM-DD.");
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date)
    throw bad("'date' is not a real date.");
  weekdayOf(date);
  const prefs = b.preferences ?? [];
  if (
    !Array.isArray(prefs) ||
    prefs.length > 10 ||
    prefs.some((p) => typeof p !== "string" || p.length > 40)
  ) {
    throw bad("'preferences' must be a list of at most 10 short strings.");
  }
  return { date, preferences: prefs as string[] };
}

function proposalView(deps: Deps, p: Proposal) {
  const places = p.placeIds
    .map((id) => deps.dataset.places.find((x) => x.id === id))
    .filter((x) => x !== undefined)
    .map((x) => ({
      id: x.id,
      name: x.name,
      type: x.type,
      district: x.district,
      priceLevel: x.priceLevel,
      ticketPrice: x.ticketPrice,
      outdoor: x.outdoor,
    }));
  return {
    id: p.id,
    groupId: p.groupId,
    date: p.date,
    status: p.status,
    places,
    warning: p.warning,
    ...(p.planId ? { planId: p.planId } : {}),
  };
}

async function forecastOf(deps: Deps): Promise<Forecast | null> {
  try {
    return await deps.weather.getForecast();
  } catch {
    return null;
  }
}

/** The plan as the screen shows it. Spending is recomputed from the data every time. */
export async function planView(
  store: Store,
  deps: Deps,
  plan: Plan,
  agentViolations?: Violation[],
) {
  const stops = plan.stops ?? [];
  let spending: { perMember: Record<string, number>; total: number } | null = null;
  try {
    spending = computeCost(deps.dataset.places, stops, plan.memberIds);
  } catch {
    spending = null; // a schedule with an invented place or item has no price
  }
  let violations: Violation[] = [];
  if (plan.status === "draft") {
    violations =
      agentViolations ?? validateSchedule(stops, await validationContext(store, deps, plan));
  }
  return {
    id: plan.id,
    groupId: plan.groupId,
    ownerId: plan.ownerId,
    date: plan.date,
    status: plan.status,
    stops,
    spending,
    violations,
    warning: plan.warning ?? null,
    ...(plan.savedAt ? { savedAt: plan.savedAt } : {}),
  };
}

/** What the validator needs, with the caps and the total as they are now. */
export async function validationContext(store: Store, deps: Deps, plan: Plan) {
  const group = plan.groupId ? store.groups.get(plan.groupId) : undefined;
  return {
    places: deps.dataset.places,
    memberIds: group ? [...group.memberIds] : plan.memberIds,
    caps: group ? group.caps : {},
    groupTotal: group ? group.total : plan.groupTotal,
    date: plan.date as string,
    forecast: await forecastOf(deps),
  };
}

/** POST /groups/:id/proposals: the agent proposes 8 to 12 places. No schedule yet (H1). */
export function createProposalHandler(store: Store, deps: Deps, userOf: UserOf) {
  return async (req: Request, res: Response): Promise<void> => {
    const userId = userOf(req);
    const group = memberGroup(store, String(req.params.id), userId);
    const request = parseRequest(req.body);
    const ctx = buildToolContext(store, deps, group, userId, request.date);
    const { result, runId } = await runModel(
      store,
      deps,
      "shortlist",
      ctx,
      shortlistTask(ctx, request),
    );
    const proposal: Proposal = {
      id: store.nextId("pr"),
      groupId: group.id,
      creatorId: userId,
      date: request.date,
      preferences: request.preferences,
      placeIds: result.draft ?? [],
      status: "awaiting_place_confirmation",
      warning: result.warning,
      runId,
    };
    store.proposals.set(proposal.id, proposal);
    res.status(201).json(proposalView(deps, proposal));
  };
}

/** The proposal, only for the member who made it. Everyone else gets the same 404. */
function ownProposal(store: Store, id: string, userId: string): Proposal {
  const p = store.proposals.get(id);
  if (!p || p.creatorId !== userId) throw proposalNotFound();
  return p;
}

export function getProposalHandler(store: Store, deps: Deps, userOf: UserOf) {
  return (req: Request, res: Response): void => {
    const p = ownProposal(store, String(req.params.id), userOf(req));
    res.json(proposalView(deps, p));
  };
}

const stringList = (v: unknown, name: string): string[] => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
    throw bad(`'${name}' must be a list of place ids.`);
  return v as string[];
};

/** POST /proposals/:id/confirm: the first confirmation (pin and remove), then the schedule. */
export function confirmProposalHandler(store: Store, deps: Deps, userOf: UserOf) {
  return async (req: Request, res: Response): Promise<void> => {
    const userId = userOf(req);
    const proposal = ownProposal(store, String(req.params.id), userId);
    if (proposal.status === "confirmed") {
      throw new ProblemError(
        409,
        "proposal-already-confirmed",
        "Proposal already confirmed",
        "The places of this proposal were already confirmed.",
      );
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const pinned = stringList(body.pinned, "pinned");
    const removed = stringList(body.removed, "removed");
    const known = new Set(proposal.placeIds);
    if ([...pinned, ...removed].some((id) => !known.has(id)))
      throw bad("Every id must be a place of this proposal.");
    if (pinned.some((id) => removed.includes(id)))
      throw bad("A place cannot be both pinned and removed.");
    if (proposal.placeIds.every((id) => removed.includes(id)))
      throw bad("At least one place must stay.");

    const group = memberGroup(store, proposal.groupId, userId);
    const request: AgentRequest = { date: proposal.date, preferences: proposal.preferences };
    const ctx = buildToolContext(store, deps, group, userId, proposal.date);
    const confirmed = { shortlist: proposal.placeIds, pinned, removed };
    const task = scheduleTask(ctx, request, confirmed, await forecastOf(deps));
    const { result } = await runModel(store, deps, "schedule", ctx, task);
    if (result.draft === null) {
      throw new ProblemError(
        502,
        "agent-failed",
        "The agent could not build a schedule",
        "No usable schedule was produced. Try again.",
        { warning: result.warning },
      );
    }

    const plan: Plan = {
      id: store.nextId("p"),
      ownerId: userId,
      memberIds: [...group.memberIds],
      status: "draft",
      totalCost: 0,
      groupTotal: group.total,
      groupId: group.id,
      date: proposal.date,
      stops: result.draft,
      warning: result.warning,
      proposalId: proposal.id,
    };
    store.addPlan(plan);
    proposal.status = "confirmed";
    proposal.planId = plan.id;
    res.status(201).json(await planView(store, deps, plan, result.violations));
  };
}

/** A draft is visible to its owner only; a saved plan to every member of its group. Otherwise 404. */
export function visiblePlan(store: Store, id: string, userId: string): Plan {
  const plan = store.plans.get(id);
  const visible =
    plan !== undefined &&
    (plan.status === "saved" ? plan.memberIds.includes(userId) : plan.ownerId === userId);
  if (!plan || !visible) throw planNotFound(id);
  return plan;
}

export function getPlanHandler(store: Store, deps: Deps, userOf: UserOf) {
  return async (req: Request, res: Response): Promise<void> => {
    const plan = visiblePlan(store, String(req.params.id), userOf(req));
    res.json(await planView(store, deps, plan));
  };
}

/** PUT /plans/:id/stops: the owner changes the draft. The answer carries a preview of the violations. */
export function putStopsHandler(store: Store, deps: Deps, userOf: UserOf) {
  return async (req: Request, res: Response): Promise<void> => {
    const plan = visiblePlan(store, String(req.params.id), userOf(req));
    if (plan.status === "saved") {
      throw new ProblemError(
        409,
        "plan-already-saved",
        "Plan already saved",
        "A saved plan cannot be edited.",
      );
    }
    const parsed = parseStops((req.body as Record<string, unknown> | undefined)?.stops);
    if (!parsed.ok) throw bad(`invalid_schedule: ${parsed.error}`);
    plan.stops = parsed.stops satisfies Stop[];
    res.json(await planView(store, deps, plan));
  };
}

/** GET /groups/:id/plans: the saved plans of the group. Drafts appear nowhere here. */
export function groupPlansHandler(store: Store, deps: Deps, userOf: UserOf) {
  return async (req: Request, res: Response): Promise<void> => {
    const group = memberGroup(store, String(req.params.id), userOf(req));
    const saved = [...store.plans.values()].filter(
      (p) => p.groupId === group.id && p.status === "saved",
    );
    res.json({ plans: await Promise.all(saved.map((p) => planView(store, deps, p))) });
  };
}
