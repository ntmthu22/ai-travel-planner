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

## Entry 3: PA#3 build (contracts, tests, code)

- **Tool:** Claude (agent session), one long session.
- **Used for:** contracts for search, groups, plans, agent tools, profile, agent command and UI; red tests
  first, then code, in separate commits; the validator V1 to V5, the agent loop with its limits, a fake model,
  the Gemini adapter, the batch command and the screens.
- **Prompt (short):** "build the whole PA#3 on top of our PA2 repo" (class brief and `travel-eval/` were not available).
- **Changed:** several tests the assistant wrote had wrong fixtures or assertions; they were fixed in their
  own commits after checking which side was wrong. A time check in the schedule schema threw instead of
  returning a failure; the schema and its test were corrected. Passwords are hashed with a cost lowered only
  outside production so tests stay fast. The agent command contract was written after the code, and says so.
- **Rejected:** letting the model pass a member id in tool arguments (it sees `m1, m2`; the code maps them);
  showing a draft to the group when the model gave only a red warning; loosening the validator to pass a test.

## Entry 4: assumptions

- **Tool:** Claude.
- **Used for:** guessing what the missing brief says. The list is in `PA3.md` "Assumptions". None of
  them was confirmed; the first real eval run will show which are wrong.
- **Rejected:** inventing a per-plan cost. No real model run exists, so the README leaves it open.

## Entry 5: team review

- **Tool:** none. **TO DO:** a teammate reads the diff and records here what they changed or rejected.
