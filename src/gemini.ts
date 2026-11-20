import type { Message, Model, ModelReply } from "./agent.js";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

interface Content {
  role: "user" | "model";
  parts: { text: string }[];
}

/**
 * Model provider for Gemini. The reply protocol is plain JSON (one `{"action":"tool"|"final"}` object per
 * turn), so the loop in agent.ts does not depend on a provider's function-calling format.
 * The key goes in a header: it is never part of a URL, a log line or an error message.
 */
export class GeminiModel implements Model {
  readonly name: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { apiKey: string; model?: string; fetchImpl?: typeof fetch }) {
    if (!opts.apiKey) throw new Error("GeminiModel needs an API key.");
    this.apiKey = opts.apiKey;
    this.name = opts.model ?? "gemini-2.5-flash";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async next(messages: Message[], signal: AbortSignal): Promise<ModelReply> {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const contents: Content[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      const role = m.role === "assistant" ? "model" : "user";
      const text = m.role === "tool" ? `TOOL RESULT: ${m.content}` : m.content;
      const last = contents.at(-1);
      if (last && last.role === role) last.parts.push({ text });
      else contents.push({ role, parts: [{ text }] });
    }

    const res = await this.fetchImpl(`${ENDPOINT}/${this.name}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
      signal,
    });
    // Never include the response body: a provider may echo the request, key included.
    if (!res.ok) throw new Error(`Gemini request failed with status ${res.status}`);

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return {
      step: parseStep(text),
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}

/** Anything that is not a well-formed tool call is handed on as a final answer; the schema then refuses it. */
function parseStep(text: string): ModelReply["step"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "final", output: text };
  }
  const o = parsed as { action?: unknown; name?: unknown; args?: unknown; output?: unknown } | null;
  if (o && typeof o === "object" && !Array.isArray(o)) {
    if (o.action === "tool" && typeof o.name === "string") {
      return { kind: "tool", name: o.name, args: o.args ?? {} };
    }
    if (o.action === "final") return { kind: "final", output: o.output };
  }
  return { kind: "final", output: parsed };
}
