import type { Place } from "./data.js";

/** ASSUMPTION until travel-eval/README.md is matched: straight-line distance x 1.3 at 25 km/h. */
const ROAD_FACTOR = 1.3;
const SPEED_KMH = 25;

function haversineKm(a: Place, b: Place): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Motorbike minutes between two places, rounded up. 0 only for the same place. */
export function travelMinutes(a: Place, b: Place): number {
  if (a.id === b.id) return 0;
  return Math.max(1, Math.ceil(((haversineKm(a, b) * ROAD_FACTOR) / SPEED_KMH) * 60));
}
