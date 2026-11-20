import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { ProblemError } from "./problem.js";
import type { Group, Store } from "./store.js";

const bad = (detail: string) =>
  new ProblemError(400, "validation-error", "Request validation failed", detail);
const notFound = () =>
  new ProblemError(404, "group-not-found", "Group not found", "No such group.");

const isMoney = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function view(store: Store, g: Group, userId: string) {
  void store;
  return {
    id: g.id,
    name: g.name,
    total: g.total,
    ownerId: g.ownerId,
    memberIds: g.memberIds,
    members: g.memberIds.map((m) => ({ userId: m, cap: g.caps[m] ?? null })),
    // Only the owner gets the invite link.
    ...(g.ownerId === userId ? { inviteToken: g.inviteToken } : {}),
  };
}

/** The group, only for a member: a stranger and an unknown id get the same 404. */
export function memberGroup(store: Store, groupId: string, userId: string): Group {
  const g = store.groups.get(groupId);
  if (!g || !g.memberIds.includes(userId)) throw notFound();
  return g;
}

export function createGroupHandler(store: Store, userOf: (req: Request) => string) {
  return (req: Request, res: Response): void => {
    const userId = userOf(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.name !== "string" || b.name.trim() === "" || b.name.length > 80) {
      throw bad("'name' must be a string of 1 to 80 characters.");
    }
    if (!isMoney(b.total)) throw bad("'total' must be an integer >= 0.");
    const g: Group = {
      id: store.nextId("g"),
      name: b.name.trim(),
      ownerId: userId,
      memberIds: [userId],
      total: b.total,
      caps: {},
      inviteToken: randomBytes(12).toString("hex"),
    };
    store.groups.set(g.id, g);
    res.status(201).json(view(store, g, userId));
  };
}

export function joinGroupHandler(store: Store, userOf: (req: Request) => string) {
  return (req: Request, res: Response): void => {
    const userId = userOf(req);
    const token = (req.body as Record<string, unknown> | undefined)?.token;
    if (typeof token !== "string") throw bad("'token' is required.");
    const g = [...store.groups.values()].find((x) => x.inviteToken === token);
    if (!g)
      throw new ProblemError(
        404,
        "invite-not-found",
        "Invite not found",
        "This invite link is not valid.",
      );
    if (!g.memberIds.includes(userId)) g.memberIds.push(userId);
    res.status(200).json(view(store, g, userId));
  };
}

export function getGroupHandler(store: Store, userOf: (req: Request) => string) {
  return (req: Request, res: Response): void => {
    const userId = userOf(req);
    res.json(view(store, memberGroup(store, String(req.params.id), userId), userId));
  };
}

export function setTotalHandler(store: Store, userOf: (req: Request) => string) {
  return (req: Request, res: Response): void => {
    const userId = userOf(req);
    const g = memberGroup(store, String(req.params.id), userId);
    if (g.ownerId !== userId) {
      throw new ProblemError(
        403,
        "not-group-owner",
        "Only the group owner can do this",
        "Only the owner can change the group total.",
      );
    }
    const total = (req.body as Record<string, unknown> | undefined)?.total;
    if (!isMoney(total)) throw bad("'total' must be an integer >= 0.");
    g.total = total;
    res.json(view(store, g, userId));
  };
}

/** PUT /groups/:id/members/:userId/cap. A cap is written by its own member only (P1). */
export function setCapHandler(store: Store, userOf: (req: Request) => string) {
  return (req: Request, res: Response): void => {
    const userId = userOf(req);
    const g = memberGroup(store, String(req.params.id), userId);
    const target = String(req.params.userId);
    if (target !== userId) {
      throw new ProblemError(
        403,
        "cap-not-yours",
        "You can only change your own cap",
        "A spending cap is set by its own member only.",
      );
    }
    const cap = (req.body as Record<string, unknown> | undefined)?.cap;
    if (cap !== null && !isMoney(cap))
      throw bad("'cap' must be an integer >= 0, or null for no cap.");
    g.caps[userId] = cap;
    res.json({ userId, cap });
  };
}

/** GET /groups: the groups the caller belongs to (no invite token here). */
export function listGroupsHandler(store: Store, userOf: (req: Request) => string) {
  return (req: Request, res: Response): void => {
    const userId = userOf(req);
    const groups = [...store.groups.values()]
      .filter((g) => g.memberIds.includes(userId))
      .map((g) => ({ id: g.id, name: g.name, total: g.total, ownerId: g.ownerId }));
    res.json({ groups });
  };
}
