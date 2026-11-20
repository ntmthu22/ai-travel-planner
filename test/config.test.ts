import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { GeminiModel } from "../src/gemini.js";
import { world } from "./apiHelpers.js";
import { flatForecast } from "./helpers.js";

// How the server is put together from the environment (.env.example). The deployment is production:
// no development sign-in, no secret in the code.
function dataDir() {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  writeFileSync(join(dir, "dataset.json"), JSON.stringify({ version: "v9", places: world }));
  writeFileSync(join(dir, "weather.json"), JSON.stringify(flatForecast()));
  writeFileSync(join(dir, "holidays.json"), '[{"date":"2026-12-25","name":"Christmas"}]');
  return dir;
}

describe("loadConfig", () => {
  it("loads the dataset and the holidays from DATA_DIR", () => {
    const c = loadConfig({ DATA_DIR: dataDir() });
    expect(c.deps.dataset?.version).toBe("v9");
    expect(c.deps.dataset?.places).toHaveLength(world.length);
    expect(c.deps.holidays).toEqual([{ date: "2026-12-25", name: "Christmas" }]);
  });

  it("explains a missing dataset by naming DATA_DIR", () => {
    expect(() => loadConfig({ DATA_DIR: join(tmpdir(), "does-not-exist-xyz") })).toThrow(
      /DATA_DIR/,
    );
  });

  it("turns the development sign-in off in production, even if DEV_AUTH asks for it", () => {
    const base = { DATA_DIR: dataDir() };
    expect(loadConfig({ ...base }).deps.devAuth).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: "production" }).deps.devAuth).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: "production", DEV_AUTH: "1" }).deps.devAuth).toBe(false);
  });

  it("has no model without a key, and a Gemini model with one", () => {
    const base = { DATA_DIR: dataDir() };
    expect(loadConfig({ ...base }).deps.model).toBeNull();
    const withKey = loadConfig({
      ...base,
      MODEL_PROVIDER: "gemini",
      MODEL_API_KEY: "k",
      MODEL_NAME: "gemini-x",
    });
    const model = withKey.deps.model!();
    expect(model).toBeInstanceOf(GeminiModel);
    expect(model.name).toBe("gemini-x");
  });

  it("refuses an unknown provider instead of guessing", () => {
    expect(() =>
      loadConfig({ DATA_DIR: dataDir(), MODEL_PROVIDER: "mystery", MODEL_API_KEY: "k" }),
    ).toThrow(/MODEL_PROVIDER/);
  });

  it("reads the forecast from weather.json when WEATHER_SOURCE=file, otherwise asks Open-Meteo", async () => {
    const dir = dataDir();
    const fromFile = await loadConfig({
      DATA_DIR: dir,
      WEATHER_SOURCE: "file",
    }).deps.weather!.getForecast();
    expect(fromFile?.hourly).toHaveLength(24);
    expect(loadConfig({ DATA_DIR: dir }).deps.weather).toBeDefined();
  });

  it("parses SEED_USERS (id:password pairs) and refuses a malformed list", () => {
    const base = { DATA_DIR: dataDir() };
    expect(loadConfig({ ...base, SEED_USERS: "linh:pw1, an:pw2" }).seedUsers).toEqual([
      { id: "linh", password: "pw1" },
      { id: "an", password: "pw2" },
    ]);
    expect(loadConfig({ ...base }).seedUsers).toEqual([]);
    expect(() => loadConfig({ ...base, SEED_USERS: "linh" })).toThrow(/SEED_USERS/);
  });

  it("uses PORT, defaulting to 3000", () => {
    const base = { DATA_DIR: dataDir() };
    expect(loadConfig({ ...base }).port).toBe(3000);
    expect(loadConfig({ ...base, PORT: "8080" }).port).toBe(8080);
  });
});
