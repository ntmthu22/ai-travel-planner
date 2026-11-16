# Self-assessment: PA#2

| #   | Criterion                   | Max | Claimed | Evidence (file / commit / PR / CI run)                                                                                                                                    |
| --- | --------------------------- | --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Rules file                  | 15  | 10      | `CLAUDE.md`: four sections (stack, commands, conventions, never); the two traced "Never" lines point to PR #2 and PR #1, which were deliberate drills, not accidents      |
| 2   | Permissions and secrets     | 10  | 9       | `.claude/settings.json` (allow/ask/deny), `.env.example`, README "Secrets and model cost" (free tier, no billing attached, so 0 USD cap)                                  |
| 3   | One command for every check | 10  | 9       | README "Checks" table = `.github/workflows/ci.yml` commands; `npm run check`                                                                                              |
| 4   | CI that blocks a merge      | 20  | 17      | `docs/evidence/branch-protection.json`; `docs/evidence/blocked-merge-attempts.txt` (merge refused while red); blocked PR #1; green commit `0198c6a`; CI run for tag `pa2` |
| 5   | Contract of one endpoint    | 25  | 22      | `docs/contract/save-plan.md` (roles + ownership, field rules, RFC 9457 types, idempotency, change rules)                                                                  |
| 6   | Contract tests that bite    | 15  | 12      | `test/save-plan.contract.test.ts` (22 tests); red run PR #2, fixed in code only (commit `da72e30`)                                                                        |
| 7   | AI-LOG.md                   | 5   | 4       | `AI-LOG.md` entries 1 and 2                                                                                                                                               |
|     | **Total**                   | 100 | **83**  |                                                                                                                                                                           |

## What we did not manage

- The validator is a stub (only the group total); the real rules arrive in PA#3.
- Authentication is a development stub (`X-User-Id`).
- The cost of one model plan is not measured yet (no model call exists before PA#3).
- The two "Never" lines in `CLAUDE.md` are traced to PR #1 and PR #2, which were deliberate drills, not accidents.
- `CLAUDE.md` lost its four main sections in the base commit; restored in a later PR. We claim fewer marks for criterion 1 because no "Never" line comes from a real accident.
- Most of the history was produced on one day (10 Nov) by a script that opened the demo PRs; we claim fewer marks for criteria 4 and 6 for that reason.
- There is no screenshot of the branch settings; the evidence is the API output in `docs/evidence/branch-protection.json`.
