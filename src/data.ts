import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export interface Period {
  open: string; // "HH:MM"
  close: string; // "HH:MM", "24:00" allowed
}
export interface MenuItem {
  id: string;
  name: string;
  price: number; // VND
}
export interface Place {
  id: string;
  name: string;
  type: string;
  district: string;
  lat: number;
  lng: number;
  priceLevel: 1 | 2 | 3 | 4;
  ticketPrice: number | null;
  hours: Partial<Record<Weekday, Period[]>> | null;
  menu: MenuItem[] | null;
  outdoor: boolean;
  description: string;
}
export interface Dataset {
  version: string;
  places: Place[];
}
export interface ForecastHour {
  time: string; // "YYYY-MM-DDTHH:00" local time
  precipProb: number; // percent
}
export interface Forecast {
  hourly: ForecastHour[];
}
export interface Holiday {
  date: string; // "YYYY-MM-DD"
  name: string;
}

export const EMPTY_DATASET: Dataset = { version: "none", places: [] };

/**
 * ADAPTER: the one place that knows the file format. The shared set (travel-eval/README.md) was not
 * available when this was written, so this reads the format described in docs/contract/search.md.
 * When the published format differs, change `normalizePlace` and nothing else.
 */
export function normalizePlace(raw: unknown): Place {
  const r = raw as Place;
  return {
    id: String(r.id),
    name: String(r.name),
    type: String(r.type),
    district: String(r.district),
    lat: Number(r.lat),
    lng: Number(r.lng),
    priceLevel: r.priceLevel,
    ticketPrice: r.ticketPrice ?? null,
    hours: r.hours ?? null,
    menu: r.menu ?? null,
    outdoor: Boolean(r.outdoor),
    description: String(r.description ?? ""),
  };
}

function readJson(dir: string, file: string): unknown {
  return JSON.parse(readFileSync(join(dir, file), "utf8"));
}

/** Reads `<dir>/dataset.json`: `{ "version": string, "places": [...] }`. */
export function loadDataset(dir: string): Dataset {
  const raw = readJson(dir, "dataset.json") as { version?: string; places: unknown[] };
  return { version: String(raw.version ?? "unversioned"), places: raw.places.map(normalizePlace) };
}

/** Reads `<dir>/weather.json`: `{ "hourly": [{ "time", "precipProb" }] }`. The agent command uses this, never the live forecast. */
export function loadWeather(dir: string): Forecast {
  return readJson(dir, "weather.json") as Forecast;
}

/** Reads `<dir>/holidays.json`: `[{ "date", "name" }]`. */
export function loadHolidays(dir: string): Holiday[] {
  return readJson(dir, "holidays.json") as Holiday[];
}
