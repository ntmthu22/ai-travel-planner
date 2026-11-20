import { describe, expect, it } from "vitest";
import { runAgent } from "../src/agent.js";
import type { Place } from "../src/data.js";
import { scheduleTask, shortlistTask } from "../src/tasks.js";
import { createTools, type ToolContext } from "../src/tools.js";
import { FakeModel, final, tool } from "./fakeModel.js";
import { mkPlace } from "./fixtures.js";
import { flatForecast, mkToolCtx, THU } from "./helpers.js";

// The two jobs of the agent: propose 8-12 places, then (after the user confirms them) build the schedule.
// docs/contract/agent-tools.md, "Model output".
const world: Place[] = Array.from({ length: 10 }, (_, i) =>
  mkPlace({
    id: `p${i + 1}`,
    name: `Place ${i + 1}`,
    lat: 10.77 + i * 0.002,
    menu: [{ id: `p${i + 1}_m`, name: "Menu", price: 30_000 }],
  }),
);
const ids = (n: number) => world.slice(0, n).map((p) => p.id);
const REQ = { date: THU, preferences: ["street food", "parks"] };

function ctxSeeing(seen: string[], over: Partial<ToolContext> = {}): ToolContext {
  return mkToolCtx({ places: world, seenPlaceIds: new Set(seen), ...over });
}
const checkShort = (c: ToolContext, output: unknown) => {
  const t = shortlistTask(c, REQ);
  const p = t.parse(output);
  return p.ok ? { ok: true as const, violations: t.check(p.value) } : { ok: false as const };
};

describe("the shortlist: 8 to 12 places the agent has actually seen", () => {
  it("accepts 8 and 12 places returned by the tools", () => {
    const c = ctxSeeing(ids(12));
    expect(checkShort(c, { placeIds: ids(8) })).toEqual({ ok: true, violations: [] });
    expect(checkShort(ctxSeeing(ids(10)), { placeIds: ids(10) }).ok).toBe(true);
  });

  it("refuses fewer than 8, more than 12, duplicates and extra keys (schema first)", () => {
    const c = ctxSeeing(ids(10));
    expect(checkShort(c, { placeIds: ids(7) }).ok).toBe(false);
    expect(checkShort(c, { placeIds: [...ids(10), ...ids(10)].slice(0, 13) }).ok).toBe(false);
    expect(checkShort(c, { placeIds: [...ids(7), "p1"] }).ok).toBe(false);
    expect(checkShort(c, { placeIds: ids(8), total: 5 }).ok).toBe(false);
    expect(checkShort(c, ids(8)).ok).toBe(false);
  });

  it("names V1 for a place no tool returned, even if the place exists", () => {
    const r = checkShort(ctxSeeing(ids(7)), { placeIds: ids(8) }); // p8 exists but was never seen
    expect(r.ok && r.violations.map((v) => v.code)).toEqual(["unknown_place"]);
  });

  it("has a code-made fallback of seen places when the model never answers", () => {
    expect(shortlistTask(ctxSeeing(ids(9)), REQ).fallback?.()).toHaveLength(8);
    expect(shortlistTask(ctxSeeing(ids(5)), REQ).fallback?.()).toBeNull();
  });
});

describe("the schedule: built from the confirmed places only", () => {
  const confirmed = (over = {}) => ({
    shortlist: ids(8),
    pinned: ["p1"],
    removed: ["p8"],
    ...over,
  });
  const stop = (p: string, start: string, end: string) => ({
    placeId: p,
    start,
    end,
    items: [{ itemId: `${p}_m`, memberRef: "m1", qty: 1 }],
  });
  const build = (c: ToolContext, output: unknown, conf = confirmed()) => {
    const t = scheduleTask(c, REQ, conf, flatForecast());
    const p = t.parse(output);
    return p.ok
      ? { ok: true as const, value: p.value, violations: t.check(p.value) }
      : { ok: false as const };
  };
  const good = { stops: [stop("p1", "09:00", "10:00"), stop("p2", "11:00", "12:00")] };

  it("maps member refs to real ids and accepts a valid schedule", () => {
    const r = build(ctxSeeing([]), good);
    expect(r.ok && r.violations).toEqual([]);
    expect(r.ok && r.value[0]?.items[0]?.memberId).toBe("linh");
  });

  it("refuses a cost, a total or any extra key from the model", () => {
    expect(build(ctxSeeing([]), { ...good, total: 1 }).ok).toBe(false);
    const withCost = { stops: [{ ...good.stops[0], totalCost: 5 }] };
    expect(build(ctxSeeing([]), withCost).ok).toBe(false);
    const withPrice = {
      stops: [{ ...good.stops[0], items: [{ itemId: "p1_m", memberRef: "m1", qty: 1, price: 1 }] }],
    };
    expect(build(ctxSeeing([]), withPrice).ok).toBe(false);
  });

  it("a pinned place that is missing is refused (pinned_missing)", () => {
    const r = build(ctxSeeing([]), { stops: [stop("p2", "09:00", "10:00")] });
    expect(r.ok && r.violations.map((v) => v.code)).toContain("pinned_missing");
  });

  it("a removed place that is present is refused (removed_present)", () => {
    const r = build(ctxSeeing([]), { stops: [...good.stops, stop("p8", "13:00", "14:00")] });
    expect(r.ok && r.violations.map((v) => v.code)).toContain("removed_present");
  });

  it("a place the user never confirmed is refused (unconfirmed_place)", () => {
    const r = build(ctxSeeing([]), { stops: [...good.stops, stop("p9", "13:00", "14:00")] });
    expect(r.ok && r.violations.map((v) => v.code)).toContain("unconfirmed_place");
  });

  it("runs the validator too: an unknown member ref, a closed hour", () => {
    const badRef = {
      stops: [{ ...good.stops[0], items: [{ itemId: "p1_m", memberRef: "m9", qty: 1 }] }],
    };
    const refused = build(ctxSeeing([]), badRef);
    expect(refused.ok && refused.violations.map((v) => v.code)).toContain("unknown_member");
    const closed = { stops: [stop("p1", "03:00", "04:00")] };
    const r = build(ctxSeeing([]), closed);
    expect(r.ok && r.violations.map((v) => v.code)).toContain("outside_opening_hours");
  });
});

describe("prompts carry places and interests only (R5)", () => {
  it("never contain a name, an email or a member id, even typed inside an interest", () => {
    const c = ctxSeeing([], {
      interests: {
        linh: ["coffee, write to linh@example.com"],
        an: ["Nguyen Thi Linh's favourite park"],
        binh: ["parks"],
      },
    });
    const s = shortlistTask(c, { date: THU, preferences: ["mail an@example.com"] });
    const t = scheduleTask(c, REQ, { shortlist: ids(8), pinned: [], removed: [] }, null);
    for (const prompt of [s.system, s.user, t.system, t.user]) {
      expect(prompt).not.toContain("@");
      expect(prompt).not.toContain("Nguyen");
      expect(prompt).not.toMatch(/\b(linh|binh)\b/);
    }
    expect(s.user).toContain(THU);
    expect(s.user).toContain("mail [redacted]");
  });

  it("tell the model the format and that money only comes from compute_cost", () => {
    const s = shortlistTask(ctxSeeing([]), REQ).system;
    expect(s).toContain("compute_cost");
    expect(s).toContain("placeIds");
    expect(scheduleTask(ctxSeeing([]), REQ, confirmedAll(), null).system).toContain("memberRef");
  });
});

function confirmedAll() {
  return { shortlist: ids(8), pinned: [], removed: [] };
}

describe("end to end with a fake model", () => {
  it("search, then a valid shortlist: the run log shows the tool call and the draft", async () => {
    const c = ctxSeeing([]);
    const model = new FakeModel([tool("search_places", {}), final({ placeIds: ids(8) })]);
    const r = await runAgent({ model, tools: createTools(c), task: shortlistTask(c, REQ) });
    expect(r.draft).toEqual(ids(8));
    expect(r.warning).toBeNull();
    expect(r.toolCalls[0]?.name).toBe("search_places");
  });

  it("the whole run log (prompts and tool results) holds no name or email", async () => {
    const c = ctxSeeing([], {
      interests: { linh: ["write to linh@example.com"], an: ["An Tran likes tea"], binh: [] },
    });
    const model = new FakeModel([
      tool("get_profile"),
      tool("search_places", {}),
      final({ placeIds: ids(8) }),
    ]);
    const r = await runAgent({ model, tools: createTools(c), task: shortlistTask(c, REQ) });
    const log = JSON.stringify(r.messages);
    expect(log).toContain("tea"); // the interest itself is sent
    expect(log).not.toContain("@");
    expect(log).not.toContain("An Tran");
    expect(log).not.toContain("example.com");
  });

  it("a shortlist of places the model made up is repaired, then refused at the limit", async () => {
    const c = ctxSeeing([]);
    const invented = { placeIds: Array.from({ length: 8 }, (_, i) => `ghost${i}`) };
    const model = new FakeModel([final(invented), final(invented), final(invented)]);
    const r = await runAgent({ model, tools: createTools(c), task: shortlistTask(c, REQ) });
    expect(r.warning?.limit).toBe("repair_rounds");
    expect(r.violations.every((v) => v.code === "unknown_place")).toBe(true);
  });
});
