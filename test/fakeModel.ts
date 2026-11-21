import type { Message, Model, ModelReply, ModelStep } from "../src/agent.js";

type Script = (
  ModelStep | ((messages: Message[], signal: AbortSignal) => Promise<ModelStep> | ModelStep)
)[];

/** A model with no network: plays a fixed script. Running past the end of the script fails loudly. */
export class FakeModel implements Model {
  readonly name = "fake";
  calls = 0;
  seen: Message[][] = [];
  constructor(
    private script: Script,
    private usage = { inputTokens: 100, outputTokens: 10 },
  ) {}

  async next(messages: Message[], signal: AbortSignal): Promise<ModelReply> {
    this.seen.push(messages.map((m) => ({ ...m })));
    const entry = this.script[this.calls++];
    if (entry === undefined) throw new Error("fake model script exhausted");
    const step = typeof entry === "function" ? await entry(messages, signal) : entry;
    return { step, usage: this.usage };
  }
}

export const tool = (name: string, args: unknown = {}): ModelStep => ({ kind: "tool", name, args });
export const final = (output: unknown): ModelStep => ({ kind: "final", output });
