import type { Request, Response } from "express";
import { ProblemError } from "./problem.js";
import type { Store } from "./store.js";

type UserOf = (req: Request) => string;

const bad = (detail: string) =>
  new ProblemError(400, "validation-error", "Request validation failed", detail);

/** GET /me: id and interests only. The name and the email are never part of an API answer here. */
export function getMeHandler(store: Store, userOf: UserOf) {
  return (req: Request, res: Response): void => {
    const id = userOf(req);
    res.json({ id, interests: store.users.get(id)?.interests ?? [] });
  };
}

/** PUT /me/interests: the caller's own interests, at most 10 of 1 to 40 characters. */
export function putInterestsHandler(store: Store, userOf: UserOf) {
  return (req: Request, res: Response): void => {
    const id = userOf(req);
    const raw = (req.body as Record<string, unknown> | undefined)?.interests;
    if (!Array.isArray(raw) || raw.length > 10 || raw.some((i) => typeof i !== "string")) {
      throw bad("'interests' must be a list of at most 10 strings.");
    }
    const cleaned = [...new Set((raw as string[]).map((i) => i.trim()))];
    if (cleaned.some((i) => i.length < 1 || i.length > 40)) {
      throw bad("Each interest must have 1 to 40 characters.");
    }
    const user = store.users.get(id);
    if (!user) throw new ProblemError(404, "user-not-found", "User not found", "No such account.");
    user.interests = cleaned;
    res.json({ id, interests: cleaned });
  };
}
