import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { mkApi } from "./apiHelpers.js";

// docs/contract/ui.md: what the browser receives.
const PUBLIC = join(import.meta.dirname, "..", "public");
const files = () =>
  readdirSync(PUBLIC).map((f) => ({ name: f, text: readFileSync(join(PUBLIC, f), "utf8") }));

describe("the page", () => {
  it("is served at / and credits OpenStreetMap, Wikimedia and Open-Meteo with links", async () => {
    const res = await request(mkApi().app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    for (const name of ["OpenStreetMap", "Wikimedia", "Open-Meteo"])
      expect(res.text).toContain(name);
    expect(res.text).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(res.text).toContain('href="https://open-meteo.com"');
  });

  it("loads its script and style from itself, with no inline script and no inline handler", async () => {
    const html = (await request(mkApi().app).get("/")).text;
    expect(html).toContain('<script src="/app.js"');
    expect(html).toContain('href="/style.css"');
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(
      /(src|href)="https?:\/\/(?!www\.openstreetmap\.org|commons\.wikimedia\.org|open-meteo\.com)/,
    );
  });

  it("serves the script and the style", async () => {
    const api = mkApi();
    expect((await request(api.app).get("/app.js")).status).toBe(200);
    expect((await request(api.app).get("/style.css")).status).toBe(200);
  });

  it("serves nothing but the files of public/", async () => {
    const api = mkApi();
    for (const path of [
      "/src/app.ts",
      "/package.json",
      "/.env",
      "/data/sample/dataset.json",
      "/../package.json",
    ]) {
      const res = await request(api.app).get(path);
      expect(res.status, path).toBe(404);
    }
  });
});

describe("no secret reaches the browser (criterion 2)", () => {
  it("no file sent to the browser names a key, a provider key header or a provider URL", () => {
    expect(files().length).toBeGreaterThanOrEqual(3);
    for (const f of files()) {
      for (const bad of [
        "MODEL_API_KEY",
        "x-goog-api-key",
        "generativelanguage",
        "AIza",
        "NEXT_PUBLIC_",
        "VITE_",
      ]) {
        expect(f.text, `${f.name} contains ${bad}`).not.toContain(bad);
      }
    }
  });

  it("writes data into the page with textContent, never innerHTML", () => {
    const js = files().find((f) => f.name === "app.js")!.text;
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  });
});

describe("headers on every response", () => {
  it("a strict Content-Security-Policy, nosniff and no referrer", async () => {
    const api = mkApi();
    for (const path of ["/", "/app.js", "/places", "/nope"]) {
      const res = await request(api.app).get(path);
      const csp = res.headers["content-security-policy"] ?? "";
      expect(csp, path).toContain("default-src 'none'");
      expect(csp, path).toContain("script-src 'self'");
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(res.headers["x-content-type-options"], path).toBe("nosniff");
      expect(res.headers["referrer-policy"], path).toBe("no-referrer");
    }
  });
});
