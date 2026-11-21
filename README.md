# AI Travel Planner

Class project CSC13114 (23KTPM1). Team: Nguyễn Trần Minh Thư (22127403), Hoàng Trí Luật (22127253).

## Setup

```bash
git clone https://github.com/ntmthu22/ai-travel-planner.git && cd ai-travel-planner
npm ci
cp .env.example .env   # fill in values; never commit .env
```

## Checks (one command each; CI runs exactly these)

| Check        | Command                |
| ------------ | ---------------------- |
| Lint         | `npm run lint`         |
| Format check | `npm run format:check` |
| Type check   | `npm run typecheck`    |
| Tests        | `npm test`             |
| All four     | `npm run check`        |

`npm run format` fixes formatting. CI: `.github/workflows/ci.yml`. `main` is protected and
all four checks are required.

## Assistant permissions (`.claude/settings.json`)

- **Allowed:** run the four checks, `git status`, `git diff`, `git log`.
- **Ask first:** `git commit`, `git push`, `git checkout`, `npm install`, editing `docs/contract/**`.
- **Never:** read `.env`, force-push, push to `main`, `rm -rf`.

## Secrets and model cost

- Secrets live only in `.env` (gitignored). `.env.example` lists every variable without values.
- Model: `gemini-2.5-flash` via Google AI Studio (free tier). No billing account is attached to
  the Google project, so the API key cannot incur charges: the spending cap is **0 USD per
  month**. If billing is ever attached, set a monthly budget on the provider's dashboard first
  and update this line. PA#2 makes no model calls; the per-plan cost is measured in PA#3 and
  written here then.
- No key has ever been committed. `.env` is gitignored and `.claude/settings.json` denies the
  assistant read access to it.

## Run it

```bash
npm ci && npm start               # serves the page and the API on PORT (runs with tsx, so keep dev dependencies)
```

Deployment: set `NODE_ENV=production` (turns the `X-User-Id` dev sign-in off), `SEED_USERS`
(`id:password,...`, four accounts, passwords never in git), `MODEL_PROVIDER`, `MODEL_NAME`,
`MODEL_API_KEY` (backend only), `DATA_DIR`. The page is `public/`; it holds no key and no provider name.

## The agent

Seven tools (`docs/contract/agent-tools.md`): `search_places`, `get_place`, `get_profile`, `get_weather`,
`get_holidays`, `get_travel_time`, `compute_cost`. Limits, enforced in code (`src/agent.ts`,
`DEFAULT_LIMITS`): 2 repair rounds, 12 tool calls, 90 seconds. The model sees `m1, m2, ...` and
interests, never names or emails. Money is computed by `src/cost.ts`. Flow: ask the agent, confirm the
places, review and edit the schedule, Save (which re-runs the validator).

Validator rules V1 to V5: `src/validator.ts` (tests: `test/validator.test.ts`, `test/save-validator.test.ts`).

Batch run: `npm run agent -- --data <dir> --requests <requests.jsonl> --out <dir>`
(`docs/contract/agent-command.md`).

## Dataset

Version used by the committed run: **TO FILL from `dataset.json` of the shared set** (the sample in
`data/sample/` is a 20-place placeholder, version `sample-placeholder-NOT-the-shared-set`).

## Cost of one plan

Model: **TO FILL** (the value of `MODEL_NAME` in the committed run).
Formula: `(input tokens x input price + output tokens x output price) / 1,000,000` per plan, with the
token counts from `summary.json` of the run and the prices from the provider's price page on the
day of the run. Arithmetic: **TO FILL after the real run** (no real model call was made while
building this; the free tier of PA#2 has a 0 USD cap).

## Credits

Places: OpenStreetMap contributors (https://www.openstreetmap.org/copyright). Images: Wikimedia
Commons (https://commons.wikimedia.org). Weather: Open-Meteo (https://open-meteo.com).

## Contract

`docs/contract/save-plan.md` is the contract of `POST /plans/{planId}/save`.
Tests: `test/save-plan.contract.test.ts`.
