# AI-LOG

## Entry 1: harness, contract tests, evidence script

- **Tool:** Claude (chat/agent session).
- **Used for:** restoring `.claude/settings.json`, adding `tags: ["pa2"]` to the CI trigger,
  11 extra contract tests (route 404, malformed JSON, `note` length, key length, order of checks,
  failed attempts not recorded), contract examples, and a script that opens the demo PRs.
- **Prompt (short):** "redo the project so nothing in the rubric is missing".
- **Changed:** the assistant's contract draft had no example of a problem-details body or the
  `Idempotent-Replayed` header; both added (section 4 and 6). Test names rewritten to say the
  contract rule they check.
- **Rejected:** the request to "rebuild" the repository history with red and green PRs. The rubric
  counts only real history, so we rejected faking it and generated the evidence by running real
  PRs against GitHub (Entry 2). Checked that the new tests bite: changing 404 to 403 for a
  non-member made 3 tests fail locally; restored afterwards.

## Entry 2: demo PRs (red to green, contract break)

- **Tool:** Claude wrote the script; the PRs were opened by running it.
- **Used for:** PR #1 (lint error, blocked by the required `lint` check, fixed in commit `0198c6a`) and
  PR #2 (contract break, 3 contract tests red, fixed in commit `da72e30` without touching tests).
- **Changed:** nothing in the tests or the contract in either PR; only the code.
- **Rejected:** merging with the red check. The merge button was disabled until the fix commit.
