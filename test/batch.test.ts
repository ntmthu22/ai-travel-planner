import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main, runBatch } from "../src/cli.js";
import { FakeModel, final, tool } from "./fakeModel.js";
import { world } from "./apiHelpers.js";
import { flatForecast, THU } from "./helpers.js";

// The agent command: reads requests, runs the two steps for each, writes plans.jsonl, tool-log.jsonl and
// summary.json. docs/contract/agent-command.md. No network: a fake model plays the provider.
const ids8 = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
const jsonl = (path: string) =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

function setup(requests: object[]) {
  const dir = mkdtempSync(join(tmpdir(), "batch-"));
  writeFileSync(join(dir, "dataset.json"), JSON.stringify({ version: "t1", places: world }));
  writeFileSync(join(dir, "weather.json"), JSON.stringify(flatForecast()));
  writeFileSync(join(dir, "holidays.json"), "[]");
  writeFileSync(
    join(dir, "requests.jsonl"),
    requests.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  return { dir, out: join(dir, "out") };
}

const req = (id: string, over = {}) => ({
  id,
  date: THU,
  groupTotal: 1_000_000,
  preferences: ["coffee"],
  members: [
    { id: "u1", interests: ["coffee"], cap: 500_000 },
    { id: "u2", interests: ["parks"], cap: null },
  ],
  ...over,
});
const stops = [
  {
    placeId: "p1",
    start: "09:00",
    end: "10:00",
    items: [{ itemId: "p1_m", memberRef: "m1", qty: 2 }],
  },
  {
    placeId: "p2",
    start: "11:00",
    end: "12:00",
    items: [{ itemId: "p2_m", memberRef: "m2", qty: 1 }],
  },
];
const goodRun = () => [
  new FakeModel([tool("get_profile"), tool("search_places", {}), final({ placeIds: ids8 })]),
  new FakeModel([final({ stops })]),
];

function factory(models: FakeModel[]) {
  const queue = [...models];
  return () => {
    const m = queue.shift();
    if (!m) throw new Error("no model queued");
    return m;
  };
}

describe("runBatch", () => {
  it("writes one plan per request with spending computed by code, and the run totals", async () => {
    const { dir, out } = setup([req("r1"), req("r2")]);
    const summary = await runBatch({
      dataDir: dir,
      requestsFile: join(dir, "requests.jsonl"),
      outDir: out,
      modelFactory: factory([...goodRun(), ...goodRun()]),
    });
    const plans = jsonl(join(out, "plans.jsonl"));
    expect(plans.map((p) => p.id)).toEqual(["r1", "r2"]);
    expect(plans[0].stops[0].items[0]).toEqual({ itemId: "p1_m", memberId: "u1", qty: 2 });
    expect(plans[0].spending).toEqual({ perMember: { u1: 60_000, u2: 30_000 }, total: 90_000 });
    expect(plans[0].violations).toEqual([]);
    expect(plans[0].warning).toBeNull();
    expect(summary).toMatchObject({
      requests: 2,
      ok: 2,
      withWarning: 0,
      failed: 0,
      datasetVersion: "t1",
    });
    expect(JSON.parse(readFileSync(join(out, "summary.json"), "utf8"))).toEqual(summary);
  });

  it("logs every tool call as the model made it, with the request and the step", async () => {
    const { dir, out } = setup([req("r1")]);
    await runBatch({
      dataDir: dir,
      requestsFile: join(dir, "requests.jsonl"),
      outDir: out,
      modelFactory: factory(goodRun()),
    });
    const log = jsonl(join(out, "tool-log.jsonl"));
    expect(log.map((l) => [l.requestId, l.phase, l.seq, l.name])).toEqual([
      ["r1", "shortlist", 1, "get_profile"],
      ["r1", "shortlist", 2, "search_places"],
    ]);
    expect(log[1].args).toEqual({});
    expect(typeof log[0].ms).toBe("number");
  });

  it("the three limits hold in a batch too: a runaway model gets a warning, the batch goes on", async () => {
    const { dir, out } = setup([req("r1"), req("r2")]);
    const runaway = new FakeModel(Array.from({ length: 40 }, () => tool("search_places", {})));
    const summary = await runBatch({
      dataDir: dir,
      requestsFile: join(dir, "requests.jsonl"),
      outDir: out,
      // r1: runaway shortlist, then a normal schedule step; r2: a normal run
      modelFactory: factory([runaway, new FakeModel([final({ stops })]), ...goodRun()]),
    });
    const plans = jsonl(join(out, "plans.jsonl"));
    expect(plans[0].warning.limit).toBe("tool_calls");
    expect(plans[1].warning).toBeNull();
    expect(jsonl(join(out, "tool-log.jsonl")).filter((l) => l.requestId === "r1")).toHaveLength(12);
    expect(summary).toMatchObject({ requests: 2, withWarning: 1 });
  });

  it("a request that fails is recorded with an error and does not stop the others", async () => {
    const { dir, out } = setup([req("r1"), req("r2")]);
    const broken = new FakeModel([
      () => {
        throw new Error("down");
      },
    ]);
    const summary = await runBatch({
      dataDir: dir,
      requestsFile: join(dir, "requests.jsonl"),
      outDir: out,
      modelFactory: factory([broken, ...goodRun()]),
    });
    const plans = jsonl(join(out, "plans.jsonl"));
    expect(plans[0]).toMatchObject({ id: "r1", stops: null });
    expect(plans[0].warning.limit).toBe("model_error");
    expect(plans[1].stops).toHaveLength(2);
    expect(summary.failed).toBe(1);
  });

  it("sums the tokens so a plan's cost can be worked out", async () => {
    const { dir, out } = setup([req("r1")]);
    const summary = await runBatch({
      dataDir: dir,
      requestsFile: join(dir, "requests.jsonl"),
      outDir: out,
      modelFactory: factory(goodRun()),
    });
    expect(summary.usage).toEqual({ inputTokens: 400, outputTokens: 40 }); // 4 model answers x (100, 10)
    expect(summary.model).toBe("fake");
  });

  it("refuses a request line that is not valid, with its line number", async () => {
    const { dir, out } = setup([req("r1")]);
    writeFileSync(join(dir, "requests.jsonl"), '{"id":"x"}\n');
    await expect(
      runBatch({
        dataDir: dir,
        requestsFile: join(dir, "requests.jsonl"),
        outDir: out,
        modelFactory: factory([]),
      }),
    ).rejects.toThrow(/line 1/);
  });
});

describe("main: the command line", () => {
  it("explains a missing option and exits with 2, without touching anything", async () => {
    const errors: string[] = [];
    const code = await main(["--data", "x"], {
      env: {},
      log: () => {},
      error: (m) => errors.push(m),
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("--requests");
  });

  it("explains a missing API key and never prints one", async () => {
    const { dir, out } = setup([req("r1")]);
    const errors: string[] = [];
    const code = await main(
      ["--data", dir, "--requests", join(dir, "requests.jsonl"), "--out", out],
      { env: { OTHER: "KEY-SECRET" }, log: () => {}, error: (m) => errors.push(m) },
    );
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("MODEL_API_KEY");
    expect(errors.join("\n")).not.toContain("KEY-SECRET");
  });
});
