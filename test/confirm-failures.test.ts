import { describe, expect, it } from "vitest";
import { mkApi, mkGroup } from "./apiHelpers.js";
import { FakeModel, final, tool } from "./fakeModel.js";
import { THU } from "./helpers.js";

// When the agent cannot give any schedule at all, the proposal stays open so the user can try again.
const BASE = "https://travelplanner.example/problems/";
const ids = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
const GOOD = [
  {
    placeId: "p1",
    start: "09:00",
    end: "10:00",
    items: [{ itemId: "p1_m", memberRef: "m1", qty: 1 }],
  },
];

async function proposed() {
  const api = mkApi();
  const g = await mkGroup(api);
  api.models.push(new FakeModel([tool("search_places"), final({ placeIds: ids })]));
  const prop = await api.as("linh").post(`/groups/${g.id}/proposals`, { date: THU });
  return { api, g, id: prop.body.id as string };
}

describe("confirm when the agent gives nothing usable", () => {
  it("answers 502 agent-failed with the red warning, makes no plan, and can be retried", async () => {
    const { api, id } = await proposed();
    api.models.push(new FakeModel([final("x"), final("y"), final("z")]));
    const r = await api.as("linh").post(`/proposals/${id}/confirm`, { pinned: [], removed: [] });
    expect(r.status).toBe(502);
    expect(r.body.type).toBe(`${BASE}agent-failed`);
    expect(r.body.warning).toMatchObject({ level: "red", limit: "invalid_output" });
    expect(api.store.plans.size).toBe(0);
    expect(api.store.proposals.get(id)?.status).toBe("awaiting_place_confirmation");

    api.models.push(new FakeModel([final({ stops: GOOD })]));
    const again = await api
      .as("linh")
      .post(`/proposals/${id}/confirm`, { pinned: [], removed: [] });
    expect(again.status).toBe(201);
  });

  it("a model that cannot be reached is the same 502, without provider detail", async () => {
    const { api, id } = await proposed();
    api.models.push(
      new FakeModel([
        () => {
          throw new Error("upstream 500 secret-host");
        },
      ]),
    );
    const r = await api.as("linh").post(`/proposals/${id}/confirm`, { pinned: [], removed: [] });
    expect(r.status).toBe(502);
    expect(r.body.warning.limit).toBe("model_error");
    expect(JSON.stringify(r.body)).not.toContain("secret-host");
  });

  it("answers 503 and keeps the proposal open when no model is configured", async () => {
    const { api, id } = await proposed();
    const off = mkApi({ model: null });
    off.store.proposals.set(id, { ...api.store.proposals.get(id)! });
    off.store.groups.set(...([...api.store.groups.entries()][0] as [string, never]));
    const r = await off.as("linh").post(`/proposals/${id}/confirm`, { pinned: [], removed: [] });
    expect(r.status).toBe(503);
    expect(off.store.proposals.get(id)?.status).toBe("awaiting_place_confirmation");
  });
});
