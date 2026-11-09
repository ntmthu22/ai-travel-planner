## Where these rules came from

- "Never edit a test to make a check pass": in @@PR_BREAK@@ we broke the contract on purpose (404 became 403
  for non-members). CI went red in 3 tests; we fixed the code in @@BREAK_FIX@@ and left the tests and
  the contract untouched.
- "Never push directly to `main`": protection was turned on before any demo PR (see
  `docs/evidence/branch-protection.json`); @@PR_RED@@ was blocked by a red `lint` check until
  @@RED_FIX@@.
