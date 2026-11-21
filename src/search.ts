import type { Place, Weekday } from "./data.js";

const DAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** "HH:MM" to minutes since midnight. Throws on anything else ("24:00" is allowed). */
export function toMin(hhmm: string): number {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`Bad time: ${hhmm}`);
  const mins = Number(m[1]) * 60 + Number(m[2]);
  if (mins > 24 * 60) throw new Error(`Bad time: ${hhmm}`);
  return mins;
}

/** Weekday of a "YYYY-MM-DD" date (calendar date, no time zone involved). */
export function weekdayOf(date: string): Weekday {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Bad date: ${date}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return DAYS[d.getUTCDay()] as Weekday;
}

export function isWeekday(s: string): s is Weekday {
  return (DAYS as string[]).includes(s);
}

/** True if any opening period of that weekday contains the time. open inclusive, close exclusive. */
export function isOpenAt(place: Place, day: Weekday, hhmm: string): boolean {
  const t = toMin(hhmm);
  return (place.hours?.[day] ?? []).some((p) => toMin(p.open) <= t && t < toMin(p.close));
}

/** True if the whole span [start, end] lies inside one opening period of that weekday. */
export function isOpenDuring(place: Place, day: Weekday, start: string, end: string): boolean {
  const s = toMin(start);
  const e = toMin(end);
  return (place.hours?.[day] ?? []).some((p) => toMin(p.open) <= s && e <= toMin(p.close));
}

/** P4: only a place with hours, a ticket price and a menu may be offered to the agent. */
export function isCandidate(place: Place): boolean {
  const hasHours = Object.values(place.hours ?? {}).some((periods) => (periods?.length ?? 0) > 0);
  return hasHours && place.ticketPrice !== null && (place.menu?.length ?? 0) > 0;
}

export interface SearchFilters {
  type?: string;
  district?: string;
  openDay?: Weekday;
  openTime?: string;
  priceLevel?: number;
  candidatesOnly?: boolean;
}

export function searchPlaces(places: Place[], f: SearchFilters): Place[] {
  if ((f.openDay === undefined) !== (f.openTime === undefined)) {
    throw new Error("openDay and openTime must be given together");
  }
  if (f.openTime !== undefined) toMin(f.openTime); // fail early on a bad time
  return places.filter(
    (p) =>
      (!f.candidatesOnly || isCandidate(p)) &&
      (f.type === undefined || p.type === f.type) &&
      (f.district === undefined || p.district === f.district) &&
      (f.priceLevel === undefined || p.priceLevel === f.priceLevel) &&
      (f.openDay === undefined || isOpenAt(p, f.openDay, f.openTime as string)),
  );
}
