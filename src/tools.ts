import { z } from "zod";
import { computeCost } from "./cost.js";
import type { Forecast, Holiday, Place } from "./data.js";
import { sanitizeInterest } from "./privacy.js";
import { isCandidate, isWeekday, searchPlaces } from "./search.js";
import { travelMinutes } from "./travel.js";

export interface WeatherSource {
  /** The 7-day hourly forecast, or null when it cannot be read. */
  getForecast(): Promise<Forecast | null>;
}

/**
 * Everything a tool knows about the caller. It is built by the backend from the session; the model
 * never supplies a user or a group (R1).
 */
export interface ToolContext {
  userId: string;
  groupId: string;
  date: string;
  memberIds: string[];
  caps: Record<string, number | null | undefined>;
  interests: Record<string, string[]>;
  groupTotal: number;
  places: Place[];
  weather: WeatherSource;
  holidays: Holiday[];
  /** Names, emails and ids that must never reach a model, even inside an interest. */
  redactTerms: string[];
  /** Candidate places the model has seen through search_places or get_place in this run. */
  seenPlaceIds: Set<string>;
}

export const TOOL_NAMES = [
  "search_places",
  "get_place",
  "get_profile",
  "get_weather",
  "get_holidays",
  "get_travel_time",
  "compute_cost",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface Tool {
  description: string;
  schema: z.ZodType;
  run(args: unknown): Promise<unknown> | unknown;
}

/** Ties `run` to the type of its own schema, so no tool needs `any`. */
function defineTool<S extends z.ZodType>(t: {
  description: string;
  schema: S;
  run: (args: z.infer<S>) => Promise<unknown> | unknown;
}): Tool {
  return { description: t.description, schema: t.schema, run: (a) => t.run(a as z.infer<S>) };
}
export type ToolSet = Record<ToolName, Tool>;
export type ToolResult = { ok: true; result: unknown } | { ok: false; error: string };

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().min(1).max(64);

export const memberRef = (ctx: ToolContext, memberId: string): string =>
  `m${ctx.memberIds.indexOf(memberId) + 1}`;
export const memberIdOfRef = (ctx: ToolContext, ref: string): string | undefined => {
  const m = /^m(\d+)$/.exec(ref);
  return m ? ctx.memberIds[Number(m[1]) - 1] : undefined;
};

const summary = (p: Place) => ({
  id: p.id,
  name: p.name,
  type: p.type,
  district: p.district,
  priceLevel: p.priceLevel,
  ticketPrice: p.ticketPrice,
  outdoor: p.outdoor,
});

/** Every schema is strict: a `userId`, `groupId`, `total` or any other key is an error, never ignored. */
export function createTools(ctx: ToolContext): ToolSet {
  const candidate = (placeId: string): Place | undefined =>
    ctx.places.find((p) => p.id === placeId && isCandidate(p));
  const place = (placeId: string): Place | undefined => ctx.places.find((p) => p.id === placeId);

  return {
    search_places: defineTool({
      description: "Search candidate places by type, district, open day and time, price level.",
      schema: z
        .object({
          type: z.string().max(40).optional(),
          district: z.string().max(40).optional(),
          day: z.string().refine(isWeekday).optional(),
          time: z
            .string()
            .regex(/^\d{1,2}:[0-5]\d$/)
            .optional(),
          priceLevel: z.number().int().min(1).max(4).optional(),
        })
        .strict()
        .refine((a) => (a.day === undefined) === (a.time === undefined), {
          message: "day and time go together",
        }),
      run: (a) => {
        const found = searchPlaces(ctx.places, {
          candidatesOnly: true,
          type: a.type,
          district: a.district,
          priceLevel: a.priceLevel,
          openDay: a.day,
          openTime: a.time,
        }).slice(0, 40);
        found.forEach((p) => ctx.seenPlaceIds.add(p.id));
        return { places: found.map(summary) };
      },
    }),

    get_place: defineTool({
      description: "Details and menu of one candidate place.",
      schema: z.object({ placeId: id }).strict(),
      run: (a) => {
        const p = candidate(a.placeId);
        if (!p) throw new Error(`No candidate place ${a.placeId}`);
        ctx.seenPlaceIds.add(p.id);
        return { ...summary(p), hours: p.hours, menu: p.menu, description: p.description };
      },
    }),

    get_profile: defineTool({
      description: "Interests and spending cap of each member of the group, as m1, m2, ...",
      schema: z.object({}).strict(),
      run: () => ({
        groupTotal: ctx.groupTotal,
        members: ctx.memberIds.map((m) => ({
          ref: memberRef(ctx, m),
          interests: (ctx.interests[m] ?? []).map((i) => sanitizeInterest(i, ctx.redactTerms)),
          cap: ctx.caps[m] ?? null,
        })),
      }),
    }),

    get_weather: defineTool({
      description: "Hourly rain chance (percent) for a date inside the 7-day forecast.",
      schema: z.object({ date }).strict(),
      run: async (a) => {
        const forecast = await ctx.weather.getForecast();
        const hourly = (forecast?.hourly ?? []).filter((h) => h.time.startsWith(`${a.date}T`));
        if (hourly.length === 0) return { available: false, hourly: [] };
        return {
          available: true,
          hourly: hourly.map((h) => ({
            hour: Number(h.time.slice(11, 13)),
            precipProb: h.precipProb,
          })),
        };
      },
    }),

    get_holidays: defineTool({
      description: "Public holidays between two dates.",
      schema: z.object({ from: date, to: date }).strict(),
      run: (a) => ({ holidays: ctx.holidays.filter((h) => h.date >= a.from && h.date <= a.to) }),
    }),

    get_travel_time: defineTool({
      description: "Motorbike minutes between two places.",
      schema: z.object({ fromPlaceId: id, toPlaceId: id }).strict(),
      run: (a) => {
        const from = place(a.fromPlaceId);
        const to = place(a.toPlaceId);
        if (!from || !to) throw new Error("Unknown place");
        return { minutes: travelMinutes(from, to) };
      },
    }),

    compute_cost: defineTool({
      description: "Cost per member and total of a list of stops. The only way to know a price.",
      schema: z
        .object({
          stops: z
            .array(
              z
                .object({
                  placeId: id,
                  items: z
                    .array(
                      z
                        .object({
                          itemId: id,
                          memberRef: z.string().max(8),
                          qty: z.number().int().min(1).max(20),
                        })
                        .strict(),
                    )
                    .max(30),
                })
                .strict(),
            )
            .max(20),
        })
        .strict(),
      run: (a) => {
        const stops = a.stops.map((s) => ({
          placeId: s.placeId,
          start: "00:00",
          end: "00:01",
          items: s.items.map((it) => {
            const memberId = memberIdOfRef(ctx, it.memberRef);
            if (!memberId) throw new Error(`Unknown member ${it.memberRef}`);
            return { itemId: it.itemId, memberId, qty: it.qty };
          }),
        }));
        const cost = computeCost(ctx.places, stops, ctx.memberIds);
        return {
          perMember: Object.fromEntries(
            ctx.memberIds.map((m) => [memberRef(ctx, m), cost.perMember[m] ?? 0]),
          ),
          total: cost.total,
        };
      },
    }),
  };
}

/** Validates the arguments, then runs the tool. Errors go back to the model as data. */
export async function callTool(tools: ToolSet, name: string, args: unknown): Promise<ToolResult> {
  if (!(TOOL_NAMES as readonly string[]).includes(name)) {
    return { ok: false, error: `Unknown tool ${name}.` };
  }
  const tool = tools[name as ToolName];
  const parsed = tool.schema.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: `Bad arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    };
  }
  try {
    return { ok: true, result: await tool.run(parsed.data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Tool failed." };
  }
}
