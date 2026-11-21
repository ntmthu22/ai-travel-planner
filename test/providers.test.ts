import { describe, expect, it } from "vitest";
import { GeminiModel } from "../src/gemini.js";
import { OpenMeteoWeather } from "../src/weather.js";

// No network: a fake fetch plays the provider. The API key must never appear in a URL or an error.
const SECRET = "KEY-123-SECRET";
type FetchArgs = { url: string; init: RequestInit };

function fakeFetch(respond: (a: FetchArgs) => { status?: number; body: unknown }) {
  const calls: FetchArgs[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const a = { url: String(url), init: init ?? {} };
    calls.push(a);
    const r = respond(a);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const geminiBody = (text: string) => ({
  candidates: [{ content: { parts: [{ text }] } }],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 15 },
});
const messages = [
  { role: "system" as const, content: "SYS" },
  { role: "user" as const, content: "USER" },
  { role: "assistant" as const, content: '{"action":"tool","name":"get_profile","args":{}}' },
  { role: "tool" as const, content: '{"members":[]}' },
];

describe("GeminiModel", () => {
  it("sends the key in a header, never in the URL, with the system prompt apart and JSON output asked for", async () => {
    const f = fakeFetch(() => ({
      body: geminiBody('{"action":"tool","name":"get_profile","args":{}}'),
    }));
    const model = new GeminiModel({ apiKey: SECRET, fetchImpl: f.impl });
    await model.next(messages, new AbortController().signal);
    const call = f.calls[0]!;
    expect(call.url).toContain("gemini-2.5-flash:generateContent");
    expect(call.url).not.toContain(SECRET);
    expect((call.init.headers as Record<string, string>)["x-goog-api-key"]).toBe(SECRET);
    const sent = JSON.parse(String(call.init.body));
    expect(sent.systemInstruction.parts[0].text).toBe("SYS");
    expect(sent.generationConfig.responseMimeType).toBe("application/json");
    expect(sent.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(sent.contents[2].parts[0].text).toContain("TOOL RESULT");
  });

  it("turns a tool action into a tool step and reports the token usage", async () => {
    const f = fakeFetch(() => ({
      body: geminiBody('{"action":"tool","name":"search_places","args":{"type":"cafe"}}'),
    }));
    const r = await new GeminiModel({ apiKey: SECRET, fetchImpl: f.impl }).next(
      messages,
      new AbortController().signal,
    );
    expect(r.step).toEqual({ kind: "tool", name: "search_places", args: { type: "cafe" } });
    expect(r.usage).toEqual({ inputTokens: 120, outputTokens: 15 });
  });

  it("turns a final action into a final step", async () => {
    const f = fakeFetch(() => ({
      body: geminiBody('{"action":"final","output":{"placeIds":["a"]}}'),
    }));
    const r = await new GeminiModel({ apiKey: SECRET, fetchImpl: f.impl }).next(
      messages,
      new AbortController().signal,
    );
    expect(r.step).toEqual({ kind: "final", output: { placeIds: ["a"] } });
  });

  it("an answer that is not the protocol becomes a final step the schema will refuse (a repair round)", async () => {
    for (const text of ["not json at all", '{"hello":1}', "[]"]) {
      const f = fakeFetch(() => ({ body: geminiBody(text) }));
      const r = await new GeminiModel({ apiKey: SECRET, fetchImpl: f.impl }).next(
        messages,
        new AbortController().signal,
      );
      expect(r.step.kind).toBe("final");
    }
  });

  it("a provider error throws without the key or the response body", async () => {
    const f = fakeFetch(() => ({ status: 429, body: { error: `quota for ${SECRET}` } }));
    const model = new GeminiModel({ apiKey: SECRET, fetchImpl: f.impl });
    const err = await model.next(messages, new AbortController().signal).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("429");
    expect((err as Error).message).not.toContain(SECRET);
  });

  it("passes the abort signal on, so the time limit cuts the request", async () => {
    const f = fakeFetch(() => ({ body: geminiBody('{"action":"final","output":{}}') }));
    const controller = new AbortController();
    await new GeminiModel({ apiKey: SECRET, fetchImpl: f.impl }).next(messages, controller.signal);
    expect(f.calls[0]!.init.signal).toBe(controller.signal);
  });

  it("refuses to start without a key", () => {
    expect(() => new GeminiModel({ apiKey: "" })).toThrow();
  });
});

describe("OpenMeteoWeather", () => {
  const body = {
    hourly: {
      time: ["2026-12-10T08:00", "2026-12-10T09:00"],
      precipitation_probability: [20, 75],
    },
  };

  it("asks for the hourly rain chance of Ho Chi Minh City and maps it", async () => {
    const f = fakeFetch(() => ({ body }));
    const w = new OpenMeteoWeather({ fetchImpl: f.impl });
    const forecast = await w.getForecast();
    expect(forecast?.hourly).toEqual([
      { time: "2026-12-10T08:00", precipProb: 20 },
      { time: "2026-12-10T09:00", precipProb: 75 },
    ]);
    expect(f.calls[0]!.url).toContain("api.open-meteo.com");
    expect(f.calls[0]!.url).toContain("precipitation_probability");
    expect(f.calls[0]!.url).toContain("Asia%2FHo_Chi_Minh");
  });

  it("keeps the answer for a while instead of asking again", async () => {
    const f = fakeFetch(() => ({ body }));
    let now = 0;
    const w = new OpenMeteoWeather({ fetchImpl: f.impl, ttlMs: 1000, now: () => now });
    await w.getForecast();
    now = 500;
    await w.getForecast();
    expect(f.calls).toHaveLength(1);
    now = 1500;
    await w.getForecast();
    expect(f.calls).toHaveLength(2);
  });

  it("an unreachable or broken service is null (no forecast), never an exception, and is not cached", async () => {
    let fail = true;
    const f = fakeFetch(() => (fail ? { status: 503, body: {} } : { body }));
    const w = new OpenMeteoWeather({ fetchImpl: f.impl });
    expect(await w.getForecast()).toBeNull();
    fail = false;
    expect((await w.getForecast())?.hourly).toHaveLength(2);
    const garbage = new OpenMeteoWeather({
      fetchImpl: fakeFetch(() => ({ body: { nope: 1 } })).impl,
    });
    expect(await garbage.getForecast()).toBeNull();
  });
});
