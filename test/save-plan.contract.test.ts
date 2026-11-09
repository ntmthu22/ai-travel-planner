import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";

// These tests encode docs/contract/save-plan.md. Change the contract first, then the tests.
const BASE = "https://travelplanner.example/problems/";
let store: Store;
let app: ReturnType<typeof createApp>;

const save = (
  planId: string,
  user: string | null,
  key: string | null,
  body: object = { confirmed: true },
) => {
  let r = request(app).post(`/plans/${planId}/save`);
  if (user) r = r.set("X-User-Id", user);
  if (key) r = r.set("Idempotency-Key", key);
  return r.send(body);
};

function expectProblem(res: request.Response, status: number, slug: string) {
  expect(res.status).toBe(status);
  expect(res.headers["content-type"]).toContain("application/problem+json");
  expect(res.body.type).toBe(BASE + slug);
  expect(res.body.status).toBe(status);
  expect(typeof res.body.title).toBe("string");
}

beforeEach(() => {
  store = new Store();
  app = createApp(store);
  store.addPlan({
    id: "p1",
    ownerId: "linh",
    memberIds: ["linh", "an"],
    status: "draft",
    totalCost: 800_000,
    groupTotal: 4_000_000,
  });
  store.addPlan({
    id: "over",
    ownerId: "linh",
    memberIds: ["linh", "an"],
    status: "draft",
    totalCost: 5_000_000,
    groupTotal: 4_000_000,
  });
});

describe("POST /plans/{planId}/save: success", () => {
  it("saves a valid draft and shares it with the group", async () => {
    const res = await save("p1", "linh", "k1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "p1", status: "saved", sharedWith: ["linh", "an"] });
    expect(typeof res.body.savedAt).toBe("string");
  });
});

describe("idempotency", () => {
  it("replays the same response for the same key and body", async () => {
    const first = await save("p1", "linh", "k1");
    const again = await save("p1", "linh", "k1");
    expect(again.status).toBe(200);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.body).toEqual(first.body);
  });

  it("is safe to repeat with a new key: same savedAt, no second save", async () => {
    const first = await save("p1", "linh", "k1");
    const again = await save("p1", "linh", "k2");
    expect(again.status).toBe(200);
    expect(again.body.savedAt).toBe(first.body.savedAt);
  });

  it("rejects the same key with a different body (422 idempotency-key-reuse)", async () => {
    await save("p1", "linh", "k1", { confirmed: true });
    const res = await save("p1", "linh", "k1", { confirmed: true, note: "different" });
    expectProblem(res, 422, "idempotency-key-reuse");
  });
});

describe("errors (RFC 9457)", () => {
  it("401 unauthenticated without X-User-Id", async () => {
    expectProblem(await save("p1", null, "k1"), 401, "unauthenticated");
  });

  it("404 plan-not-found for an unknown plan", async () => {
    expectProblem(await save("nope", "linh", "k1"), 404, "plan-not-found");
  });

  it("404 (not 403) for a user outside the group: no existence leak", async () => {
    expectProblem(await save("p1", "stranger", "k1"), 404, "plan-not-found");
  });

  it("403 not-plan-owner for a group member who is not the owner", async () => {
    expectProblem(await save("p1", "an", "k1"), 403, "not-plan-owner");
  });

  it("400 validation-error when Idempotency-Key is missing", async () => {
    expectProblem(await save("p1", "linh", null), 400, "validation-error");
  });

  it("400 validation-error when confirmed is not true", async () => {
    expectProblem(await save("p1", "linh", "k1", { confirmed: false }), 400, "validation-error");
  });

  it("422 plan-violates-constraints when the validator rejects, and nothing is shared", async () => {
    const res = await save("over", "linh", "k1");
    expectProblem(res, 422, "plan-violates-constraints");
    expect(res.body.violations[0].code).toBe("over_group_total");
    expect(store.plans.get("over")?.status).toBe("draft");
  });
});

describe("request validation (contract section 2)", () => {
  it("400 validation-error when the body is not valid JSON", async () => {
    const res = await request(app)
      .post("/plans/p1/save")
      .set("X-User-Id", "linh")
      .set("Idempotency-Key", "k1")
      .set("Content-Type", "application/json")
      .send("{not json");
    expectProblem(res, 400, "validation-error");
  });

  it("400 validation-error when note is longer than 200 characters", async () => {
    const res = await save("p1", "linh", "k1", { confirmed: true, note: "x".repeat(201) });
    expectProblem(res, 400, "validation-error");
    expect(store.plans.get("p1")?.status).toBe("draft");
  });

  it("accepts a note of exactly 200 characters", async () => {
    const res = await save("p1", "linh", "k1", { confirmed: true, note: "x".repeat(200) });
    expect(res.status).toBe(200);
  });

  it("400 validation-error when note is not a string", async () => {
    expectProblem(
      await save("p1", "linh", "k1", { confirmed: true, note: 5 }),
      400,
      "validation-error",
    );
  });

  it("400 validation-error when Idempotency-Key is longer than 128 characters", async () => {
    expectProblem(await save("p1", "linh", "k".repeat(129)), 400, "validation-error");
    expect((await save("p1", "linh", "k".repeat(128))).status).toBe(200);
  });
});

describe("routes and order of checks", () => {
  it("404 route-not-found for an unknown route", async () => {
    const res = await request(app).get("/nothing-here");
    expectProblem(res, 404, "route-not-found");
  });

  it("401 comes before 404: an unsigned caller learns nothing about a plan", async () => {
    expectProblem(await save("nope", null, "k1"), 401, "unauthenticated");
  });

  it("403 comes before request validation: a non-owner without a key still gets 403", async () => {
    expectProblem(await save("p1", "an", null), 403, "not-plan-owner");
  });

  it("404 comes before request validation: a stranger without a key still gets 404", async () => {
    expectProblem(await save("p1", "stranger", null), 404, "plan-not-found");
  });
});

describe("idempotency: failed attempts are not recorded (contract section 5)", () => {
  it("a 422 is not replayed: the same key succeeds once the plan is fixed", async () => {
    expectProblem(await save("over", "linh", "k1"), 422, "plan-violates-constraints");
    const plan = store.plans.get("over");
    if (!plan) throw new Error("fixture missing");
    plan.totalCost = 1_000_000;
    const retry = await save("over", "linh", "k1");
    expect(retry.status).toBe(200);
    expect(retry.headers["idempotent-replayed"]).toBeUndefined();
    expect(retry.body.status).toBe("saved");
  });

  it("the same key on another plan is a separate save, not a replay", async () => {
    await save("p1", "linh", "shared-key");
    store.addPlan({
      id: "p2",
      ownerId: "linh",
      memberIds: ["linh"],
      status: "draft",
      totalCost: 1,
      groupTotal: 2,
    });
    const res = await save("p2", "linh", "shared-key");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("p2");
    expect(res.headers["idempotent-replayed"]).toBeUndefined();
  });
});
