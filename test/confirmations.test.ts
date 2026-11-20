import { describe, expect, it } from "vitest";
import { mkApi, mkGroup, type Api } from "./apiHelpers.js";
import { FakeModel, final, tool } from "./fakeModel.js";
import { THU } from "./helpers.js";

// docs/contract/plans.md: the agent proposes, the user confirms the places (1st), reviews and edits the
// schedule, then presses Save (2nd). Before Save the other members see nothing.
const BASE = "https://travelplanner.example/problems/";
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const item = (p: string, ref = "m1", qty = 1) => ({ itemId: `${p}_m`, memberRef: ref, qty });
const stop = (p: string, start: string, end: string, items = [item(p)]) => ({
  placeId: p,
  start,
  end,
  items,
});
const GOOD = [stop("p1", "09:00", "10:00"), stop("p2", "11:00", "12:00")];

async function propose(api: Api, groupId: string, placeIds = ids(8), user = "linh") {
  api.models.push(new FakeModel([tool("search_places"), final({ placeIds })]));
  return api.as(user).post(`/groups/${groupId}/proposals`, { date: THU, preferences: ["coffee"] });
}
async function confirm(
  api: Api,
  proposalId: string,
  body: object,
  stops: unknown[] = GOOD,
  user = "linh",
) {
  api.models.push(new FakeModel([final({ stops })]));
  return api.as(user).post(`/proposals/${proposalId}/confirm`, body);
}
async function draft(
  api: Api,
  over: { pinned?: string[]; removed?: string[]; stops?: unknown[] } = {},
) {
  const g = await mkGroup(api);
  const prop = await propose(api, g.id);
  const res = await confirm(
    api,
    prop.body.id,
    { pinned: over.pinned ?? ["p1"], removed: over.removed ?? ["p8"] },
    over.stops,
  );
  return { g, prop, plan: res.body, res };
}

describe("first confirmation: nothing is scheduled before the places are confirmed (H1)", () => {
  it("proposes 8 to 12 places and builds no schedule", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    const res = await propose(api, g.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      groupId: g.id,
      date: THU,
      status: "awaiting_place_confirmation",
      warning: null,
    });
    expect(res.body.places.map((p: { id: string }) => p.id)).toEqual(ids(8));
    expect(res.body.places[0]).toMatchObject({ name: "Place 1", type: "cafe" });
    expect(res.body.stops).toBeUndefined();
    expect(api.store.plans.size).toBe(0);
    expect(api.models).toHaveLength(0); // exactly one model run so far
  });

  it("validates the request, and needs a signed-in member of the group", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    for (const body of [
      {},
      { date: "tomorrow" },
      { date: THU, preferences: "coffee" },
      { date: THU, preferences: Array(11).fill("x") },
    ]) {
      const r = await api.as("linh").post(`/groups/${g.id}/proposals`, body);
      expect(r.status).toBe(400);
    }
    expect((await propose(api, g.id, ids(8), "stranger")).status).toBe(404);
    expect((await api.as(null).post(`/groups/${g.id}/proposals`, { date: THU })).status).toBe(401);
  });

  it("answers 503 model-unavailable when no model is configured", async () => {
    const api = mkApi({ model: null });
    const g = await mkGroup(api);
    const r = await api.as("linh").post(`/groups/${g.id}/proposals`, { date: THU });
    expect(r.status).toBe(503);
    expect(r.body.type).toBe(`${BASE}model-unavailable`);
  });

  it("at a limit the user gets the best draft with a red warning, still private", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    api.models.push(new FakeModel(Array.from({ length: 30 }, () => tool("search_places"))));
    const r = await api.as("linh").post(`/groups/${g.id}/proposals`, { date: THU });
    expect(r.status).toBe(201);
    expect(r.body.warning).toMatchObject({ level: "red", limit: "tool_calls" });
    expect(r.body.places.length).toBeGreaterThanOrEqual(8); // the code-made fallback of seen places
    expect((await api.as("an").get(`/proposals/${r.body.id}`)).status).toBe(404);
  });

  it("records the run: tool calls as made, model name, no name or email in the prompts", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    await propose(api, g.id);
    const run = api.store.runs[0]!;
    expect(run).toMatchObject({ kind: "shortlist", groupId: g.id, userId: "linh", model: "fake" });
    expect(run.toolCalls.map((c) => c.name)).toEqual(["search_places"]);
    const log = JSON.stringify(run.messages);
    expect(log).not.toContain("@");
    expect(log).not.toContain("Name of");
  });
});

describe("first confirmation: pin and remove", () => {
  it("a pinned place is in the schedule and a removed one is not; the spending is per person", async () => {
    const { res, plan } = await draft(mkApi());
    expect(res.status).toBe(201);
    expect(plan.status).toBe("draft");
    const placeIds = plan.stops.map((s: { placeId: string }) => s.placeId);
    expect(placeIds).toContain("p1");
    expect(placeIds).not.toContain("p8");
    expect(plan.spending).toEqual({ perMember: { linh: 60_000, an: 0, binh: 0 }, total: 60_000 });
    expect(plan.warning).toBeNull();
    expect(plan.violations).toEqual([]);
  });

  it("a model that ignores the pin or uses a removed place is sent back to repair it", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    const prop = await propose(api, g.id);
    api.models.push(
      new FakeModel([
        final({ stops: [stop("p2", "09:00", "10:00")] }), // pin p1 missing
        final({ stops: [stop("p1", "09:00", "10:00"), stop("p8", "11:00", "12:00")] }), // removed p8 present
        final({ stops: GOOD }),
      ]),
    );
    const res = await api
      .as("linh")
      .post(`/proposals/${prop.body.id}/confirm`, { pinned: ["p1"], removed: ["p8"] });
    expect(res.body.warning).toBeNull();
    expect(res.body.stops.map((s: { placeId: string }) => s.placeId)).toEqual(["p1", "p2"]);
    expect(api.store.runs.at(-1)).toMatchObject({ kind: "schedule", repairRounds: 2 });
  });

  it("a model that never puts the pin in gets a red warning and the violation is listed", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    const prop = await propose(api, g.id);
    const noPin = final({ stops: [stop("p2", "09:00", "10:00")] });
    api.models.push(new FakeModel([noPin, noPin, noPin]));
    const res = await api
      .as("linh")
      .post(`/proposals/${prop.body.id}/confirm`, { pinned: ["p1"], removed: [] });
    expect(res.status).toBe(201);
    expect(res.body.warning).toMatchObject({ level: "red", limit: "repair_rounds" });
    expect(res.body.violations.map((v: { code: string }) => v.code)).toContain("pinned_missing");
    expect(res.body.status).toBe("draft");
  });

  it("a draft with a red warning and a real violation is private and Save refuses it", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    const prop = await propose(api, g.id);
    const closed = final({
      stops: [stop("p1", "09:00", "10:00"), stop("closed", "11:00", "12:00")],
    });
    api.models.push(new FakeModel([closed, closed, closed]));
    const res = await api
      .as("linh")
      .post(`/proposals/${prop.body.id}/confirm`, { pinned: ["p1"], removed: [] });
    expect(res.body.warning).toMatchObject({ level: "red", limit: "repair_rounds" });
    const saved = await api
      .as("linh")
      .post(`/plans/${res.body.id}/save`, { confirmed: true })
      .set("Idempotency-Key", "k1");
    expect(saved.status).toBe(422);
    expect(saved.body.violations[0]).toMatchObject({ rule: "V2", code: "outside_opening_hours" });
    expect(api.store.plans.get(res.body.id)?.status).toBe("draft");
    expect((await api.as("an").get(`/groups/${g.id}/plans`)).body.plans).toEqual([]);
  });

  it("refuses ids that are not in the proposal, overlaps, and an empty rest", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    const prop = await propose(api, g.id);
    const bad = [
      { pinned: ["p9"], removed: [] },
      { pinned: [], removed: ["p9"] },
      { pinned: ["p1"], removed: ["p1"] },
      { pinned: [], removed: ids(8) },
      { pinned: "p1", removed: [] },
      { removed: [] },
    ];
    for (const body of bad) {
      const r = await api.as("linh").post(`/proposals/${prop.body.id}/confirm`, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(api.store.plans.size).toBe(0);
  });

  it("only the member who made the proposal confirms it", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    const prop = await propose(api, g.id);
    expect((await confirm(api, prop.body.id, { pinned: [], removed: [] }, GOOD, "an")).status).toBe(
      404,
    );
    expect(
      (await confirm(api, prop.body.id, { pinned: [], removed: [] }, GOOD, "stranger")).status,
    ).toBe(404);
    expect(api.store.plans.size).toBe(0);
  });

  it("confirming twice is 409 and makes no second schedule", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    const prop = await propose(api, g.id);
    expect((await confirm(api, prop.body.id, { pinned: [], removed: [] })).status).toBe(201);
    const again = await confirm(api, prop.body.id, { pinned: [], removed: [] });
    expect(again.status).toBe(409);
    expect(again.body.type).toBe(`${BASE}proposal-already-confirmed`);
    expect(api.store.plans.size).toBe(1);
  });
});

describe("before Save the other members see nothing, also through direct requests", () => {
  it("a second member's account gets 404 for the proposal, the draft and its edit, and sees no plan in the group", async () => {
    const api = mkApi();
    const d = await draft(api);
    expect((await api.as("linh").get(`/proposals/${d.prop.body.id}`)).status).toBe(200);
    expect((await api.as("linh").get(`/plans/${d.plan.id}`)).status).toBe(200);
    for (const user of ["an", "binh", "stranger"]) {
      expect((await api.as(user).get(`/proposals/${d.prop.body.id}`)).status).toBe(404);
      expect((await api.as(user).get(`/plans/${d.plan.id}`)).status).toBe(404);
      expect((await api.as(user).put(`/plans/${d.plan.id}/stops`, { stops: GOOD })).status).toBe(
        404,
      );
    }
    const list = await api.as("an").get(`/groups/${d.g.id}/plans`);
    expect(list.status).toBe(200);
    expect(list.body.plans).toEqual([]);
    const group = await api.as("an").get(`/groups/${d.g.id}`);
    expect(group.text).not.toContain(d.plan.id);
    expect(group.text).not.toContain("p1_m");
  });

  it("another member cannot save someone else's draft, and it stays private", async () => {
    const api = mkApi();
    const d = await draft(api);
    const r = await api
      .as("an")
      .post(`/plans/${d.plan.id}/save`, { confirmed: true })
      .set("Idempotency-Key", "k1");
    expect(r.status).toBe(403);
    expect(api.store.plans.get(d.plan.id)?.status).toBe("draft");
    expect((await api.as("an").get(`/plans/${d.plan.id}`)).status).toBe(404);
  });
});

describe("second confirmation: review, edit, Save", () => {
  const save = (api: Api, id: string, key = "k1", user = "linh") =>
    api.as(user).post(`/plans/${id}/save`, { confirmed: true }).set("Idempotency-Key", key);

  it("the owner reviews the draft with spending computed by code", async () => {
    const api = mkApi();
    const d = await draft(api);
    const r = await api.as("linh").get(`/plans/${d.plan.id}`);
    expect(r.body).toMatchObject({
      id: d.plan.id,
      status: "draft",
      ownerId: "linh",
      groupId: d.g.id,
      date: THU,
    });
    expect(r.body.spending.total).toBe(60_000);
  });

  it("the owner edits the schedule; spending follows, and a violation preview is shown", async () => {
    const api = mkApi();
    const d = await draft(api);
    // an edit uses real member ids (the model uses refs, the API never does)
    const edited = [
      stop("p1", "09:00", "10:00", [
        { itemId: "p1_m", memberId: "linh", qty: 2 },
        { itemId: "p1_m", memberId: "an", qty: 1 },
      ] as never),
    ];
    const r = await api.as("linh").put(`/plans/${d.plan.id}/stops`, { stops: edited });
    expect(r.status).toBe(200);
    expect(r.body.spending).toEqual({
      perMember: { linh: 60_000, an: 30_000, binh: 0 },
      total: 90_000,
    });
    expect(r.body.violations).toEqual([]);
    const closed = await api
      .as("linh")
      .put(`/plans/${d.plan.id}/stops`, { stops: [stop("closed", "09:00", "10:00", [])] });
    expect(closed.status).toBe(200); // an edit is allowed; Save is where it is refused
    expect(closed.body.violations[0]).toMatchObject({ rule: "V2", code: "outside_opening_hours" });
  });

  it("an edit is checked against the schema: no cost, no total, no empty schedule", async () => {
    const api = mkApi();
    const d = await draft(api);
    for (const stops of [
      [],
      [{ ...GOOD[0], totalCost: 1 }],
      "nope",
      [{ ...GOOD[0], start: "9am" }],
    ]) {
      const r = await api.as("linh").put(`/plans/${d.plan.id}/stops`, { stops });
      expect(r.status, JSON.stringify(stops)).toBe(400);
    }
    expect(api.store.plans.get(d.plan.id)?.stops).toHaveLength(2);
  });

  it("Save shares the schedule with every member of the group", async () => {
    const api = mkApi();
    const d = await draft(api);
    const r = await save(api, d.plan.id);
    expect(r.status).toBe(200);
    expect(r.body.sharedWith).toEqual(["linh", "an", "binh"]);
    for (const user of ["an", "binh"]) {
      const seen = await api.as(user).get(`/plans/${d.plan.id}`);
      expect(seen.status).toBe(200);
      expect(seen.body.status).toBe("saved");
    }
    expect((await api.as("an").get(`/groups/${d.g.id}/plans`)).body.plans).toHaveLength(1);
    expect((await api.as("stranger").get(`/plans/${d.plan.id}`)).status).toBe(404);
  });

  it("pressing Save twice shares one schedule (new key, same key, and at the same time)", async () => {
    const api = mkApi();
    const d = await draft(api);
    const [a, b] = await Promise.all([save(api, d.plan.id, "k1"), save(api, d.plan.id, "k2")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.savedAt).toBe(b.body.savedAt);
    const third = await save(api, d.plan.id, "k1");
    expect(third.headers["idempotent-replayed"]).toBe("true");
    expect((await api.as("an").get(`/groups/${d.g.id}/plans`)).body.plans).toHaveLength(1);
    expect(api.store.plans.size).toBe(1);
  });

  it("a saved plan cannot be edited any more", async () => {
    const api = mkApi();
    const d = await draft(api);
    await save(api, d.plan.id);
    const r = await api.as("linh").put(`/plans/${d.plan.id}/stops`, { stops: GOOD });
    expect(r.status).toBe(409);
    expect(r.body.type).toBe(`${BASE}plan-already-saved`);
  });
});
