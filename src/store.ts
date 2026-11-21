import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Warning } from "./agent.js";
import type { Stop } from "./schedule.js";

export interface User {
  id: string;
  /** Name and email stay here. They are never sent to a model (CLAUDE.md, R5). */
  name: string;
  email: string;
  passwordHash: string;
  interests: string[];
}

export interface Group {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  total: number;
  /** A cap is written only by its own member (P1). null or missing means no cap. */
  caps: Record<string, number | null>;
  inviteToken: string;
}

export interface Proposal {
  id: string;
  groupId: string;
  creatorId: string;
  date: string;
  preferences: string[];
  placeIds: string[];
  status: "awaiting_place_confirmation" | "confirmed";
  planId?: string;
  warning: Warning | null;
  runId: string;
}

export interface Plan {
  id: string;
  ownerId: string;
  memberIds: string[];
  status: "draft" | "saved";
  /** Legacy PA#2 field, used only by a plan with no `stops`. Real plans recompute the cost from the data. */
  totalCost: number;
  groupTotal: number;
  savedAt?: string;
  groupId?: string;
  date?: string;
  stops?: Stop[];
  warning?: Warning | null;
  proposalId?: string;
}

export interface IdempotencyRecord {
  bodyHash: string;
  responseBody: unknown;
}

/** One agent run, for the run log (prompts hold places and interests only). */
export interface RunRecord {
  id: string;
  kind: "shortlist" | "schedule";
  groupId: string;
  userId: string;
  model: string;
  startedAt: string;
  seconds: number;
  modelCalls: number;
  repairRounds: number;
  toolCalls: { seq: number; name: string; args: unknown; ok: boolean; ms: number }[];
  warning: Warning | null;
  usage: { inputTokens: number; outputTokens: number };
  messages: { role: string; content: string }[];
}

const SESSION_MS = 12 * 60 * 60 * 1000;

// Tests set NODE_ENV=test and use a cheap cost; the stored string carries its own cost, so a hash made
// with one cost is always checked with that same cost.
const COST = process.env.NODE_ENV === "test" ? 1024 : 16384;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: COST }).toString("hex");
  return `${COST}:${salt.toString("hex")}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [cost, salt, hash] = stored.split(":");
  if (!cost || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, Buffer.from(salt, "hex"), 32, { N: Number(cost) });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** In-memory stand-in for the database. Replace with the real data layer later. */
export class Store {
  readonly users = new Map<string, User>();
  readonly sessions = new Map<string, { userId: string; expiresAt: number }>();
  readonly groups = new Map<string, Group>();
  readonly proposals = new Map<string, Proposal>();
  readonly plans = new Map<string, Plan>();
  readonly idempotency = new Map<string, IdempotencyRecord>();
  readonly runs: RunRecord[] = [];
  private counter = 0;

  nextId(prefix: string): string {
    return `${prefix}_${++this.counter}_${randomBytes(4).toString("hex")}`;
  }

  addPlan(plan: Plan): void {
    this.plans.set(plan.id, plan);
  }

  addUser(u: {
    id: string;
    name: string;
    email: string;
    password: string;
    interests: string[];
  }): void {
    this.users.set(u.id, {
      id: u.id,
      name: u.name,
      email: u.email,
      passwordHash: hashPassword(u.password),
      interests: u.interests,
    });
  }

  createSession(userId: string): string {
    const token = randomBytes(24).toString("base64url");
    this.sessions.set(token, { userId, expiresAt: Date.now() + SESSION_MS });
    return token;
  }

  userOfToken(token: string): string | undefined {
    const s = this.sessions.get(token);
    if (!s) return undefined;
    if (s.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return undefined;
    }
    return s.userId;
  }
}
