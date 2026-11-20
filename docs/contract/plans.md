# Contract: proposals, the two confirmations, draft plans

Status: **v1**. Tests in `test/confirmations.test.ts`. `save-plan.md` covers the second confirmation (Save).

## Flow

1. `POST /groups/{id}/proposals` `{date:"YYYY-MM-DD", preferences?:string[]}` (member). The agent proposes
   **8 to 12** candidate places. `201 {id,groupId,date,status:"awaiting_place_confirmation",places:[...],warning?}`.
   No schedule exists yet (H1).
2. **First confirmation** `POST /proposals/{id}/confirm` `{pinned:string[], removed:string[]}` (creator).
   Ids must be places of the proposal, the two lists must not overlap, and at least one place must stay.
   A pinned place is in the schedule; a removed place is not. `201` draft plan.
   Confirming twice: `409 proposal-already-confirmed`.
3. The creator reviews the draft `GET /plans/{id}` and may change it `PUT /plans/{id}/stops` `{stops:[...]}`;
   the response carries `violations` (a preview, nothing is refused yet). A saved plan: `409 plan-already-saved`.
4. **Second confirmation** `POST /plans/{id}/save` (see `save-plan.md`). The validator runs again in the
   backend on whatever the stops are now.

## Who sees what (before Save)

A proposal and a draft plan are visible **only to the member who created them**. For every other caller
(other members, strangers) `GET /proposals/{id}` and `GET /plans/{id}` answer `404`, `GET /groups/{id}/plans`
lists saved plans only, and a draft appears nowhere else. After Save, every member of the group can read it.

## Plan object

```json
{
  "id": "p1",
  "groupId": "g1",
  "ownerId": "linh",
  "date": "2026-12-12",
  "status": "draft",
  "stops": [
    {
      "placeId": "pl_001",
      "start": "09:00",
      "end": "10:30",
      "items": [{ "itemId": "it_01", "memberId": "linh", "qty": 1 }]
    }
  ],
  "spending": { "perMember": { "linh": 120000 }, "total": 120000 },
  "violations": [],
  "warning": null
}
```

`spending` is computed by code from the data every time; a client or model value is never read.
`warning` is `{level:"red", limit:"repair_rounds"|"tool_calls"|"seconds"|"invalid_output", message}` when the
agent stopped at a limit: the draft stays private and Save still runs the validator.

## Validator (the five checks; `rule` is in every violation)

| Rule | `code`                                            | Fails when                                                                              |
| ---- | ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| V1   | `unknown_place`, `unknown_item`, `unknown_member` | a place, a menu item or a member does not exist                                         |
| V2   | `outside_opening_hours`                           | a stop is not inside one opening period of its weekday                                  |
| V3   | `travel_time_too_short`                           | the gap between two stops is shorter than the motorbike time                            |
| V4   | `over_member_cap`, `over_group_total`             | a member spends more than the lowest cap in the group, or the group more than its total |
| V5   | `rain_risk`                                       | an outdoor stop has an hour above 60% rain chance, inside the 7-day forecast            |

Also `invalid_schedule` for stops that do not fit the schema, and, at confirmation, `pinned_missing`,
`removed_present` and `unconfirmed_place` (a place the user never confirmed). `warning.limit` may also be
`model_error` when the model could not be reached (no provider detail is shown). Refusal: `422 plan-violates-constraints` with `violations`.

## Change log

- v1.1: added `unconfirmed_place` and the `model_error` warning (backward compatible, section 7 of save-plan.md).
