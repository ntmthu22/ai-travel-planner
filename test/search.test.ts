import { describe, expect, it } from "vitest";
import { isCandidate, isOpenAt, searchPlaces, weekdayOf } from "../src/search.js";
import { fixturePlaces, mkPlace } from "./fixtures.js";

// These tests encode docs/contract/search.md.
const places = fixturePlaces();
const ids = (ps: { id: string }[]) => ps.map((p) => p.id).sort();

describe("opening hours: every period counts", () => {
  const cafe = places.find((p) => p.id === "cafe")!;

  it("is open inside the morning and the afternoon period", () => {
    expect(isOpenAt(cafe, "mon", "09:00")).toBe(true);
    expect(isOpenAt(cafe, "mon", "15:30")).toBe(true);
  });

  it("is closed during the midday break", () => {
    expect(isOpenAt(cafe, "mon", "12:00")).toBe(false);
  });

  it("open is inclusive and close is exclusive", () => {
    expect(isOpenAt(cafe, "mon", "08:00")).toBe(true);
    expect(isOpenAt(cafe, "mon", "11:00")).toBe(false);
    expect(isOpenAt(cafe, "mon", "22:00")).toBe(false);
  });

  it("is closed on a weekday with no period, and with no hours at all", () => {
    expect(isOpenAt(cafe, "sun", "09:00")).toBe(false);
    expect(
      isOpenAt(
        places.find((p) => p.id === "nohours")!,
        "mon",
        "09:00",
      ),
    ).toBe(false);
  });

  it("understands a close of 24:00", () => {
    const late = mkPlace({ id: "late", hours: { fri: [{ open: "18:00", close: "24:00" }] } });
    expect(isOpenAt(late, "fri", "23:59")).toBe(true);
  });
});

describe("candidates: hours, ticket price and menu are all needed (P4)", () => {
  it("excludes a place with no hours, no ticket price or no menu", () => {
    const candidates = places.filter(isCandidate);
    expect(ids(candidates)).toEqual(["cafe", "far", "museum", "park", "restaurant"]);
  });

  it("treats a free ticket (0) as a price, and an empty period list as no hours", () => {
    expect(isCandidate(mkPlace({ id: "free", ticketPrice: 0 }))).toBe(true);
    expect(isCandidate(mkPlace({ id: "empty", hours: {} }))).toBe(false);
  });

  it("candidatesOnly never returns an incomplete place, whatever the filter", () => {
    const found = searchPlaces(places, { candidatesOnly: true });
    expect(ids(found)).not.toContain("nohours");
    expect(ids(found)).not.toContain("noticket");
    expect(ids(found)).not.toContain("nomenu");
  });
});

describe("filters", () => {
  it("filters by type", () => {
    expect(ids(searchPlaces(places, { type: "museum" }))).toEqual(["museum"]);
  });

  it("filters by district", () => {
    expect(ids(searchPlaces(places, { district: "D3" }))).toEqual(["museum"]);
  });

  it("filters by price level", () => {
    expect(ids(searchPlaces(places, { priceLevel: 3 }))).toEqual(["restaurant"]);
  });

  it("filters by open day and time, with the midday break", () => {
    const at = (day: "mon" | "sun", time: string) =>
      ids(searchPlaces(places, { openDay: day, openTime: time, candidatesOnly: true }));
    expect(at("mon", "12:00")).not.toContain("cafe");
    expect(at("mon", "15:00")).toContain("cafe");
    expect(at("sun", "09:00")).not.toContain("cafe");
    expect(at("sun", "09:00")).toContain("museum");
  });

  it("combines filters", () => {
    expect(ids(searchPlaces(places, { type: "park", district: "D1" }))).toEqual(["far", "park"]);
  });

  it("refuses a time without a day, and a bad time", () => {
    expect(() => searchPlaces(places, { openTime: "09:00" })).toThrow();
    expect(() => searchPlaces(places, { openDay: "mon", openTime: "9am" })).toThrow();
  });
});

describe("weekdayOf", () => {
  it("maps a date to its weekday", () => {
    expect(weekdayOf("2026-12-10")).toBe("thu");
    expect(weekdayOf("2026-12-13")).toBe("sun");
  });
});
