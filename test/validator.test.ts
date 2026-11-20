import { describe, expect, it } from "vitest";
import type { Forecast } from "../src/data.js";
import type { Stop } from "../src/schedule.js";
import { validateSchedule, type ValidationContext } from "../src/validator.js";
import { fixturePlaces } from "./fixtures.js";

// The five checks of docs/contract/plans.md. A rule is never loosened to turn a test green.
const THU = "2026-12-10"; // cafe is closed on Thursday; museum, park, restaurant are open
const MON = "2026-12-07"; // cafe has a midday break on Monday

function ctx(over: Partial<ValidationContext> = {}): ValidationContext {
  return {
    places: fixturePlaces(),
    memberIds: ["linh", "an"],
    caps: {},
    groupTotal: 10_000_000,
    date: THU,
    forecast: null,
    ...over,
  };
}

const stop = (placeId: string, start: string, end: string, items: Stop["items"] = []): Stop => ({
  placeId,
  start,
  end,
  items,
});

const rules = (stops: Stop[], c = ctx()) => validateSchedule(stops, c).map((v) => v.code);

const GOOD: Stop[] = [
  stop("park", "09:00", "10:00", [{ itemId: "park_water", memberId: "linh", qty: 1 }]),
  stop("restaurant", "11:00", "12:30", [{ itemId: "rest_b", memberId: "an", qty: 1 }]),
];

function rain(date: string, hours: Record<number, number>): Forecast {
  const hourly = [];
  for (let h = 0; h < 24; h++) {
    hourly.push({ time: `${date}T${String(h).padStart(2, "0")}:00`, precipProb: hours[h] ?? 10 });
  }
  return { hourly };
}

describe("a good schedule", () => {
  it("passes all five checks", () => {
    expect(validateSchedule(GOOD, ctx({ forecast: rain(THU, {}) }))).toEqual([]);
  });

  it("every violation names its rule and says why", () => {
    const v = validateSchedule([stop("nope", "09:00", "10:00")], ctx());
    expect(v[0]).toMatchObject({ rule: "V1", code: "unknown_place" });
    expect(typeof v[0]!.message).toBe("string");
  });
});

describe("V1: every place, item and member exists", () => {
  it("refuses an invented place", () => {
    expect(rules([stop("atlantis", "09:00", "10:00")])).toContain("unknown_place");
  });

  it("refuses an invented item, and an item that belongs to another place", () => {
    const bad = (itemId: string) =>
      rules([stop("park", "09:00", "10:00", [{ itemId, memberId: "linh", qty: 1 }])]);
    expect(bad("magic_potion")).toContain("unknown_item");
    expect(bad("rest_a")).toContain("unknown_item");
  });

  it("refuses an item for someone who is not in the group", () => {
    const items = [{ itemId: "park_water", memberId: "stranger", qty: 1 }];
    expect(rules([stop("park", "09:00", "10:00", items)])).toContain("unknown_member");
  });

  it("does not crash on a schedule full of invented things: it reports and stops there", () => {
    const codes = rules([stop("atlantis", "09:00", "10:00"), stop("park", "10:00", "11:00")]);
    expect(codes).toEqual(["unknown_place"]);
  });
});

describe("V2: every stop is within opening hours", () => {
  it("refuses a closed weekday", () => {
    expect(rules([stop("cafe", "09:00", "10:00")], ctx({ date: THU }))).toContain(
      "outside_opening_hours",
    );
  });

  it("refuses a stop before opening or after closing", () => {
    expect(rules([stop("museum", "07:00", "09:00")])).toContain("outside_opening_hours");
    expect(rules([stop("museum", "16:00", "18:00")])).toContain("outside_opening_hours");
  });

  it("refuses a stop that spans the midday break", () => {
    expect(rules([stop("cafe", "10:00", "15:00")], ctx({ date: MON }))).toContain(
      "outside_opening_hours",
    );
    expect(rules([stop("cafe", "14:00", "15:00")], ctx({ date: MON }))).toEqual([]);
  });

  it("allows a stop that ends exactly at closing time", () => {
    expect(rules([stop("museum", "16:00", "17:00")])).toEqual([]);
  });
});

describe("V3: the motorbike time fits each gap", () => {
  it("refuses a gap shorter than the travel time", () => {
    // park to far is about 20 km: well over 5 minutes
    const codes = rules([stop("park", "09:00", "10:00"), stop("far", "10:05", "11:00")]);
    expect(codes).toContain("travel_time_too_short");
  });

  it("refuses overlapping stops", () => {
    expect(rules([stop("park", "09:00", "10:00"), stop("restaurant", "09:30", "11:00")])).toContain(
      "travel_time_too_short",
    );
  });

  it("accepts a gap that is long enough, whatever the order the stops are listed in", () => {
    const stops = [stop("far", "12:00", "13:00"), stop("park", "09:00", "10:00")];
    expect(rules(stops)).toEqual([]);
  });

  it("checks the gap between neighbours only, so a long day is fine", () => {
    expect(rules(GOOD)).toEqual([]);
  });
});

describe("V4: spending within the lowest cap and the group total", () => {
  const spend = (qty: number): Stop[] => [
    stop("restaurant", "11:00", "12:00", [{ itemId: "rest_a", memberId: "linh", qty }]),
  ];

  it("refuses a member over the lowest cap in the group, even if their own cap is higher", () => {
    const c = ctx({ caps: { linh: 500_000, an: 100_000 } });
    const v = validateSchedule(spend(1), c); // linh pays 150k > lowest cap 100k
    expect(v.map((x) => x.code)).toContain("over_member_cap");
    expect(v.find((x) => x.code === "over_member_cap")?.message).toContain("linh");
  });

  it("accepts spending exactly at the lowest cap", () => {
    expect(rules(spend(1), ctx({ caps: { linh: 150_000, an: 400_000 } }))).toEqual([]);
  });

  it("counts the ticket of every stop towards every member", () => {
    const stops = [stop("museum", "09:00", "10:00")]; // 40k ticket each, no items
    expect(rules(stops, ctx({ caps: { an: 39_999 } }))).toContain("over_member_cap");
    expect(rules(stops, ctx({ caps: { an: 40_000 } }))).toEqual([]);
  });

  it("ignores members who set no cap", () => {
    expect(rules(spend(3), ctx({ caps: { linh: null } }))).toEqual([]);
  });

  it("refuses a group over its total, and accepts exactly the total", () => {
    expect(rules(spend(2), ctx({ groupTotal: 299_999 }))).toContain("over_group_total");
    expect(rules(spend(2), ctx({ groupTotal: 300_000 }))).toEqual([]);
  });

  it("ignores a cost the client or the model wrote: the price is recomputed from the data", () => {
    const lying = { ...spend(5)[0], totalCost: 1, price: 1 } as unknown as Stop;
    expect(rules([lying], ctx({ groupTotal: 300_000 }))).toContain("over_group_total");
  });
});

describe("V5: no outdoor stop above 60% chance of rain", () => {
  const outdoor = [stop("park", "09:00", "10:30")];

  it("refuses an outdoor stop in an hour above 60%", () => {
    expect(rules(outdoor, ctx({ forecast: rain(THU, { 10: 61 }) }))).toContain("rain_risk");
  });

  it("accepts exactly 60%", () => {
    expect(rules(outdoor, ctx({ forecast: rain(THU, { 9: 60, 10: 60 }) }))).toEqual([]);
  });

  it("ignores rain in an hour the stop does not cover", () => {
    expect(rules(outdoor, ctx({ forecast: rain(THU, { 8: 90, 11: 90 }) }))).toEqual([]);
  });

  it("ignores an indoor stop", () => {
    expect(
      rules([stop("museum", "09:00", "10:00")], ctx({ forecast: rain(THU, { 9: 95 }) })),
    ).toEqual([]);
  });

  it("does not guess outside the forecast: no forecast, or a date it does not cover", () => {
    expect(rules(outdoor, ctx({ forecast: null }))).toEqual([]);
    expect(rules(outdoor, ctx({ forecast: rain("2026-12-20", { 9: 99 }) }))).toEqual([]);
  });
});

describe("several rules at once", () => {
  it("reports every rule that fails, not only the first", () => {
    const stops = [
      stop("cafe", "09:00", "10:00"), // closed on Thursday (V2)
      stop("park", "10:05", "11:00"), // outdoor, and 80% rain at 10:00 (V5)
    ];
    const codes = rules(stops, ctx({ forecast: rain(THU, { 10: 80 }) }));
    expect(codes).toContain("outside_opening_hours");
    expect(codes).toContain("rain_risk");
  });
});
