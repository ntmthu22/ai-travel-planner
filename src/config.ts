import type { Model } from "./agent.js";
import type { Deps } from "./app.js";
import { loadDataset, loadHolidays, loadWeather } from "./data.js";
import { GeminiModel } from "./gemini.js";
import type { WeatherSource } from "./tools.js";
import { OpenMeteoWeather } from "./weather.js";

type Env = Record<string, string | undefined>;

export interface Config {
  port: number;
  deps: Partial<Deps>;
  seedUsers: { id: string; password: string }[];
}

/**
 * The model for the names in .env.example (MODEL_PROVIDER, MODEL_NAME, MODEL_API_KEY).
 * null means no key is set. The key is read here and goes nowhere else.
 */
export function modelFromEnv(env: Env): (() => Model) | null {
  const provider = env.MODEL_PROVIDER || "gemini";
  if (provider !== "gemini") {
    throw new Error(`MODEL_PROVIDER '${provider}' is not supported (use 'gemini').`);
  }
  const apiKey = env.MODEL_API_KEY;
  if (!apiKey) return null;
  const model = env.MODEL_NAME;
  return () => new GeminiModel({ apiKey, ...(model ? { model } : {}) });
}

function parseSeedUsers(raw: string | undefined): Config["seedUsers"] {
  if (!raw || raw.trim() === "") return [];
  return raw.split(",").map((pair) => {
    const [id, ...rest] = pair.trim().split(":");
    const password = rest.join(":");
    if (!id || !password) throw new Error("SEED_USERS must look like 'id:password,id:password'.");
    return { id, password };
  });
}

export function loadConfig(env: Env): Config {
  const dir = env.DATA_DIR || "data/sample";
  let dataset;
  let holidays;
  try {
    dataset = loadDataset(dir);
    holidays = (() => {
      try {
        return loadHolidays(dir);
      } catch {
        return [];
      }
    })();
  } catch {
    throw new Error(`Cannot read dataset.json from DATA_DIR '${dir}'.`);
  }

  let weather: WeatherSource = new OpenMeteoWeather();
  if (env.WEATHER_SOURCE === "file") {
    const forecast = loadWeather(dir);
    weather = { getForecast: async () => forecast };
  }

  const production = env.NODE_ENV === "production";
  return {
    port: Number(env.PORT || 3000),
    seedUsers: parseSeedUsers(env.SEED_USERS),
    deps: {
      dataset,
      holidays,
      weather,
      model: modelFromEnv(env),
      // The deployment never accepts the development X-User-Id sign-in, whatever DEV_AUTH says.
      devAuth: !production,
    },
  };
}
