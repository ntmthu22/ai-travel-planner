import { callTool, type ToolSet } from "./tools.js";
import type { Violation } from "./validator.js";

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}
export type ModelStep =
  { kind: "tool"; name: string; args: unknown } | { kind: "final"; output: unknown };
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}
export interface ModelReply {
  step: ModelStep;
  usage?: Usage;
}
/** A model provider. `signal` is aborted when the time limit is reached. */
export interface Model {
  name: string;
  next(messages: Message[], signal: AbortSignal): Promise<ModelReply>;
}

export interface AgentTask<T> {
  system: string;
  user: string;
  /** Checks the model's output against a schema (R2). Runs before any other check. */
  parse(output: unknown): { ok: true; value: T } | { ok: false; error: string };
  /** The validator and the other rules. Empty means the draft is good. */
  check(value: T): Violation[];
  /** A draft made by code, used only when a limit is hit before the model gave a valid one. */
  fallback?(): T | null;
}

export interface Limits {
  maxRepairRounds: number;
  maxToolCalls: number;
  maxSeconds: number;
}
/** The fixed limits of the brief, section 3 (R4). */
export const DEFAULT_LIMITS: Limits = { maxRepairRounds: 2, maxToolCalls: 12, maxSeconds: 90 };

export interface Clock {
  now(): number;
}

export interface ToolLogEntry {
  seq: number;
  name: string;
  /** Exactly as the model made it, even when it was refused. */
  args: unknown;
  ok: boolean;
  result?: unknown;
  error?: string;
  ms: number;
}

export interface Warning {
  level: "red";
  limit: "repair_rounds" | "tool_calls" | "seconds" | "invalid_output" | "model_error";
  message: string;
}

export interface AgentResult<T> {
  draft: T | null;
  violations: Violation[];
  warning: Warning | null;
  repairRounds: number;
  toolCalls: ToolLogEntry[];
  modelCalls: number;
  seconds: number;
  usage: Usage;
  /** The whole conversation: the run log. Contains places and interests only. */
  messages: Message[];
}

const WARNINGS: Record<Warning["limit"], string> = {
  repair_rounds:
    "The agent could not fix every problem in 2 repair rounds. This is its best draft; it is not valid yet.",
  tool_calls: "The agent used its 12 tool calls. This is its best draft; check it before you save.",
  seconds: "The agent ran out of its 90 seconds. This is its best draft; check it before you save.",
  invalid_output:
    "The agent never gave an answer in the right shape. Try again or build it by hand.",
  model_error: "The model could not be reached. This is the best draft so far; try again later.",
};

const clip = (s: string, n = 8000) => (s.length > n ? `${s.slice(0, n)}…[cut]` : s);

function feedback(violations: Violation[]): string {
  return (
    "Your answer was refused by the validator. Fix every problem and answer again in the same format:\n" +
    violations.map((v, i) => `${i + 1}. [${v.rule ?? v.code}] ${v.message}`).join("\n")
  );
}

/**
 * The loop around the model. The limits are enforced here, in code: at most `maxRepairRounds` repair
 * rounds, `maxToolCalls` tool calls and `maxSeconds` seconds. At a limit it stops and returns the best
 * draft it has with a red warning. The caller keeps that draft private until the user presses Save.
 */
export async function runAgent<T>(opts: {
  model: Model;
  tools: ToolSet;
  task: AgentTask<T>;
  limits?: Limits;
  clock?: Clock;
}): Promise<AgentResult<T>> {
  const { model, tools, task } = opts;
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const clock = opts.clock ?? { now: () => Date.now() };
  const started = clock.now();
  const elapsedMs = () => clock.now() - started;

  const messages: Message[] = [
    { role: "system", content: task.system },
    { role: "user", content: task.user },
  ];
  const toolCalls: ToolLogEntry[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let modelCalls = 0;
  let repairRounds = 0;
  let best: { value: T; violations: Violation[] } | null = null;
  let warning: Warning["limit"] | null = null;
  let succeeded = false;

  for (;;) {
    const remainingMs = limits.maxSeconds * 1000 - elapsedMs();
    if (remainingMs <= 0) {
      warning = "seconds";
      break;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);
    let reply: Awaited<ReturnType<Model["next"]>>;
    modelCalls++;
    try {
      reply = await model.next(messages, controller.signal);
    } catch {
      warning =
        controller.signal.aborted || elapsedMs() >= limits.maxSeconds * 1000
          ? "seconds"
          : "model_error";
      break;
    } finally {
      clearTimeout(timer);
    }
    if (reply.usage) {
      usage.inputTokens += reply.usage.inputTokens;
      usage.outputTokens += reply.usage.outputTokens;
    }
    const step = reply.step;

    if (step.kind === "tool") {
      if (toolCalls.length >= limits.maxToolCalls) {
        warning = "tool_calls"; // the 13th request is refused, not executed
        break;
      }
      const t0 = clock.now();
      const res = await callTool(tools, step.name, step.args);
      toolCalls.push({
        seq: toolCalls.length + 1,
        name: step.name,
        args: step.args,
        ok: res.ok,
        ...(res.ok ? { result: res.result } : { error: res.error }),
        ms: clock.now() - t0,
      });
      messages.push(
        {
          role: "assistant",
          content: JSON.stringify({ action: "tool", name: step.name, args: step.args }),
        },
        { role: "tool", content: clip(JSON.stringify(res.ok ? res.result : { error: res.error })) },
      );
      continue;
    }

    messages.push({
      role: "assistant",
      content: clip(JSON.stringify({ action: "final", output: step.output })),
    });
    const parsed = task.parse(step.output);
    let violations: Violation[];
    if (parsed.ok) {
      violations = task.check(parsed.value);
      if (best === null || violations.length < best.violations.length) {
        best = { value: parsed.value, violations };
      }
      if (violations.length === 0) {
        succeeded = true;
        break;
      }
    } else {
      violations = [{ code: "invalid_output", message: parsed.error }];
    }
    if (repairRounds >= limits.maxRepairRounds) {
      warning = best ? "repair_rounds" : "invalid_output";
      break;
    }
    repairRounds++;
    messages.push({ role: "user", content: feedback(violations) });
  }

  let draft: T | null = best?.value ?? null;
  let violations: Violation[] = best?.violations ?? [];
  if (!succeeded && draft === null && task.fallback) {
    draft = task.fallback();
    if (draft !== null) violations = task.check(draft);
  }
  return {
    draft,
    violations,
    warning: warning ? { level: "red", limit: warning, message: WARNINGS[warning] } : null,
    repairRounds,
    toolCalls,
    modelCalls,
    seconds: elapsedMs() / 1000,
    usage,
    messages,
  };
}
