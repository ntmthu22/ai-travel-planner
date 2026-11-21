import { describe, expect, it } from "vitest";
import { mkApi } from "./apiHelpers.js";

// docs/contract/search.md
const get = (qs: string) => mkApi().as(null).get(`/places${qs}`);
const idsOf = (res: { body: { places: { id: string }[] } }) => res.body.places.map((p) => p.id);

describe("GET /places", () => {
  it("is public and lists places with the summary fields", async () => {
    const res = await get("");
    expect(res.status).toBe(200);
    expect(res.body.places[0]).toEqual({
      id: "p1",
      name: "Place 1",
      type: "cafe",
      district: "D3",
      priceLevel: 1,
      ticketPrice: 0,
      outdoor: false,
    });
  });

  it("filters by type, district and price level", async () => {
    expect(idsOf(await get("?type=park"))).toEqual(["p6", "p7", "p8", "p9", "p10"]);
    expect(idsOf(await get("?district=D1&type=cafe"))).toEqual([
      "p2",
      "p4",
      "closed",
      "rainy",
      "nohours",
    ]);
    expect((await get("?priceLevel=2")).body.places).toEqual([]);
  });

  it("filters by day and time: closed on Thursday means not found", async () => {
    expect(idsOf(await get("?day=thu&time=09:00"))).not.toContain("closed");
    expect(idsOf(await get("?day=mon&time=09:00"))).toContain("closed");
    expect(idsOf(await get("?day=mon&time=23:00"))).not.toContain("closed");
  });

  it("answers 400 for a time without a day, a bad day, a bad time or a bad price level", async () => {
    for (const qs of [
      "?time=09:00",
      "?day=mon",
      "?day=funday&time=09:00",
      "?day=mon&time=9am",
      "?priceLevel=9",
      "?priceLevel=x",
    ]) {
      const res = await get(qs);
      expect(res.status, qs).toBe(400);
      expect(res.body.type).toBe("https://travelplanner.example/problems/validation-error");
    }
  });
});

describe("GET /places/{id}", () => {
  it("gives the detail with the menu with prices, and the credits", async () => {
    const res = await mkApi().as(null).get("/places/p1");
    expect(res.status).toBe(200);
    expect(res.body.menu).toEqual([{ id: "p1_m", name: "Menu", price: 30_000 }]);
    expect(res.body.hours.mon).toEqual([{ open: "08:00", close: "22:00" }]);
    expect(res.body.credits.map((c: { name: string }) => c.name)).toEqual([
      "OpenStreetMap",
      "Wikimedia",
      "Open-Meteo",
    ]);
  });

  it("is 404 place-not-found for an unknown place", async () => {
    const res = await mkApi().as(null).get("/places/nope");
    expect(res.status).toBe(404);
    expect(res.body.type).toBe("https://travelplanner.example/problems/place-not-found");
  });
});
