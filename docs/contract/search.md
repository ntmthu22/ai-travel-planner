# Contract: places search and detail

Status: **v1**. Tests in `test/search.test.ts` and `test/places.api.test.ts`.

## Data

Places come from the shared set (`dataset.json`, version named in the README). The loading code is
the only place that knows the file format (`src/data.ts`).

A place is a **candidate** (may be offered to the agent) only if it has opening hours (at least one
period), a ticket price (`0` is a price; `null` is not) and a menu with at least one item. Money is in VND.

## `GET /places` (public)

| Query        | Rule                                                           |
| ------------ | -------------------------------------------------------------- |
| `type`       | optional, exact match                                          |
| `district`   | optional, exact match                                          |
| `day`        | optional `mon`..`sun`; **required together with `time`**       |
| `time`       | optional `HH:MM`; open at that time on `day`, **every period** |
| `priceLevel` | optional integer 1..4                                          |

"Open at a time" is true if any opening period of that weekday contains it (`open` inclusive,
`close` exclusive). A midday break therefore closes the place. A place with no hours is never
open. Bad query: `400 validation-error`.

`200 { "places": [ { id, name, type, district, priceLevel, ticketPrice, outdoor } ] }`

## `GET /places/{id}` (public)

`200` with `id, name, type, district, lat, lng, priceLevel, ticketPrice, hours, menu[{id,name,price}], outdoor,
description` and `credits` (OpenStreetMap, Wikimedia, Open-Meteo). Unknown id: `404 place-not-found`.
