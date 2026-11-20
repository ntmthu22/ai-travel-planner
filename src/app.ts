import express, { type NextFunction, type Request, type Response } from "express";
import type { Clock, Limits, Model } from "./agent.js";
import { authenticate, loginHandler } from "./auth.js";
import { EMPTY_DATASET, type Dataset, type Holiday } from "./data.js";
import {
  createGroupHandler,
  getGroupHandler,
  joinGroupHandler,
  setCapHandler,
  setTotalHandler,
} from "./groups.js";
import { placeHandler, searchHandler } from "./placesApi.js";
import { ProblemError, sendProblem } from "./problem.js";
import { savePlanHandler } from "./savePlan.js";
import type { Store } from "./store.js";
import type { WeatherSource } from "./tools.js";

export interface Deps {
  dataset: Dataset;
  weather: WeatherSource;
  holidays: Holiday[];
  /** Makes the model for one agent run. null: no model is configured (agent routes answer 503). */
  model: (() => Model) | null;
  /** The development X-User-Id sign-in. The deployment sets this to false. */
  devAuth: boolean;
  limits?: Limits;
  clock?: Clock;
}

const DEFAULT_DEPS: Deps = {
  dataset: EMPTY_DATASET,
  weather: { getForecast: async () => null },
  holidays: [],
  model: null,
  devAuth: true,
};

/** Express 4 does not catch a rejected promise: forward it to the error middleware. */
export const wrap =
  (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  };

export function createApp(store: Store, overrides: Partial<Deps> = {}) {
  const deps: Deps = { ...DEFAULT_DEPS, ...overrides };
  const userOf = (req: Request) => authenticate(req, store, deps.devAuth);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.post("/auth/login", wrap(loginHandler(store)));

  app.get("/places", wrap(searchHandler(deps.dataset)));
  app.get("/places/:id", wrap(placeHandler(deps.dataset)));

  app.post("/groups", wrap(createGroupHandler(store, userOf)));
  app.post("/groups/join", wrap(joinGroupHandler(store, userOf)));
  app.get("/groups/:id", wrap(getGroupHandler(store, userOf)));
  app.put("/groups/:id/total", wrap(setTotalHandler(store, userOf)));
  app.put("/groups/:id/members/:userId/cap", wrap(setCapHandler(store, userOf)));

  app.post("/plans/:planId/save", wrap(savePlanHandler(store, userOf)));

  app.use((_req, _res, next) => {
    next(new ProblemError(404, "route-not-found", "Route not found", "No such route."));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (err instanceof ProblemError) return sendProblem(res, err);
    if (err instanceof SyntaxError) {
      return sendProblem(
        res,
        new ProblemError(400, "validation-error", "Request validation failed", "Malformed JSON."),
      );
    }
    return sendProblem(
      res,
      new ProblemError(500, "internal-error", "Internal error", "Unexpected error."),
    );
  });

  return app;
}
