import request from "supertest";
import { describe, expect, it } from "vitest";
import { mkApi, mkGroup } from "./apiHelpers.js";

// docs/contract/groups.md
const BASE = "https://travelplanner.example/problems/";
const problem = (res: request.Response, status: number, slug: string) => {
  expect(res.status).toBe(status);
  expect(res.headers["content-type"]).toContain("application/problem+json");
  expect(res.body.type).toBe(BASE + slug);
};

describe("sign-in", () => {
  it("login gives a token that works as a bearer token", async () => {
    const api = mkApi({ devAuth: false });
    const login = await request(api.app)
      .post("/auth/login")
      .send({ username: "linh", password: "pw-linh" });
    expect(login.status).toBe(200);
    expect(login.body.userId).toBe("linh");
    const me = await request(api.app)
      .post("/groups")
      .set("Authorization", `Bearer ${login.body.token}`)
      .send({ name: "Trip", total: 1000 });
    expect(me.status).toBe(201);
    expect(me.body.ownerId).toBe("linh");
  });

  it("a wrong password is 401 invalid-credentials, and says nothing about which part was wrong", async () => {
    const api = mkApi();
    const bad = await request(api.app)
      .post("/auth/login")
      .send({ username: "linh", password: "nope" });
    problem(bad, 401, "invalid-credentials");
    const ghost = await request(api.app)
      .post("/auth/login")
      .send({ username: "ghost", password: "nope" });
    expect(ghost.body.detail).toBe(bad.body.detail);
  });

  it("with dev sign-in off (the deployment), X-User-Id means nothing", async () => {
    const api = mkApi({ devAuth: false });
    const res = await request(api.app)
      .post("/groups")
      .set("X-User-Id", "linh")
      .send({ name: "T", total: 1 });
    problem(res, 401, "unauthenticated");
  });

  it("a made-up bearer token is 401", async () => {
    const api = mkApi({ devAuth: false });
    const res = await request(api.app)
      .post("/groups")
      .set("Authorization", "Bearer nope")
      .send({ name: "T", total: 1 });
    problem(res, 401, "unauthenticated");
  });
});

describe("creating a group and joining by invite link", () => {
  it("the creator is owner and member and gets the invite token", async () => {
    const api = mkApi();
    const res = await api.as("linh").post("/groups", { name: "Trip", total: 2_000_000 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Trip",
      total: 2_000_000,
      ownerId: "linh",
      memberIds: ["linh"],
    });
    expect(typeof res.body.inviteToken).toBe("string");
  });

  it("a second account joins with the token; joining twice is the same as once", async () => {
    const api = mkApi();
    const g = await api.as("linh").post("/groups", { name: "Trip", total: 1 });
    const first = await api.as("an").post("/groups/join", { token: g.body.inviteToken });
    const again = await api.as("an").post("/groups/join", { token: g.body.inviteToken });
    expect(first.status).toBe(200);
    expect(again.body.memberIds).toEqual(["linh", "an"]);
  });

  it("a bad token is 404 invite-not-found", async () => {
    problem(
      await mkApi().as("an").post("/groups/join", { token: "nope" }),
      404,
      "invite-not-found",
    );
  });

  it("validates name and total", async () => {
    const api = mkApi();
    for (const body of [
      { total: 1 },
      { name: "T" },
      { name: "T", total: -1 },
      { name: "T", total: 1.5 },
      { name: "", total: 1 },
    ]) {
      problem(await api.as("linh").post("/groups", body), 400, "validation-error");
    }
  });

  it("needs sign-in", async () => {
    problem(
      await mkApi().as(null).post("/groups", { name: "T", total: 1 }),
      401,
      "unauthenticated",
    );
  });
});

describe("reading a group", () => {
  it("a member sees the members and their caps; only the owner sees the invite token", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    const owner = await api.as("linh").get(`/groups/${g.id}`);
    const member = await api.as("an").get(`/groups/${g.id}`);
    expect(owner.body.inviteToken).toBe(g.token);
    expect(member.status).toBe(200);
    expect(member.body.inviteToken).toBeUndefined();
    expect(member.body.members).toEqual([
      { userId: "linh", cap: null },
      { userId: "an", cap: null },
      { userId: "binh", cap: null },
    ]);
  });

  it("a stranger or an unknown group is 404 group-not-found", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    problem(await api.as("stranger").get(`/groups/${g.id}`), 404, "group-not-found");
    problem(await api.as("linh").get("/groups/nope"), 404, "group-not-found");
  });
});

describe("P1: a cap is set by its member only", () => {
  it("a member sets their own cap, and can clear it with null", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    const set = await api.as("an").put(`/groups/${g.id}/members/an/cap`, { cap: 300_000 });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ userId: "an", cap: 300_000 });
    expect((await api.as("linh").get(`/groups/${g.id}`)).body.members[1].cap).toBe(300_000);
    const cleared = await api.as("an").put(`/groups/${g.id}/members/an/cap`, { cap: null });
    expect(cleared.body.cap).toBeNull();
  });

  it("changing another member's cap is refused with 403 cap-not-yours, and nothing changes", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    await api.as("an").put(`/groups/${g.id}/members/an/cap`, { cap: 300_000 });
    problem(
      await api.as("binh").put(`/groups/${g.id}/members/an/cap`, { cap: 1 }),
      403,
      "cap-not-yours",
    );
    problem(
      await api.as("linh").put(`/groups/${g.id}/members/an/cap`, { cap: 1 }),
      403,
      "cap-not-yours",
    ); // even the owner
    expect(api.store.groups.get(g.id)?.caps["an"]).toBe(300_000);
  });

  it("a stranger gets 404 first; no sign-in is 401", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    problem(
      await api.as("stranger").put(`/groups/${g.id}/members/an/cap`, { cap: 1 }),
      404,
      "group-not-found",
    );
    problem(
      await api.as(null).put(`/groups/${g.id}/members/an/cap`, { cap: 1 }),
      401,
      "unauthenticated",
    );
  });

  it("refuses a bad cap", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    for (const cap of [-1, 1.5, "x", undefined]) {
      problem(
        await api.as("an").put(`/groups/${g.id}/members/an/cap`, { cap }),
        400,
        "validation-error",
      );
    }
  });
});

describe("the group total", () => {
  it("only the owner changes it", async () => {
    const api = mkApi();
    const g = await mkGroup(api);
    expect((await api.as("linh").put(`/groups/${g.id}/total`, { total: 5_000_000 })).status).toBe(
      200,
    );
    problem(await api.as("an").put(`/groups/${g.id}/total`, { total: 1 }), 403, "not-group-owner");
    expect(api.store.groups.get(g.id)?.total).toBe(5_000_000);
  });
});
