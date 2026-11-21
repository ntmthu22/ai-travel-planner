import type { Forecast } from "./data.js";
import type { WeatherSource } from "./tools.js";

/** Ho Chi Minh City. */
const LAT = 10.7769;
const LNG = 106.7009;

/**
 * Live 7-day hourly rain chance from Open-Meteo (credited in the app). Any failure is `null`
 * (no forecast), which the validator treats as "cannot say", and a failure is never cached.
 */
export class OpenMeteoWeather implements WeatherSource {
  private cached: { at: number; forecast: Forecast } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: { fetchImpl?: typeof fetch; ttlMs?: number; now?: () => number } = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.ttlMs = opts.ttlMs ?? 30 * 60 * 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  async getForecast(): Promise<Forecast | null> {
    if (this.cached && this.now() - this.cached.at < this.ttlMs) return this.cached.forecast;
    try {
      const url =
        "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${LAT}&longitude=${LNG}&hourly=precipitation_probability` +
        `&timezone=${encodeURIComponent("Asia/Ho_Chi_Minh")}&forecast_days=7`;
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        hourly?: { time?: string[]; precipitation_probability?: (number | null)[] };
      };
      const times = data.hourly?.time;
      const probs = data.hourly?.precipitation_probability;
      if (!Array.isArray(times) || !Array.isArray(probs)) return null;
      const forecast: Forecast = {
        hourly: times.flatMap((time, i) => {
          const p = probs[i];
          return typeof p === "number" ? [{ time, precipProb: p }] : [];
        }),
      };
      this.cached = { at: this.now(), forecast };
      return forecast;
    } catch {
      return null;
    }
  }
}
