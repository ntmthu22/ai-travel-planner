import type { Request, Response } from "express";
import type { Dataset } from "./data.js";
import { ProblemError } from "./problem.js";
import { isWeekday, searchPlaces, toMin } from "./search.js";

const CREDITS = [
  {
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
    for: "maps and place data",
  },
  { name: "Wikimedia", url: "https://commons.wikimedia.org", for: "photos" },
  { name: "Open-Meteo", url: "https://open-meteo.com", for: "weather forecast" },
];

const bad = (detail: string) =>
  new ProblemError(400, "validation-error", "Request validation failed", detail);

function one(req: Request, name: string): string | undefined {
  const v = req.query[name];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw bad(`Query '${name}' must be a single value.`);
  return v;
}

/** GET /places. See docs/contract/search.md. */
export function searchHandler(dataset: Dataset) {
  return (req: Request, res: Response): void => {
    const day = one(req, "day");
    const time = one(req, "time");
    const level = one(req, "priceLevel");
    if ((day === undefined) !== (time === undefined)) throw bad("'day' and 'time' go together.");
    if (day !== undefined && !isWeekday(day)) throw bad("'day' must be mon..sun.");
    if (time !== undefined) {
      try {
        toMin(time);
      } catch {
        throw bad("'time' must be HH:MM.");
      }
    }
    let priceLevel: number | undefined;
    if (level !== undefined) {
      priceLevel = Number(level);
      if (!Number.isInteger(priceLevel) || priceLevel < 1 || priceLevel > 4) {
        throw bad("'priceLevel' must be 1 to 4.");
      }
    }
    const found = searchPlaces(dataset.places, {
      type: one(req, "type"),
      district: one(req, "district"),
      priceLevel,
      openDay: day as never,
      openTime: time,
    });
    res.json({
      places: found.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        district: p.district,
        priceLevel: p.priceLevel,
        ticketPrice: p.ticketPrice,
        outdoor: p.outdoor,
      })),
    });
  };
}

/** GET /places/:id */
export function placeHandler(dataset: Dataset) {
  return (req: Request, res: Response): void => {
    const p = dataset.places.find((x) => x.id === req.params.id);
    if (!p)
      throw new ProblemError(
        404,
        "place-not-found",
        "Place not found",
        `No place ${String(req.params.id)}.`,
      );
    res.json({ ...p, credits: CREDITS });
  };
}
