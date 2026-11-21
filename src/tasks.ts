import { z } from "zod";
import type { AgentTask } from "./agent.js";
import type { Forecast } from "./data.js";
import { sanitizeInterest } from "./privacy.js";
import type { Stop } from "./schedule.js";
import { weekdayOf } from "./search.js";
import { memberIdOfRef, type ToolContext } from "./tools.js";
import { validateSchedule, type Violation } from "./validator.js";

export interface AgentRequest {
  date: string; // "YYYY-MM-DD"
  preferences: string[];
}
export interface Confirmed {
  shortlist: string[];
  pinned: string[];
  removed: string[];
}

const PROTOCOL = `You are the planning agent of a travel planner for a group in Ho Chi Minh City.
Reply with exactly ONE JSON object per turn, and nothing else:
  {"action":"tool","name":"<tool>","args":{...}}   to call a tool
  {"action":"final","output":{...}}                 to give your answer

Tools (arguments are strict: extra keys are refused; you never pass a user or a group, the system knows them):
  search_places {type?, district?, day?, time?, priceLevel?}  candidate places only; day is mon..sun and goes with time HH:MM
  get_place {placeId}                                         details, opening hours and menu with item ids
  get_profile {}                                              the members as m1, m2, ..., with interests and spending caps
  get_weather {date}                                          hourly rain chance; outdoor stops must avoid hours above 60%
  get_holidays {from, to}                                     public holidays
  get_travel_time {fromPlaceId, toPlaceId}                    motorbike minutes; leave at least that gap between stops
  compute_cost {stops:[{placeId, items:[{itemId, memberRef, qty}]}]}  the ONLY source of money

Rules: you see data only through the tools. You never work out a price or a total yourself and you never put
a cost in your answer: ask compute_cost. Every member must stay within the lowest cap in the group, and the group
within its total. You have at most 12 tool calls, 2 repair rounds and 90 seconds.`;

const clean = (ctx: ToolContext, list: string[]) =>
  list.slice(0, 10).map((p) => sanitizeInterest(p, ctx.redactTerms));

const shortlistSchema = z
  .object({ placeIds: z.array(z.string().min(1).max(64)).min(8).max(12) })
  .strict()
  .refine((o) => new Set(o.placeIds).size === o.placeIds.length, {
    message: "placeIds must be distinct",
  });

/** Step 1: propose 8 to 12 candidate places. Nothing is scheduled before the user confirms them (H1). */
export function shortlistTask(ctx: ToolContext, req: AgentRequest): AgentTask<string[]> {
  return {
    system:
      `${PROTOCOL}\n\nYour job now: propose 8 to 12 places for the day, chosen from places that the tools returned.\n` +
      `Final answer: {"placeIds":["<place id>", ...]} with 8 to 12 distinct ids. Do not build a schedule yet.`,
    user:
      `Date: ${req.date} (${weekdayOf(req.date)}).\n` +
      `Preferences for this trip: ${clean(ctx, req.preferences).join("; ") || "none"}.\n` +
      `Use get_profile for the members' interests and caps, then search_places and get_place.`,
    parse: (o) => {
      const r = shortlistSchema.safeParse(o);
      return r.success
        ? { ok: true, value: r.data.placeIds }
        : { ok: false, error: describe(r.error) };
    },
    check: (ids) =>
      ids
        .filter((id) => !ctx.seenPlaceIds.has(id))
        .map((id) => ({
          rule: "V1" as const,
          code: "unknown_place",
          message: `Place ${id} was not returned by any tool in this run.`,
        })),
    fallback: () => (ctx.seenPlaceIds.size >= 8 ? [...ctx.seenPlaceIds].sort().slice(0, 8) : null),
  };
}

const modelStopsSchema = z
  .object({
    stops: z
      .array(
        z
          .object({
            placeId: z.string().min(1).max(64),
            start: z.string().max(5),
            end: z.string().max(5),
            items: z
              .array(
                z
                  .object({
                    itemId: z.string().min(1).max(64),
                    memberRef: z.string().max(8),
                    qty: z.number().int().min(1).max(20),
                  })
                  .strict(),
              )
              .max(30),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

const describe = (e: z.ZodError) =>
  e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

/** Step 2: the schedule, from the places the user confirmed. The validator and the pin/remove rules decide. */
export function scheduleTask(
  ctx: ToolContext,
  req: AgentRequest,
  confirmed: Confirmed,
  forecast: Forecast | null,
): AgentTask<Stop[]> {
  const kept = confirmed.shortlist.filter((id) => !confirmed.removed.includes(id));
  return {
    system:
      `${PROTOCOL}\n\nYour job now: build the day's schedule from the confirmed places.\n` +
      `Final answer: {"stops":[{"placeId":"..","start":"HH:MM","end":"HH:MM","items":[{"itemId":"..","memberRef":"m1","qty":1}]}]}\n` +
      `Use only the confirmed places. Pinned places must be in the schedule. Give each member items they can afford.`,
    user:
      `Date: ${req.date} (${weekdayOf(req.date)}).\n` +
      `Preferences for this trip: ${clean(ctx, req.preferences).join("; ") || "none"}.\n` +
      `Confirmed places (use only these): ${kept.join(", ")}.\n` +
      `Pinned (must be in the schedule): ${confirmed.pinned.join(", ") || "none"}.`,
    parse: (o) => {
      const r = modelStopsSchema.safeParse(o);
      if (!r.success) return { ok: false, error: describe(r.error) };
      const stops: Stop[] = r.data.stops.map((s) => ({
        ...s,
        items: s.items.map((it) => ({
          itemId: it.itemId,
          // an unknown ref stays as typed, so the validator reports unknown_member
          memberId: memberIdOfRef(ctx, it.memberRef) ?? it.memberRef,
          qty: it.qty,
        })),
      }));
      return { ok: true, value: stops };
    },
    check: (stops) => {
      const out: Violation[] = [];
      const used = new Set(stops.map((s) => s.placeId));
      for (const id of used) {
        if (confirmed.removed.includes(id)) {
          out.push({ code: "removed_present", message: `Place ${id} was removed by the user.` });
        } else if (!kept.includes(id)) {
          out.push({
            code: "unconfirmed_place",
            message: `Place ${id} was not confirmed by the user.`,
          });
        }
      }
      for (const id of confirmed.pinned) {
        if (!used.has(id)) {
          out.push({
            code: "pinned_missing",
            message: `Pinned place ${id} is not in the schedule.`,
          });
        }
      }
      return [
        ...out,
        ...validateSchedule(stops, {
          places: ctx.places,
          memberIds: ctx.memberIds,
          caps: ctx.caps,
          groupTotal: ctx.groupTotal,
          date: req.date,
          forecast,
        }),
      ];
    },
  };
}
