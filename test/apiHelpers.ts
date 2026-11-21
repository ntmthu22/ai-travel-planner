import request from "supertest";
import type { Model } from "../src/agent.js";
import { createApp, type Deps } from "../src/app.js";
import type { Place } from "../src/data.js";
import { Store } from "../src/store.js";
import { mkPlace } from "./fixtures.js";
import { flatForecast } from "./helpers.js";

export const world: Place[] = [
  ...Array.from({ length: 10 }, (_, i) =>
    mkPlace({
      id: `p${i + 1}`,
      name: `Place ${i + 1}`,
      type: i < 5 ? "cafe" : "park",
      district: i % 2 ? "D1" : "D3",
      lat: 10.77 + i * 0.002,
      menu: [{ id: `p${i + 1}_m`, name: "Menu", price: 30_000 }],
    }),
  ),
  mkPlace({ id: "closed", hours: { mon: [{ open: "08:00", close: "22:00" }] } }), // closed on Thursday
  mkPlace({ id: "rainy", outdoor: true, menu: [{ id: "rainy_m", name: "Tea", price: 20_000 }] }),
  mkPlace({ id: "nohours", hours: null }),
];

export const USERS = ["linh", "an", "binh", "stranger"] as const;

export function mkApi(over: Partial<Deps> = {}) {
  const store = new Store();
  for (const id of USERS) {
    store.addUser({
      id,
      name: `Name of ${id}`,
      email: `${id}@example.com`,
      password: `pw-${id}`,
      interests: ["coffee"],
    });
  }
  const models: Model[] = [];
  const app = createApp(store, {
    dataset: { version: "test", places: world },
    weather: { getForecast: async () => flatForecast() },
    holidays: [],
    model: () => {
      const m = models.shift();
      if (!m) throw new Error("no model queued for this run");
      return m;
    },
    ...over,
  });
  const as = (user: string | null) => {
    const withUser = (r: request.Test) => (user ? r.set("X-User-Id", user) : r);
    return {
      get: (url: string) => withUser(request(app).get(url)),
      post: (url: string, body: object = {}) => withUser(request(app).post(url)).send(body),
      put: (url: string, body: object = {}) => withUser(request(app).put(url)).send(body),
    };
  };
  return { store, app, models, as };
}
export type Api = ReturnType<typeof mkApi>;

/** linh creates a group of 3 (linh, an, binh); an and binh join with the invite link. */
export async function mkGroup(api: Api, total = 2_000_000) {
  const created = await api.as("linh").post("/groups", { name: "Trip", total });
  const id = created.body.id as string;
  const token = created.body.inviteToken as string;
  for (const u of ["an", "binh"]) await api.as(u).post("/groups/join", { token });
  return { id, token };
}
