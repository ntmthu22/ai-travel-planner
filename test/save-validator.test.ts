import { describe, expect, it } from "vitest";
import { mkApi, mkGroup, type Api } from "./apiHelpers.js";
import { FakeModel, final, tool } from "./fakeModel.js";
import { THU } from "./helpers.js";

// H3: the backend validator decides at Save, whatever the agent or the screen said. Each rule is tried
// with direct requests (an edit by PUT, then Save), the way a second client or a script would.
const item = (p: string, ref = "m1", qty = 1) => ({ itemId: `${p}_m`, memberRef: ref, qty });
const stop = (p: string, start: string, end: string, items = [item(p)]) => ({
  placeId: p,
  start,
  end,
  items,
});
const GOOD = [stop("p1", "09:00", "10:00"), stop("p2", "11:00", "12:00")];
// items as the API stores them (real member ids)
const apiItem = (p: string, memberId = "linh", qty = 1) => ({ itemId: `${p}_m`, memberId, qty });
const apiStop = (p: string, start: string, end: string, items = [apiItem(p)]) => ({
  placeId: p,
  start,
  end,
  items,
});

async function draft(api: Api) {
  const g = await mkGroup(api);
  api.models.push(
    new FakeModel([
      tool("search_places"),
      final({ placeIds: Array.from({ length: 8 }, (_, i) => `p${i + 1}`) }),
    ]),
  );
  const prop = await api
    .as("linh")
    .post(`/groups/${g.id}/proposals`, { date: THU, preferences: [] });
  api.models.push(new FakeModel([final({ stops: GOOD })]));
  const plan = await api
    .as("linh")
    .post(`/proposals/${prop.body.id}/confirm`, { pinned: [], removed: [] });
  return { g, planId: plan.body.id as string };
}
const edit = (api: Api, planId: string, stops: unknown[]) =>
  api.as("linh").put(`/plans/${planId}/stops`, { stops });
const save = (api: Api, planId: string, key = "k1") =>
  api.as("linh").post(`/plans/${planId}/save`, { confirmed: true }).set("Idempotency-Key", key);

/** Refused at Save: 422, the rule is named, the plan stays a private draft. */
async function expectRefused(
  api: Api,
  g: { id: string },
  planId: string,
  rule: string,
  code: string,
) {
  const r = await save(api, planId);
  expect(r.status).toBe(422);
  expect(r.body.type).toBe("https://travelplanner.example/problems/plan-violates-constraints");
  expect(
    r.body.violations.map((v: { rule: string; code: string }) => [v.rule, v.code]),
  ).toContainEqual([rule, code]);
  expect(api.store.plans.get(planId)?.status).toBe("draft");
  expect((await api.as("an").get(`/groups/${g.id}/plans`)).body.plans).toEqual([]);
  expect((await api.as("an").get(`/plans/${planId}`)).status).toBe(404);
}

describe("a valid schedule saves", () => {
  it("the agent's draft, and a draft the owner edited into another valid one", async () => {
    const api = mkApi();
    const { planId } = await draft(api);
    const edited = [apiStop("p3", "10:00", "11:00"), apiStop("p4", "12:00", "13:00")];
    expect((await edit(api, planId, edited)).status).toBe(200);
    const r = await save(api, planId);
    expect(r.status).toBe(200);
    expect(api.store.plans.get(planId)?.stops?.map((s) => s.placeId)).toEqual(["p3", "p4"]);
  });
});

describe("Save refuses what the agent could not have, with the rule named", () => {
  it("V1: an invented place, an invented item, a member who is not in the group", async () => {
    for (const [stops, code] of [
      [[apiStop("atlantis", "09:00", "10:00", [])], "unknown_place"],
      [
        [apiStop("p1", "09:00", "10:00", [{ itemId: "magic", memberId: "linh", qty: 1 }])],
        "unknown_item",
      ],
      [[apiStop("p1", "09:00", "10:00", [apiItem("p1", "stranger")])], "unknown_member"],
    ] as const) {
      const api = mkApi();
      const { g, planId } = await draft(api);
      await edit(api, planId, stops as unknown[]);
      await expectRefused(api, g, planId, "V1", code);
    }
  });

  it("V2: a place that is closed that day", async () => {
    const api = mkApi();
    const { g, planId } = await draft(api);
    await edit(api, planId, [apiStop("closed", "09:00", "10:00", [])]);
    await expectRefused(api, g, planId, "V2", "outside_opening_hours");
  });

  it("V3: a gap shorter than the motorbike time, and overlapping stops", async () => {
    for (const second of [apiStop("p10", "10:02", "11:00"), apiStop("p2", "09:30", "10:30")]) {
      const api = mkApi();
      const { g, planId } = await draft(api);
      await edit(api, planId, [apiStop("p1", "09:00", "10:00"), second]);
      await expectRefused(api, g, planId, "V3", "travel_time_too_short");
    }
  });

  it("V4: a member over the lowest cap, using the cap as it is at Save time", async () => {
    const api = mkApi();
    const { g, planId } = await draft(api); // linh pays 60k in the agent's draft
    await api.as("an").put(`/groups/${g.id}/members/an/cap`, { cap: 20_000 }); // set after the draft
    await expectRefused(api, g, planId, "V4", "over_member_cap");
  });

  it("V4: the group over its total", async () => {
    const api = mkApi();
    const { g, planId } = await draft(api);
    await api.as("linh").put(`/groups/${g.id}/total`, { total: 50_000 }); // the draft costs 60k
    await expectRefused(api, g, planId, "V4", "over_group_total");
  });

  it("V5: an outdoor stop in an hour above 60% rain", async () => {
    const hourly = Array.from({ length: 24 }, (_, h) => ({
      time: `${THU}T${String(h).padStart(2, "0")}:00`,
      precipProb: h === 10 ? 80 : 10,
    }));
    const api = mkApi({ weather: { getForecast: async () => ({ hourly }) } });
    const { g, planId } = await draft(api);
    await edit(api, planId, [
      apiStop("rainy", "10:00", "11:00", [{ itemId: "rainy_m", memberId: "linh", qty: 1 }]),
    ]);
    await expectRefused(api, g, planId, "V5", "rain_risk");
  });

  it("every rule that fails is reported together, not only the first", async () => {
    const api = mkApi();
    const { g, planId } = await draft(api);
    await api.as("linh").put(`/groups/${g.id}/total`, { total: 10_000 });
    await edit(api, planId, [
      apiStop("closed", "09:00", "10:00", []),
      apiStop("p10", "10:02", "11:00"),
    ]);
    const r = await save(api, planId);
    expect(r.status).toBe(422);
    const rules = new Set(r.body.violations.map((v: { rule: string }) => v.rule));
    expect(rules).toEqual(new Set(["V2", "V3", "V4"]));
    expect(typeof r.body.violations[0].message).toBe("string");
  });
});

describe("what the client or the model says about money is never read", () => {
  it("a saved plan's spending is recomputed from the data", async () => {
    const api = mkApi();
    const { planId } = await draft(api);
    const mutated = api.store.plans.get(planId)!;
    mutated.totalCost = 1; // a lie in the stored legacy field
    const r = await save(api, planId);
    expect(r.status).toBe(200);
    expect((await api.as("linh").get(`/plans/${planId}`)).body.spending.total).toBe(60_000);
  });
});
