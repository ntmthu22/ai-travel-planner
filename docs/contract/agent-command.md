# Contract: the agent command

Status: **v1, formats ASSUMED**. Written after the first version of the command; the shapes below must be
matched to `travel-eval/README.md` and the class brief when they are available (only
`parseRequestLine` and the writers in `src/cli.ts` change). Tests in `test/batch.test.ts`.

```bash
npm run agent -- --data <dir> --requests <requests.jsonl> --out <dir>
```

Settings come from `.env` (`MODEL_PROVIDER`, `MODEL_NAME`, `MODEL_API_KEY`). The key is never printed.

## Input

`<dir>/dataset.json` (`{version, places[]}`), `<dir>/weather.json` (`{hourly:[{time, precipProb}]}`, read from
the file, never live, so a run can be repeated), `<dir>/holidays.json` (optional). One request per line:

```json
{
  "id": "r1",
  "date": "2026-12-10",
  "groupTotal": 1000000,
  "preferences": ["coffee"],
  "members": [{ "id": "u1", "interests": ["coffee"], "cap": 500000 }]
}
```

## Output (`--out`)

- `plans.jsonl`: one line per request: `id, date, stops, spending{perMember,total}, violations, warning, repairRounds, toolCalls, seconds`.
  `spending` is computed by code. `stops` is `null` when the agent gave nothing usable.
- `tool-log.jsonl`: one line per tool call: `requestId, phase (shortlist|schedule), seq, name, args, ok, ms`;
  the arguments are exactly as the model made them.
- `summary.json`: `requests, ok, withWarning, failed, model, datasetVersion, usage{inputTokens,outputTokens}, seconds`.

Each request runs the shortlist step, keeps everything it proposes (no human in a batch), then the schedule
step. The three limits (2 repair rounds, 12 tool calls, 90 seconds) apply to each step. Exit code: 0, 1 when a
request failed, 2 for a missing option or key.
