import type { Place, Weekday } from "../src/data.js";

export const ALL_DAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function everyDay(...periods: [string, string][]): Place["hours"] {
  const hours: NonNullable<Place["hours"]> = {};
  for (const d of ALL_DAYS) hours[d] = periods.map(([open, close]) => ({ open, close }));
  return hours;
}

export function mkPlace(over: Partial<Place> & { id: string }): Place {
  return {
    name: over.id,
    type: "cafe",
    district: "D1",
    lat: 10.7769,
    lng: 106.7009,
    priceLevel: 1,
    ticketPrice: 0,
    hours: everyDay(["08:00", "22:00"]),
    menu: [{ id: `${over.id}_a`, name: "Item A", price: 50_000 }],
    outdoor: false,
    description: "fixture",
    ...over,
  };
}

/** A small fixed world. Tests never read data/sample so the real data can change freely. */
export function fixturePlaces(): Place[] {
  return [
    // Midday break on Monday, closed on Sunday.
    mkPlace({
      id: "cafe",
      hours: {
        mon: [
          { open: "08:00", close: "11:00" },
          { open: "14:00", close: "22:00" },
        ],
        tue: [{ open: "08:00", close: "22:00" }],
      },
    }),
    mkPlace({
      id: "museum",
      type: "museum",
      district: "D3",
      priceLevel: 2,
      ticketPrice: 40_000,
      hours: {
        tue: [{ open: "08:00", close: "17:00" }],
        wed: [{ open: "08:00", close: "17:00" }],
        thu: [{ open: "08:00", close: "17:00" }],
        fri: [{ open: "08:00", close: "17:00" }],
        sat: [{ open: "08:00", close: "17:00" }],
        sun: [{ open: "08:00", close: "17:00" }],
      },
      menu: [{ id: "museum_guide", name: "Audio guide", price: 20_000 }],
    }),
    mkPlace({
      id: "park",
      type: "park",
      outdoor: true,
      hours: everyDay(["05:00", "23:00"]),
      menu: [{ id: "park_water", name: "Water", price: 10_000 }],
      lat: 10.78,
      lng: 106.705,
    }),
    mkPlace({
      id: "restaurant",
      type: "restaurant",
      priceLevel: 3,
      hours: everyDay(["10:00", "22:00"]),
      menu: [
        { id: "rest_a", name: "Noodles", price: 150_000 },
        { id: "rest_b", name: "Rice", price: 90_000 },
      ],
    }),
    mkPlace({ id: "far", type: "park", outdoor: true, lat: 10.95, lng: 106.82 }),
    // Never offered to the agent: no hours, no ticket price, no menu.
    mkPlace({ id: "nohours", hours: null }),
    mkPlace({ id: "noticket", ticketPrice: null }),
    mkPlace({ id: "nomenu", menu: [] }),
  ];
}
