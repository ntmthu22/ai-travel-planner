import { describe, expect, it } from "vitest";
import { computeCost } from "../src/cost.js";
import { sanitizeInterest } from "../src/privacy.js";
import { TOOL_NAMES, callTool, createTools } from "../src/tools.js";
import { mkToolCtx } from "./helpers.js";

// docs/contract/agent-tools.md. The user and the group come from the session, never from the model.
const setup = (over = {}) => {
  const ctx = mkToolCtx(over);
  return { ctx, tools: createTools(ctx) };
};
interface Res {
  members: { ref: string; interests: string[]; cap: number | null }[];
  places: { id: string }[];
  menu: { id: string }[];
  perMember: Record<string, number>;
  total: number;
  minutes: number;
  available: boolean;
  hourly: { hour: number; precipProb: number }[];
  holidays: { date: string; name: string }[];
}
const ok = async (tools: ReturnType<typeof createTools>, name: string, args: unknown) => {
  const r = await callTool(tools, name, args);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.result as Res;
};

describe("the seven tools", () => {
  it("are exactly the seven of the contract", () => {
    expect([...TOOL_NAMES].sort()).toEqual(
      [
        "compute_cost",
        "get_holidays",
        "get_place",
        "get_profile",
        "get_travel_time",
        "get_weather",
        "search_places",
      ].sort(),
    );
    expect(Object.keys(setup().tools).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("an unknown tool is an error returned to the model, not an exception", async () => {
    const r = await callTool(setup().tools, "read_database", {});
    expect(r.ok).toBe(false);
  });
});

describe("the user and the group come from the session (R1)", () => {
  const injections: [string, unknown][] = [
    ["get_profile", { userId: "an" }],
    ["get_profile", { groupId: "other-group" }],
    ["search_places", { type: "cafe", userId: "an" }],
    ["search_places", { groupId: "g2" }],
    ["get_place", { placeId: "park", memberId: "an" }],
    ["get_weather", { date: "2026-12-10", userId: "an" }],
    ["compute_cost", { stops: [], userId: "an" }],
  ];
  it.each(injections)("%s refuses an argument that names a user or a group", async (name, args) => {
    const r = await callTool(setup().tools, name, args);
    expect(r.ok).toBe(false);
  });

  it("get_profile answers for the session's group, whatever the model asks", async () => {
    const { tools } = setup();
    const r = await ok(tools, "get_profile", {});
    expect(r.members).toHaveLength(3);
  });
});

describe("get_profile: members are refs, never names or emails", () => {
  it("returns m1..m3 with interests and caps and nothing else that identifies a person", async () => {
    const r = await ok(setup().tools, "get_profile", {});
    expect(r.members.map((m) => m.ref)).toEqual(["m1", "m2", "m3"]);
    expect(r.members[0]).toEqual({ ref: "m1", interests: ["coffee", "museums"], cap: 500_000 });
    expect(r.members[2]?.cap).toBeNull();
    const text = JSON.stringify(r);
    expect(text).not.toContain("@");
    expect(text).not.toMatch(/"(an|linh|binh)"/);
  });

  it("redacts an email or a name that a member typed into an interest", () => {
    const terms = ["Nguyen Thi Linh", "linh@example.com"];
    expect(sanitizeInterest("mail me at linh@example.com about coffee", terms)).not.toContain("@");
    expect(sanitizeInterest("Nguyen Thi Linh loves tea", terms)).not.toContain("Linh");
    expect(sanitizeInterest("ping x.y+z@mail.co", [])).not.toContain("@");
    expect(sanitizeInterest("street food", terms)).toBe("street food");
    expect(sanitizeInterest("x".repeat(100), []).length).toBeLessThanOrEqual(40);
  });

  it("applies the redaction to what get_profile returns", async () => {
    const { tools } = setup({
      interests: { linh: ["call Nguyen Thi Linh on linh@example.com"], an: [], binh: [] },
    });
    const text = JSON.stringify(await ok(tools, "get_profile", {}));
    expect(text).not.toContain("Nguyen");
    expect(text).not.toContain("@");
  });
});

describe("search_places and get_place: candidates only (P4)", () => {
  it("never returns a place with no hours, no ticket price or no menu", async () => {
    const { tools } = setup();
    const r = await ok(tools, "search_places", {});
    const ids = r.places.map((p) => p.id);
    expect(ids).toContain("park");
    for (const bad of ["nohours", "noticket", "nomenu"]) expect(ids).not.toContain(bad);
  });

  it("filters by day and time over every period", async () => {
    const { tools } = setup();
    const r = await ok(tools, "search_places", { day: "mon", time: "12:00" });
    expect(r.places.map((p) => p.id)).not.toContain("cafe");
  });

  it("refuses a time without a day, and bad values", async () => {
    const { tools } = setup();
    for (const args of [{ time: "09:00" }, { day: "funday", time: "09:00" }, { priceLevel: 9 }]) {
      expect((await callTool(tools, "search_places", args)).ok).toBe(false);
    }
  });

  it("get_place gives the menu of a candidate and refuses a non-candidate", async () => {
    const { tools } = setup();
    const r = await ok(tools, "get_place", { placeId: "restaurant" });
    expect(r.menu.map((m) => m.id)).toEqual(["rest_a", "rest_b"]);
    expect((await callTool(tools, "get_place", { placeId: "nomenu" })).ok).toBe(false);
    expect((await callTool(tools, "get_place", { placeId: "atlantis" })).ok).toBe(false);
  });

  it("remembers which places the model has actually seen", async () => {
    const { ctx, tools } = setup();
    await ok(tools, "search_places", { type: "park" });
    await ok(tools, "get_place", { placeId: "museum" });
    expect([...ctx.seenPlaceIds].sort()).toEqual(["far", "museum", "park"]);
  });
});

describe("compute_cost: the only place the model's money comes from", () => {
  const stops = [
    { placeId: "museum", items: [{ itemId: "museum_guide", memberRef: "m1", qty: 1 }] },
    { placeId: "restaurant", items: [{ itemId: "rest_a", memberRef: "m2", qty: 2 }] },
  ];

  it("returns what computeCost computes, by ref", async () => {
    const { ctx, tools } = setup();
    const r = await ok(tools, "compute_cost", { stops });
    const expected = computeCost(
      ctx.places,
      [
        {
          placeId: "museum",
          start: "00:00",
          end: "00:01",
          items: [{ itemId: "museum_guide", memberId: "linh", qty: 1 }],
        },
        {
          placeId: "restaurant",
          start: "00:00",
          end: "00:01",
          items: [{ itemId: "rest_a", memberId: "an", qty: 2 }],
        },
      ],
      ctx.memberIds,
    );
    expect(r.total).toBe(expected.total);
    expect(r.perMember).toEqual({
      m1: expected.perMember.linh,
      m2: expected.perMember.an,
      m3: expected.perMember.binh,
    });
  });

  it("refuses a total or a price in the arguments, an unknown ref, an unknown item", async () => {
    const { tools } = setup();
    expect((await callTool(tools, "compute_cost", { stops, total: 1 })).ok).toBe(false);
    const withPrice = [
      { placeId: "park", items: [{ itemId: "park_water", memberRef: "m1", qty: 1, price: 1 }] },
    ];
    expect((await callTool(tools, "compute_cost", { stops: withPrice })).ok).toBe(false);
    const ghost = [{ placeId: "park", items: [{ itemId: "park_water", memberRef: "m9", qty: 1 }] }];
    expect((await callTool(tools, "compute_cost", { stops: ghost })).ok).toBe(false);
    const nope = [{ placeId: "park", items: [{ itemId: "nope", memberRef: "m1", qty: 1 }] }];
    expect((await callTool(tools, "compute_cost", { stops: nope })).ok).toBe(false);
  });

  it("a member's real id is not accepted in place of a ref", async () => {
    const stopsById = [
      { placeId: "park", items: [{ itemId: "park_water", memberRef: "linh", qty: 1 }] },
    ];
    expect((await callTool(setup().tools, "compute_cost", { stops: stopsById })).ok).toBe(false);
  });
});

describe("get_travel_time, get_weather, get_holidays", () => {
  it("travel time is whole minutes and refuses unknown places", async () => {
    const { tools } = setup();
    const r = await ok(tools, "get_travel_time", { fromPlaceId: "park", toPlaceId: "far" });
    expect(Number.isInteger(r.minutes)).toBe(true);
    expect(r.minutes).toBeGreaterThan(30);
    expect(
      (await callTool(tools, "get_travel_time", { fromPlaceId: "park", toPlaceId: "x" })).ok,
    ).toBe(false);
  });

  it("weather returns the hourly rain chance of the date from the source", async () => {
    const r = await ok(setup().tools, "get_weather", { date: "2026-12-10" });
    expect(r.available).toBe(true);
    expect(r.hourly).toHaveLength(24);
    expect(r.hourly[9]).toEqual({ hour: 9, precipProb: 10 });
  });

  it("weather says so when the date is outside the forecast", async () => {
    const r = await ok(setup().tools, "get_weather", { date: "2026-12-30" });
    expect(r.available).toBe(false);
  });

  it("holidays are listed inside the range", async () => {
    const r = await ok(setup().tools, "get_holidays", { from: "2026-12-01", to: "2026-12-31" });
    expect(r.holidays).toEqual([{ date: "2026-12-25", name: "Christmas Day" }]);
  });
});
