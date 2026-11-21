import { describe, expect, it } from "vitest";
import { mkApi } from "./apiHelpers.js";

// docs/contract/profile.md
describe("my interests", () => {
  it("starts with what the account has, and GET /me never shows a name or an email", async () => {
    const r = await mkApi().as("linh").get("/me");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: "linh", interests: ["coffee"] });
  });

  it("replaces the list, trims, removes duplicates", async () => {
    const api = mkApi();
    const r = await api
      .as("an")
      .put("/me/interests", { interests: [" street food ", "parks", "parks"] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: "an", interests: ["street food", "parks"] });
    expect(api.store.users.get("an")?.interests).toEqual(["street food", "parks"]);
    expect(api.store.users.get("linh")?.interests).toEqual(["coffee"]); // nobody else changed
  });

  it("refuses more than 10, an empty or long string, and a non-list", async () => {
    const api = mkApi();
    for (const interests of [
      Array(11).fill("x"),
      [""],
      ["x".repeat(41)],
      "coffee",
      [1],
      undefined,
    ]) {
      const r = await api.as("an").put("/me/interests", { interests });
      expect(r.status, JSON.stringify(interests)).toBe(400);
    }
    expect(api.store.users.get("an")?.interests).toEqual(["coffee"]);
  });

  it("needs sign-in", async () => {
    expect((await mkApi().as(null).get("/me")).status).toBe(401);
    expect((await mkApi().as(null).put("/me/interests", { interests: [] })).status).toBe(401);
  });

  it("stores what was typed as it is: the redaction happens when the agent reads it (tools.test.ts)", async () => {
    const api = mkApi();
    await api.as("linh").put("/me/interests", { interests: ["write to linh@example.com"] });
    expect(api.store.users.get("linh")?.interests).toEqual(["write to linh@example.com"]);
  });
});
