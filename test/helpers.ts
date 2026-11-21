import type { Forecast } from "../src/data.js";
import type { ToolContext } from "../src/tools.js";
import { fixturePlaces } from "./fixtures.js";

export const THU = "2026-12-10";

export function flatForecast(date = THU, prob = 10): Forecast {
  const hourly = [];
  for (let h = 0; h < 24; h++) {
    hourly.push({ time: `${date}T${String(h).padStart(2, "0")}:00`, precipProb: prob });
  }
  return { hourly };
}

/** A session for tests. The three members have names and emails that must never reach a model. */
export function mkToolCtx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: "linh",
    groupId: "g1",
    date: THU,
    memberIds: ["linh", "an", "binh"],
    caps: { linh: 500_000, an: 300_000, binh: null },
    interests: { linh: ["coffee", "museums"], an: ["street food"], binh: ["parks"] },
    groupTotal: 2_000_000,
    places: fixturePlaces(),
    weather: { getForecast: async () => flatForecast() },
    holidays: [
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2027-01-01", name: "New Year" },
    ],
    redactTerms: ["Nguyen Thi Linh", "linh@example.com", "An Tran", "an@example.com"],
    seenPlaceIds: new Set(),
    ...over,
  };
}
