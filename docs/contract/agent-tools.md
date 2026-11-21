# Contract: the seven tools of the agent

Status: **v1** (names and shapes are **assumed** until the class brief and `travel-eval/README.md` are
matched: only `src/tools.ts` and `src/data.ts` change then). Tests in `test/tools.test.ts`, `test/agent.test.ts`.

The model reaches data only through these tools. Arguments are validated with a strict schema: an unknown
key (for example `userId` or `groupId`) is an error returned to the model. The user and the group always
come from the session. The model sees members as `m1`, `m2`, ... never names or emails.

| Tool              | Arguments                                             | Returns                                                         |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| `search_places`   | `type?, district?, day?, time?, priceLevel?`          | candidates only (hours, ticket price and menu present)          |
| `get_place`       | `placeId`                                             | detail with menu, only for a candidate                          |
| `get_profile`     | none                                                  | the group's members: `ref`, interests, cap                      |
| `get_weather`     | `date`                                                | hourly rain chance for the date (the data folder or Open-Meteo) |
| `get_holidays`    | `from, to`                                            | public holidays in the range                                    |
| `get_travel_time` | `fromPlaceId, toPlaceId`                              | motorbike minutes                                               |
| `compute_cost`    | `stops:[{placeId, items:[{itemId, memberRef, qty}]}]` | per member and total, computed by code                          |

## Limits (enforced in code)

At most **2 repair rounds**, **12 tool calls**, **90 seconds**. At a limit the loop stops and the best draft
(fewest violations) is returned with a red `warning`. A repair round is one more model answer after the
validator refused the previous one.

## Model output (schema checked before the validator, R2)

- Shortlist: `{ "placeIds": [8 to 12 ids] }`, every id a candidate seen in a tool result of this run.
- Schedule: `{ "stops": [ { "placeId", "start", "end", "items": [ { "itemId", "memberRef", "qty" } ] } ] }`.

Both schemas are strict: a `total`, `cost` or any other key is refused, so the model's money is never used.
