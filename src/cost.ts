import type { Place } from "./data.js";
import type { Stop } from "./schedule.js";

export interface Cost {
  perMember: Record<string, number>;
  total: number;
}

/**
 * The only place money is worked out (the compute_cost tool, the validator and the API all call it).
 * Every member pays the ticket of every stop; menu items are paid by the member who takes them.
 * Throws on an unknown place, item or member: a price is never guessed.
 */
export function computeCost(places: Place[], stops: Stop[], memberIds: string[]): Cost {
  const byId = new Map(places.map((p) => [p.id, p]));
  const perMember: Record<string, number> = Object.fromEntries(memberIds.map((m) => [m, 0]));
  for (const stop of stops) {
    const place = byId.get(stop.placeId);
    if (!place) throw new Error(`Unknown place ${stop.placeId}`);
    for (const m of memberIds) perMember[m] = (perMember[m] ?? 0) + (place.ticketPrice ?? 0);
    for (const it of stop.items) {
      const item = place.menu?.find((x) => x.id === it.itemId);
      if (!item) throw new Error(`Unknown item ${it.itemId} at ${place.id}`);
      if (!(it.memberId in perMember)) throw new Error(`Unknown member ${it.memberId}`);
      perMember[it.memberId] = (perMember[it.memberId] ?? 0) + item.price * it.qty;
    }
  }
  return { perMember, total: Object.values(perMember).reduce((a, b) => a + b, 0) };
}
