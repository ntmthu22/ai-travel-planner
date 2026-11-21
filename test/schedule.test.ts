import { describe, expect, it } from "vitest";
import { computeCost } from "../src/cost.js";
import { parseStops } from "../src/schedule.js";
import { travelMinutes } from "../src/travel.js";
import { fixturePlaces } from "./fixtures.js";

// Money and travel time are computed by plain code (CLAUDE.md). Stops are checked against a strict schema.
const places = fixturePlaces();
const get = (id: string) => places.find((p) => p.id === id)!;

describe("computeCost: money comes from code", () => {
  it("adds the ticket for every member and the items to the member who takes them", () => {
    const cost = computeCost(
      places,
      [
        {
          placeId: "museum",
          start: "09:00",
          end: "10:00",
          items: [{ itemId: "museum_guide", memberId: "linh", qty: 1 }],
        },
        {
          placeId: "restaurant",
          start: "12:00",
          end: "13:00",
          items: [
            { itemId: "rest_a", memberId: "an", qty: 2 },
            { itemId: "rest_b", memberId: "linh", qty: 1 },
          ],
        },
      ],
      ["linh", "an"],
    );
    // museum ticket 40k each; guide 20k linh; noodles 2x150k an; rice 90k linh.
    expect(cost.perMember).toEqual({ linh: 40_000 + 20_000 + 90_000, an: 40_000 + 300_000 });
    expect(cost.total).toBe(150_000 + 340_000);
  });

  it("a place with no items still costs its ticket", () => {
    const cost = computeCost(
      places,
      [{ placeId: "museum", start: "09:00", end: "10:00", items: [] }],
      ["linh", "an", "binh"],
    );
    expect(cost.total).toBe(120_000);
  });

  it("throws on an unknown place, item or member instead of guessing a price", () => {
    const stop = (placeId: string, itemId: string, memberId: string) => [
      { placeId, start: "09:00", end: "10:00", items: [{ itemId, memberId, qty: 1 }] },
    ];
    expect(() => computeCost(places, stop("nope", "x", "linh"), ["linh"])).toThrow(/place/);
    expect(() => computeCost(places, stop("park", "nope", "linh"), ["linh"])).toThrow(/item/);
    expect(() => computeCost(places, stop("park", "park_water", "ghost"), ["linh"])).toThrow(
      /member/,
    );
    // an item of another place is not on this menu
    expect(() => computeCost(places, stop("park", "rest_a", "linh"), ["linh"])).toThrow(/item/);
  });
});

describe("travelMinutes: motorbike time between two places", () => {
  it("is 0 for the same place and symmetric", () => {
    expect(travelMinutes(get("park"), get("park"))).toBe(0);
    expect(travelMinutes(get("park"), get("restaurant"))).toBe(
      travelMinutes(get("restaurant"), get("park")),
    );
  });

  it("is a whole number of minutes, at least 1 for two different places", () => {
    const t = travelMinutes(get("park"), get("restaurant"));
    expect(Number.isInteger(t)).toBe(true);
    expect(t).toBeGreaterThanOrEqual(1);
  });

  it("grows with distance", () => {
    expect(travelMinutes(get("park"), get("far"))).toBeGreaterThan(
      travelMinutes(get("park"), get("restaurant")) + 30,
    );
  });
});

describe("parseStops: the model's output is checked against a schema first (R2)", () => {
  const ok = [
    {
      placeId: "park",
      start: "09:00",
      end: "10:00",
      items: [{ itemId: "park_water", memberId: "linh", qty: 2 }],
    },
  ];

  it("accepts a well-formed schedule", () => {
    expect(parseStops(ok).ok).toBe(true);
  });

  it("refuses a cost, total or any unknown key anywhere (the model never does the money)", () => {
    expect(parseStops([{ ...ok[0], totalCost: 1 }]).ok).toBe(false);
    expect(parseStops([{ ...ok[0], items: [{ ...ok[0]!.items[0], price: 1 }] }]).ok).toBe(false);
  });

  it("refuses an empty schedule, a bad time, end before start, and a bad quantity", () => {
    expect(parseStops([]).ok).toBe(false);
    expect(parseStops([{ ...ok[0], start: "9am" }]).ok).toBe(false);
    expect(parseStops([{ ...ok[0], start: "10:00", end: "09:00" }]).ok).toBe(false);
    for (const qty of [0, -1, 1.5, 100]) {
      expect(parseStops([{ ...ok[0], items: [{ ...ok[0]!.items[0], qty }] }]).ok).toBe(false);
    }
  });

  it("refuses something that is not a list of stops", () => {
    expect(parseStops("nope").ok).toBe(false);
    expect(parseStops(null).ok).toBe(false);
  });
});
