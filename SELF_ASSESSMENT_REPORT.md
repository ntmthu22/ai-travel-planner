# Self-assessment: PA#2

| #   | Criterion                   | Max | Claimed | Evidence (file / commit / PR / CI run)                                                                   |
| --- | --------------------------- | --- | ------- | -------------------------------------------------------------------------------------------------------- |
| 1   | Rules file                  | 15  | 13      | `CLAUDE.md`: four sections; "Where these rules came from" links PR #2 and PR #1                          |
| 2   | Permissions and secrets     | 10  | 9       | `.claude/settings.json` (allow/ask/deny), `.env.example`, README "Secrets and model cost" (cap set)      |
| 3   | One command for every check | 10  | 9       | README "Checks" table = `.github/workflows/ci.yml` commands; `npm run check`                             |
| 4   | CI that blocks a merge      | 20  | 18      | `docs/evidence/branch-protection.json`; blocked PR #1; green commit `0198c6a`                            |
| 5   | Contract of one endpoint    | 25  | 22      | `docs/contract/save-plan.md` (roles + ownership, field rules, RFC 9457 types, idempotency, change rules) |
| 6   | Contract tests that bite    | 15  | 13      | `test/save-plan.contract.test.ts` (22 tests); red run PR #2, fixed in code only (commit `da72e30`)       |
| 7   | AI-LOG.md                   | 5   | 4       | `AI-LOG.md` entries 1 and 2                                                                              |
|     | **Total**                   | 100 | **88**  |                                                                                                          |

## What we did not manage

- The validator is a stub (only the group total); the real rules arrive in PA#3.
- Authentication is a development stub (`X-User-Id`).
- The cost of one model plan is not measured yet (no model call exists before PA#3).
