# Self-assessment: PA#2

| #   | Criterion                   | Max | Claimed   | Evidence (file / commit / PR / CI run)                                                                   |
| --- | --------------------------- | --- | --------- | -------------------------------------------------------------------------------------------------------- |
| 1   | Rules file                  | 15  | @@S1@@    | `CLAUDE.md`: four sections; "Where these rules came from" links @@PR_BREAK@@ and @@PR_RED@@              |
| 2   | Permissions and secrets     | 10  | @@S2@@    | `.claude/settings.json` (allow/ask/deny), `.env.example`, README "Secrets and model cost" (cap set)      |
| 3   | One command for every check | 10  | @@S3@@    | README "Checks" table = `.github/workflows/ci.yml` commands; `npm run check`                             |
| 4   | CI that blocks a merge      | 20  | @@S4@@    | `docs/evidence/branch-protection.json`; blocked @@PR_RED@@; green @@RED_FIX@@                            |
| 5   | Contract of one endpoint    | 25  | @@S5@@    | `docs/contract/save-plan.md` (roles + ownership, field rules, RFC 9457 types, idempotency, change rules) |
| 6   | Contract tests that bite    | 15  | @@S6@@    | `test/save-plan.contract.test.ts` (22 tests); red run @@PR_BREAK@@, fixed in code only (@@BREAK_FIX@@)   |
| 7   | AI-LOG.md                   | 5   | @@S7@@    | `AI-LOG.md` entries 1 and 2                                                                              |
|     | **Total**                   | 100 | @@TOTAL@@ |                                                                                                          |

## What we did not manage

- The validator is a stub (only the group total); the real rules arrive in PA#3.
- Authentication is a development stub (`X-User-Id`).
- The cost of one model plan is not measured yet (no model call exists before PA#3).
