# Contract: groups, invite link, caps

Status: **v1**. Tests in `test/groups.test.ts`.

Authentication: `Authorization: Bearer <token>` from `POST /auth/login`. In development and tests only,
`X-User-Id` is accepted (see `save-plan.md`). No credentials: `401 unauthenticated`.

| Endpoint                                        | Who              | Result                                                                                        |
| ----------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `POST /auth/login` `{username,password}`        | anyone           | `200 {token,userId}`; wrong credentials `401 invalid-credentials`                             |
| `POST /groups` `{name,total}`                   | signed in        | `201` group, caller is owner and member; `total` integer >= 0                                 |
| `GET /groups`                                   | signed in        | `200 {groups:[{id,name,total,ownerId}]}`: only the groups the caller belongs to, oldest first |
| `GET /groups/{id}`                              | member           | `200 {id,name,total,ownerId,members:[{userId,cap}]}`; `inviteToken` only for the owner        |
| `POST /groups/join` `{token}`                   | signed in        | `200` group (joining twice is the same as once); bad token `404 invite-not-found`             |
| `PUT /groups/{id}/total` `{total}`              | owner            | `200`; other member `403 not-group-owner`                                                     |
| `PUT /groups/{id}/members/{userId}/cap` `{cap}` | that member only | `200 {userId,cap}`; `cap` integer >= 0 or `null` (no cap)                                     |

Cap rule (P1): changing another member's cap is refused with **`403 cap-not-yours`**, also for the
group owner. A caller outside the group, or an unknown group, gets `404 group-not-found` first.

Errors are RFC 9457 problem details, as in `save-plan.md`. Bad body: `400 validation-error`.
