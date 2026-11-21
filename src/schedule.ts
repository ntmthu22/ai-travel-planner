import { z } from "zod";
import { toMin } from "./search.js";

export interface StopItem {
  itemId: string;
  memberId: string;
  qty: number;
}
export interface Stop {
  placeId: string;
  start: string;
  end: string;
  items: StopItem[];
}

// One check that cannot throw: zod 4 still runs later checks after a failed regex.
const time = z.string().refine((t) => /^\d{1,2}:[0-5]\d$/.test(t) && toMin(t) < 24 * 60, {
  message: "time must be HH:MM",
});

/** Strict on purpose: any other key (totalCost, price, userId...) is refused, never ignored. */
const stopSchema = z
  .object({
    placeId: z.string().min(1).max(64),
    start: time,
    end: time,
    items: z
      .array(
        z
          .object({
            itemId: z.string().min(1).max(64),
            memberId: z.string().min(1).max(64),
            qty: z.number().int().min(1).max(20),
          })
          .strict(),
      )
      .max(30),
  })
  .strict()
  .refine(
    (s) => {
      try {
        return toMin(s.end) > toMin(s.start);
      } catch {
        return true; // a malformed time is already reported by the field check
      }
    },
    { message: "end must be after start" },
  );

export const stopsSchema = z.array(stopSchema).min(1).max(20);

export type ParsedStops = { ok: true; stops: Stop[] } | { ok: false; error: string };

export function parseStops(raw: unknown): ParsedStops {
  const r = stopsSchema.safeParse(raw);
  if (r.success) return { ok: true, stops: r.data };
  return {
    ok: false,
    error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
  };
}
