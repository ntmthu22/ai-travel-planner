# Self-assessment: PA#3

Claims are what the repository shows today. Items needing a deployment, a real run or a video are not claimed.

| #   | Criterion                        | Max | Claimed | Evidence / what is missing                                                                                                     |
| --- | -------------------------------- | --- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Search + groups, deployed        | 20  | TO FILL | Code and tests exist (`src/search.ts`, `src/groups.ts`, `public/`). Not deployed yet: no URL, no accounts.                     |
| 2   | Agent, 7 tools, limits           | 25  | TO FILL | Seven tools, limits in code, tests with a fake model. No real model run, so no measured per-plan cost in the README.           |
| 3   | Two confirmations                | 15  | TO FILL | `test/confirmations.test.ts`; nothing reaches the group without Save.                                                          |
| 4   | Validator V1 to V5               | 20  | TO FILL | 26 validator tests plus Save-time tests; V3 formula and the amount in V4 are assumptions.                                      |
| 5   | Agent command + first eval       | 10  | TO FILL | Command and tests exist; the first run and the eval.mjs report are missing.                                                    |
| 6   | Tests first, one part per commit | 5   | TO FILL | Red `test:` commits before `feat:` commits in `git log`. One exception: the agent-command contract was written after the code. |
| 7   | AI-LOG.md                        | 5   | TO FILL | Entries 3 to 5; the team-review entry is still empty.                                                                          |

## What we did not manage

- No deployment, no real model run, no eval report, no video.
- File formats and tool names follow assumptions until the class brief and `travel-eval/` are read.
- No rate limiting on sign-in.
