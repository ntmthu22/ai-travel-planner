import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, runAgent, type AgentTask } from "../src/agent.js";
import { createTools } from "../src/tools.js";
import { FakeModel, final, tool } from "./fakeModel.js";
import { mkToolCtx } from "./helpers.js";

// The three limits of the brief (2 repair rounds, 12 tool calls, 90 seconds) and the loop around the model.
// Every test uses a fake model and no network. docs/contract/agent-tools.md.
interface Draft {
  n: number; // how many violations this draft has
}

const task: AgentTask<Draft> = {
  system: "SYSTEM PROMPT",
  user: "USER PROMPT",
  parse: (o) => {
    const n = (o as { n?: unknown } | null)?.n;
    return typeof n === "number" ? { ok: true, value: { n } } : { ok: false, error: "no n" };
  },
  check: (d) =>
    Array.from({ length: d.n }, (_, i) => ({ code: "x", message: `problem number ${i + 1}` })),
};

const run = (model: FakeModel, over: Partial<Parameters<typeof runAgent<Draft>>[0]> = {}) =>
  runAgent<Draft>({ model, tools: createTools(mkToolCtx()), task, ...over });

describe("the limits are 2, 12 and 90", () => {
  it("by default", () => {
    expect(DEFAULT_LIMITS).toEqual({ maxRepairRounds: 2, maxToolCalls: 12, maxSeconds: 90 });
  });
});

describe("a normal run", () => {
  it("calls a tool, then returns the draft with no warning", async () => {
    const model = new FakeModel([tool("search_places", { type: "park" }), final({ n: 0 })]);
    const r = await run(model);
    expect(r.draft).toEqual({ n: 0 });
    expect(r.warning).toBeNull();
    expect(r.violations).toEqual([]);
    expect(r.repairRounds).toBe(0);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.usage).toEqual({ inputTokens: 200, outputTokens: 20 });
  });

  it("logs each tool call as the model made it, including a refused one", async () => {
    const model = new FakeModel([
      tool("get_profile", { userId: "an" }),
      tool("no_such_tool", { a: 1 }),
      final({ n: 0 }),
    ]);
    const r = await run(model);
    expect(r.toolCalls.map((c) => [c.name, c.args, c.ok])).toEqual([
      ["get_profile", { userId: "an" }, false],
      ["no_such_tool", { a: 1 }, false],
    ]);
    expect(r.toolCalls.map((c) => c.seq)).toEqual([1, 2]);
  });

  it("gives the model its prompts and the tool results", async () => {
    const model = new FakeModel([tool("get_profile"), final({ n: 0 })]);
    await run(model);
    const second = model.seen[1]!;
    expect(second[0]).toMatchObject({ role: "system", content: "SYSTEM PROMPT" });
    expect(second[1]).toMatchObject({ role: "user", content: "USER PROMPT" });
    expect(second.at(-1)?.role).toBe("tool");
    expect(second.at(-1)?.content).toContain("m1");
  });
});

describe("limit 1: at most 12 tool calls", () => {
  it("executes 12, refuses the 13th, and returns the best draft with a red warning", async () => {
    const script = [final({ n: 1 }), ...Array.from({ length: 30 }, () => tool("get_profile"))];
    const model = new FakeModel(script);
    const r = await run(model);
    expect(r.toolCalls).toHaveLength(12);
    expect(model.calls).toBe(14); // 1 final + 12 executed + the 13th request that was refused
    expect(r.warning).toMatchObject({ level: "red", limit: "tool_calls" });
    expect(r.draft).toEqual({ n: 1 });
  });

  it("stops even when the model only ever calls tools and never answers", async () => {
    const model = new FakeModel(Array.from({ length: 50 }, () => tool("get_profile")));
    const r = await run(model);
    expect(r.toolCalls).toHaveLength(12);
    expect(r.warning?.limit).toBe("tool_calls");
    expect(r.draft).toBeNull();
  });

  it("uses the task fallback when there is no draft yet, still with the warning", async () => {
    const model = new FakeModel(Array.from({ length: 50 }, () => tool("get_profile")));
    const r = await run(model, { task: { ...task, fallback: () => ({ n: 7 }) } });
    expect(r.draft).toEqual({ n: 7 });
    expect(r.warning?.limit).toBe("tool_calls");
  });

  it("counts a refused or failing call too", async () => {
    const model = new FakeModel(
      Array.from({ length: 50 }, () => tool("get_place", { placeId: "x" })),
    );
    const r = await run(model);
    expect(r.toolCalls).toHaveLength(12);
  });
});

describe("limit 2: at most 2 repair rounds", () => {
  it("allows the first answer plus two repairs, then returns the best draft with a warning", async () => {
    const model = new FakeModel([
      final({ n: 3 }),
      final({ n: 1 }),
      final({ n: 2 }),
      final({ n: 0 }),
    ]);
    const r = await run(model);
    expect(model.calls).toBe(3); // the fourth answer is never asked for
    expect(r.repairRounds).toBe(2);
    expect(r.warning).toMatchObject({ level: "red", limit: "repair_rounds" });
    expect(r.draft).toEqual({ n: 1 }); // the best of the three, not the last
    expect(r.violations).toHaveLength(1);
  });

  it("stops at once when a repair succeeds", async () => {
    const model = new FakeModel([final({ n: 2 }), final({ n: 0 })]);
    const r = await run(model);
    expect(r.repairRounds).toBe(1);
    expect(r.warning).toBeNull();
    expect(r.draft).toEqual({ n: 0 });
  });

  it("tells the model what was wrong so it can repair", async () => {
    const model = new FakeModel([final({ n: 2 }), final({ n: 0 })]);
    await run(model);
    const last = model.seen[1]!.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toContain("problem number 1");
    expect(last.content).toContain("problem number 2");
  });

  it("an answer that does not fit the schema is a failed round, not a draft", async () => {
    const model = new FakeModel([final({ totalCost: 5 }), final({ n: 0 })]);
    const r = await run(model);
    expect(r.repairRounds).toBe(1);
    expect(r.draft).toEqual({ n: 0 });
  });

  it("with no valid answer at all, warns with invalid_output and has no draft", async () => {
    const model = new FakeModel([final("x"), final("y"), final("z"), final({ n: 0 })]);
    const r = await run(model);
    expect(r.draft).toBeNull();
    expect(r.warning).toMatchObject({ level: "red", limit: "invalid_output" });
    expect(model.calls).toBe(3);
  });
});

describe("limit 3: at most 90 seconds", () => {
  it("stops between steps once the time is spent (fake clock)", async () => {
    let now = 0;
    const clock = { now: () => now };
    const slow = () => {
      now += 40_000;
      return tool("get_profile");
    };
    const model = new FakeModel([final({ n: 1 }), slow, slow, slow, slow, slow]);
    // the first final costs no time; each tool step costs 40 s: 0, 40, 80 are allowed, 120 is not
    const r = await run(model, { clock });
    expect(r.warning).toMatchObject({ level: "red", limit: "seconds" });
    expect(r.draft).toEqual({ n: 1 });
    expect(model.calls).toBeLessThanOrEqual(4);
    expect(r.seconds).toBeGreaterThanOrEqual(90);
  });

  it("cuts a model call that never returns (real timer, tiny limit)", async () => {
    const hang = (_m: unknown, signal: AbortSignal) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const model = new FakeModel([hang]);
    const started = Date.now();
    const r = await run(model, { limits: { ...DEFAULT_LIMITS, maxSeconds: 0.05 } });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(r.warning).toMatchObject({ level: "red", limit: "seconds" });
  });
});

describe("a failing model", () => {
  it("is a red warning with the best draft so far, never an exception", async () => {
    const model = new FakeModel([
      final({ n: 1 }),
      () => {
        throw new Error("503 from provider");
      },
    ]);
    const r = await run(model);
    expect(r.warning).toMatchObject({ level: "red", limit: "model_error" });
    expect(r.draft).toEqual({ n: 1 });
    expect(JSON.stringify(r.warning)).not.toContain("503"); // no provider detail to the user
  });
});
