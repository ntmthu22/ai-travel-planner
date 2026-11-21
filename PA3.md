# PA#3: AI Travel Planner

Team: Nguyễn Trần Minh Thư (22127403), Hoàng Trí Luật (22127253)

Items marked **TO DO** need a person (a deployment, a real model run, a video); they were not done here.

| Evidence                         | Where                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Repository, tag `pa3`            | **TO DO** link after pushing the branch and tagging                                              |
| Deployment URL                   | **TO DO**                                                                                        |
| 4 test accounts                  | **TO DO** (the `SEED_USERS` values; never in git)                                                |
| Dataset version                  | README "Dataset"                                                                                 |
| Agent command                    | `npm run agent -- --data <dir> --requests <file> --out <dir>` (`docs/contract/agent-command.md`) |
| Committed real run + eval report | **TO DO** `runs/<date>/` with `plans.jsonl`, `tool-log.jsonl`, `summary.json`, eval.mjs output   |
| Video (5 min max)                | **TO DO**                                                                                        |

## Criteria and where the work is

| #   | Criterion                | Evidence                                                                                                   |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1   | Search, groups, deployed | `src/search.ts`, `src/groups.ts`, `public/`; `test/search.test.ts`, `groups.test.ts`, `ui.test.ts`         |
| 2   | Agent, 7 tools, limits   | `src/agent.ts`, `src/tools.ts`, `src/tasks.ts`; README "The agent"; cost: README "Cost of one plan" (open) |
| 3   | Two confirmations        | `src/plans.ts`, `src/savePlan.ts`; `test/confirmations.test.ts`, `confirm-failures.test.ts`                |
| 4   | Validator V1 to V5       | `src/validator.ts`; `test/validator.test.ts` (26), `save-validator.test.ts`                                |
| 5   | Agent command, eval      | `src/cli.ts`, `test/batch.test.ts`; first eval run **TO DO**                                               |
| 6   | Tests first              | `git log`: each `test:` commit precedes its `feat:` commit, red then green                                 |
| 7   | AI-LOG                   | `AI-LOG.md` entries 3 to 5                                                                                 |

## Assumptions to check against the class brief

Dataset, request and output file shapes; tool names; the amount V4 compares to the caps; the travel-time
formula (haversine x 1.3 at 25 km/h, rounded up). Only `src/data.ts` (`normalizePlace`) and `parseRequestLine`
in `src/cli.ts` should need to change.
