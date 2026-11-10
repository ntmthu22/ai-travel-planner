## Where these rules came from

- "Never edit a test to make a check pass": in PR #2 we broke the contract on purpose (404 became 403
  for non-members). CI went red in 3 tests; we fixed the code in commit `da72e30` and left the tests and
  the contract untouched.
- "Never push directly to `main`": protection was turned on before any demo PR (see
  `docs/evidence/branch-protection.json`); PR #1 was blocked by a red `lint` check until
  commit `0198c6a`.
