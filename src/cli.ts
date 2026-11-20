import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runAgent, type AgentResult, type Model, type Usage, type Warning } from "./agent.js";
import { computeCost } from "./cost.js";
import { loadDataset, loadHolidays, loadWeather, type Forecast, type Holiday } from "./data.js";
import { GeminiModel } from "./gemini.js";
import type { Stop } from "./schedule.js";
import { scheduleTask, shortlistTask, type AgentRequest } from "./tasks.js";
import { createTools, type ToolContext } from "./tools.js";
import type { Violation } from "./validator.js";

/**
 * FORMATS ARE ASSUMED (docs/contract/agent-command.md) until the class brief and travel-eval/README.md are
 * matched. Only the three small functions marked ADAPTER below should need to change.
 */
export interface BatchRequest {
  id: string;
  date: string;
  groupTotal: number;
  preferences: string[];
  members: { id: string; interests: string[]; cap: number | null }[];
}

export interface BatchSummary {
  requests: number;
  ok: number;
  withWarning: number;
  failed: number;
  model: string;
  datasetVersion: string;
  usage: Usage;
  seconds: number;
}

/** ADAPTER: one request line. Throws with the line number so a bad file is easy to fix. */
function parseRequestLine(line: string, n: number): BatchRequest {
  const fail = (why: string) => new Error(`requests file, line ${n}: ${why}`);
  let r: Partial<BatchRequest>;
  try {
    r = JSON.parse(line) as Partial<BatchRequest>;
  } catch {
    throw fail("not valid JSON");
  }
  if (typeof r.id !== "string" || !r.id) throw fail("'id' is required");
  if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date))
    throw fail("'date' must be YYYY-MM-DD");
  if (!Number.isInteger(r.groupTotal)) throw fail("'groupTotal' must be an integer");
  if (!Array.isArray(r.members) || r.members.length === 0)
    throw fail("'members' must be a non-empty list");
  for (const m of r.members) {
    if (typeof m?.id !== "string" || !Array.isArray(m.interests))
      throw fail("each member needs 'id' and 'interests'");
  }
  return {
    id: r.id,
    date: r.date,
    groupTotal: r.groupTotal as number,
    preferences: r.preferences ?? [],
    members: r.members.map((m) => ({ id: m.id, interests: m.interests, cap: m.cap ?? null })),
  };
}

interface PlanRecord {
  id: string;
  date: string;
  stops: Stop[] | null;
  spending: { perMember: Record<string, number>; total: number } | null;
  violations: Violation[];
  warning: Warning | null;
  repairRounds: number;
  toolCalls: number;
  seconds: number;
}

export async function runBatch(opts: {
  dataDir: string;
  requestsFile: string;
  outDir: string;
  modelFactory: () => Model;
}): Promise<BatchSummary> {
  const dataset = loadDataset(opts.dataDir);
  const forecast: Forecast | null = safe(() => loadWeather(opts.dataDir));
  const holidays: Holiday[] = safe(() => loadHolidays(opts.dataDir)) ?? [];
  const lines = readFileSync(opts.requestsFile, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "");
  const requests = lines.map((l, i) => parseRequestLine(l, i + 1)); // fail before any model is called

  mkdirSync(opts.outDir, { recursive: true });
  const plansOut: string[] = [];
  const logOut: string[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let modelName = "none";
  let ok = 0;
  let withWarning = 0;
  let failed = 0;
  const started = Date.now();

  for (const r of requests) {
    const memberIds = r.members.map((m) => m.id);
    const ctx: ToolContext = {
      userId: memberIds[0] as string,
      groupId: `batch-${r.id}`,
      date: r.date,
      memberIds,
      caps: Object.fromEntries(r.members.map((m) => [m.id, m.cap])),
      interests: Object.fromEntries(r.members.map((m) => [m.id, m.interests])),
      groupTotal: r.groupTotal,
      places: dataset.places,
      weather: { getForecast: async () => forecast },
      holidays,
      redactTerms: [],
      seenPlaceIds: new Set(),
    };
    const request: AgentRequest = { date: r.date, preferences: r.preferences };
    const logRun = (phase: string, res: AgentResult<unknown>) => {
      for (const c of res.toolCalls) {
        logOut.push(
          JSON.stringify({
            requestId: r.id,
            phase,
            seq: c.seq,
            name: c.name,
            args: c.args,
            ok: c.ok,
            ms: c.ms,
          }),
        );
      }
      usage.inputTokens += res.usage.inputTokens;
      usage.outputTokens += res.usage.outputTokens;
    };

    let record: PlanRecord;
    try {
      const model1 = opts.modelFactory();
      modelName = model1.name;
      const short = await runAgent({
        model: model1,
        tools: createTools(ctx),
        task: shortlistTask(ctx, request),
      });
      logRun("shortlist", short);
      if (short.draft === null) {
        record = failedRecord(r, short.warning, short.toolCalls.length, short.seconds);
      } else {
        // No human in a batch: the first confirmation keeps everything the agent proposed.
        const ctx2: ToolContext = { ...ctx, seenPlaceIds: new Set() };
        const task = scheduleTask(
          ctx2,
          request,
          { shortlist: short.draft, pinned: [], removed: [] },
          forecast,
        );
        const sched = await runAgent({
          model: opts.modelFactory(),
          tools: createTools(ctx2),
          task,
        });
        logRun("schedule", sched);
        const warning = short.warning ?? sched.warning;
        if (sched.draft === null) {
          record = failedRecord(
            r,
            warning,
            short.toolCalls.length + sched.toolCalls.length,
            short.seconds + sched.seconds,
          );
        } else {
          record = {
            id: r.id,
            date: r.date,
            stops: sched.draft,
            spending: spendingOf(dataset.places, sched.draft, memberIds),
            violations: sched.violations,
            warning,
            repairRounds: short.repairRounds + sched.repairRounds,
            toolCalls: short.toolCalls.length + sched.toolCalls.length,
            seconds: short.seconds + sched.seconds,
          };
        }
      }
    } catch (e) {
      record = failedRecord(
        r,
        { level: "red", limit: "model_error", message: e instanceof Error ? e.message : "failed" },
        0,
        0,
      );
    }
    if (record.stops === null) failed++;
    else if (record.warning === null && record.violations.length === 0) ok++;
    if (record.warning !== null) withWarning++;
    plansOut.push(JSON.stringify(record));
  }

  const summary: BatchSummary = {
    requests: requests.length,
    ok,
    withWarning,
    failed,
    model: modelName,
    datasetVersion: dataset.version,
    usage,
    seconds: (Date.now() - started) / 1000,
  };
  writeFileSync(join(opts.outDir, "plans.jsonl"), plansOut.join("\n") + "\n");
  writeFileSync(join(opts.outDir, "tool-log.jsonl"), logOut.length ? logOut.join("\n") + "\n" : "");
  writeFileSync(join(opts.outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

function failedRecord(
  r: BatchRequest,
  warning: Warning | null,
  toolCalls: number,
  seconds: number,
): PlanRecord {
  return {
    id: r.id,
    date: r.date,
    stops: null,
    spending: null,
    violations: [],
    warning,
    repairRounds: 0,
    toolCalls,
    seconds,
  };
}

function spendingOf(places: ToolContext["places"], stops: Stop[], memberIds: string[]) {
  try {
    return computeCost(places, stops, memberIds);
  } catch {
    return null;
  }
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

interface Io {
  env: Record<string, string | undefined>;
  log: (m: string) => void;
  error: (m: string) => void;
}

/** `npm run agent -- --data <dir> --requests <file> --out <dir>`. Returns the exit code. */
export async function main(argv: string[], io: Io): Promise<number> {
  const opt = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const data = opt("data");
  const requests = opt("requests");
  const out = opt("out");
  const missing = [
    ["--data", data],
    ["--requests", requests],
    ["--out", out],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    io.error(
      `Missing ${missing.join(", ")}. Usage: npm run agent -- --data <dir> --requests <file.jsonl> --out <dir>`,
    );
    return 2;
  }
  const key = io.env.GEMINI_API_KEY;
  if (!key) {
    io.error(
      "GEMINI_API_KEY is not set. Put it in .env (never in git) and run with --env-file=.env.",
    );
    return 2;
  }
  const modelName = io.env.GEMINI_MODEL;
  try {
    const summary = await runBatch({
      dataDir: data as string,
      requestsFile: requests as string,
      outDir: out as string,
      modelFactory: () =>
        new GeminiModel({ apiKey: key, ...(modelName ? { model: modelName } : {}) }),
    });
    io.log(JSON.stringify(summary, null, 2));
    return summary.failed > 0 ? 1 : 0;
  } catch (e) {
    io.error(e instanceof Error ? e.message.replaceAll(key, "[key]") : "failed");
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2), {
    env: process.env,
    log: (m) => console.log(m),
    error: (m) => console.error(m),
  }).then((code) => process.exit(code));
}
