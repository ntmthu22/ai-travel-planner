# AI Travel Planner: rules for the assistant

## Stack

- TypeScript (strict), Node 20, Express 4, Vitest + supertest, ESLint, Prettier.
- Errors are RFC 9457 problem details (`application/problem+json`).
- Source of truth for endpoint behaviour: `docs/contract/*.md`.

## Commands (the same locally and in CI)

- `npm run lint` · `npm run format:check` · `npm run typecheck` · `npm test`
- `npm run check` runs all four. Run it before every commit.

## Conventions

- Money is computed by plain code only, never by the model.
- Every endpoint has a file in `docs/contract/` and tests in `test/` that follow it.
- Change the contract first, then the tests, then the code, as separate commits.
- Work on a branch and open a PR. `main` is protected.
- Small commits; message says what and why.

## Never

- Never put a model API key in the browser bundle, a log, a test or git. Keys live in `.env` (ignored).
- Never call a real model in unit tests; use a fake.
- Never edit a test, the eval data or a validator rule to make a check pass. Fix the code or change the contract on purpose. (why: PR #2, commit `da72e30`)
- Never edit a test and the code it covers in the same commit.
- Never push directly to `main`; never force-push. (why: PR #1, commit `0198c6a`)
- Never send names or email addresses to a model, only places and interests.
- Never let the model read the database or calculate money; it works through the tools only.

## Where these rules came from

- "Never edit a test to make a check pass": in PR #2 we broke the contract on purpose (404 became 403
  for non-members). CI went red in 3 tests; we fixed the code in commit `da72e30` and left the tests and
  the contract untouched.
- "Never push directly to `main`": protection was turned on before any demo PR (see
  `docs/evidence/branch-protection.json`); PR #1 was blocked by a red `lint` check until
  commit `0198c6a`.
