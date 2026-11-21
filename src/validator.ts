import { computeCost } from "./cost.js";
import type { Forecast, Place } from "./data.js";
import type { Stop } from "./schedule.js";
import { isOpenDuring, toMin, weekdayOf } from "./search.js";
import { travelMinutes } from "./travel.js";

export type Rule = "V1" | "V2" | "V3" | "V4" | "V5";

export interface Violation {
  code: string;
  rule?: Rule;
  message: string;
  stopIndex?: number;
}

export interface ValidationContext {
  places: Place[];
  memberIds: string[];
  /** Cap of each member; null or missing means no cap. */
  caps: Record<string, number | null | undefined>;
  groupTotal: number;
  date: string; // "YYYY-MM-DD"
  /** The 7-day forecast, or null when unknown. Outside it, V5 cannot say anything. */
  forecast: Forecast | null;
}

export const RAIN_LIMIT = 60;

/**
 * The five checks of the brief, run in the backend at Save and on every changed schedule.
 * Money is recomputed here from the data; nothing the client or the model wrote is read.
 * Returns every violation found; an empty list means the schedule may be saved.
 */
export function validateSchedule(stops: Stop[], ctx: ValidationContext): Violation[] {
  const byId = new Map(ctx.places.map((p) => [p.id, p]));
  const members = new Set(ctx.memberIds);

  // V1: everything exists. Later checks need real places, so we stop here when something is invented.
  const v1: Violation[] = [];
  stops.forEach((s, i) => {
    const place = byId.get(s.placeId);
    if (!place) {
      v1.push({
        rule: "V1",
        code: "unknown_place",
        message: `Stop ${i + 1}: place ${s.placeId} does not exist.`,
        stopIndex: i,
      });
      return;
    }
    for (const it of s.items) {
      if (!place.menu?.some((m) => m.id === it.itemId)) {
        v1.push({
          rule: "V1",
          code: "unknown_item",
          message: `Stop ${i + 1}: item ${it.itemId} is not on the menu of ${place.name}.`,
          stopIndex: i,
        });
      }
      if (!members.has(it.memberId)) {
        v1.push({
          rule: "V1",
          code: "unknown_member",
          message: `Stop ${i + 1}: ${it.memberId} is not a member of the group.`,
          stopIndex: i,
        });
      }
    }
  });
  if (v1.length > 0) return v1;

  const out: Violation[] = [];
  const day = weekdayOf(ctx.date);
  const ordered = stops
    .map((s, i) => ({ s, i, place: byId.get(s.placeId) as Place }))
    .sort((a, b) => toMin(a.s.start) - toMin(b.s.start));

  // V2: inside one opening period of that weekday.
  for (const { s, i, place } of ordered) {
    if (!isOpenDuring(place, day, s.start, s.end)) {
      out.push({
        rule: "V2",
        code: "outside_opening_hours",
        message: `Stop ${i + 1}: ${place.name} is not open on ${day} from ${s.start} to ${s.end}.`,
        stopIndex: i,
      });
    }
  }

  // V3: the gap between neighbours fits the motorbike time (a negative gap is an overlap).
  for (let k = 1; k < ordered.length; k++) {
    const prev = ordered[k - 1] as (typeof ordered)[number];
    const next = ordered[k] as (typeof ordered)[number];
    const gap = toMin(next.s.start) - toMin(prev.s.end);
    const need = travelMinutes(prev.place, next.place);
    if (gap < need) {
      out.push({
        rule: "V3",
        code: "travel_time_too_short",
        message: `${prev.place.name} to ${next.place.name} needs ${need} min by motorbike, the gap is ${gap} min.`,
        stopIndex: next.i,
      });
    }
  }

  // V4: each member within the lowest cap in the group, the group within its total.
  const cost = computeCost(ctx.places, stops, ctx.memberIds);
  const caps = ctx.memberIds
    .map((m) => ctx.caps[m])
    .filter((c): c is number => typeof c === "number");
  if (caps.length > 0) {
    const lowest = Math.min(...caps);
    for (const m of ctx.memberIds) {
      const spent = cost.perMember[m] ?? 0;
      if (spent > lowest) {
        out.push({
          rule: "V4",
          code: "over_member_cap",
          message: `${m} would spend ${spent}, above the lowest cap in the group (${lowest}).`,
        });
      }
    }
  }
  if (cost.total > ctx.groupTotal) {
    out.push({
      rule: "V4",
      code: "over_group_total",
      message: `Total cost ${cost.total} exceeds the group total ${ctx.groupTotal}.`,
    });
  }

  // V5: no outdoor stop in an hour above 60% rain chance, only where the forecast covers the date.
  if (ctx.forecast) {
    const hours = new Map(ctx.forecast.hourly.map((h) => [h.time, h.precipProb]));
    for (const { s, i, place } of ordered) {
      if (!place.outdoor) continue;
      const first = Math.floor(toMin(s.start) / 60);
      const last = Math.ceil(toMin(s.end) / 60) - 1;
      for (let h = first; h <= last; h++) {
        const key = `${ctx.date}T${String(h).padStart(2, "0")}:00`;
        const prob = hours.get(key);
        if (prob !== undefined && prob > RAIN_LIMIT) {
          out.push({
            rule: "V5",
            code: "rain_risk",
            message: `${place.name} is outdoors and ${prob}% rain is forecast at ${String(h).padStart(2, "0")}:00.`,
            stopIndex: i,
          });
          break;
        }
      }
    }
  }
  return out;
}

/** Legacy PA#2 check, still used by Save until it runs validateSchedule (next part). */
export function validatePlan(plan: { totalCost: number; groupTotal: number }): Violation[] {
  if (plan.totalCost > plan.groupTotal) {
    return [
      {
        code: "over_group_total",
        message: `Total cost ${plan.totalCost} exceeds the group total ${plan.groupTotal}.`,
      },
    ];
  }
  return [];
}
