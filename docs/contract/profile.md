# Contract: my interests

Status: **v1**. Tests in `test/profile.test.ts`.

The agent learns what each member likes from `get_profile`. Only interests go to the model: never a name
or an email (see `agent-tools.md`).

| Endpoint                          | Who       | Result                                                                                                                                                  |
| --------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /me`                         | signed in | `200 {id, interests}`                                                                                                                                   |
| `PUT /me/interests` `{interests}` | signed in | `200 {id, interests}`; `interests` is a list of at most 10 strings of 1 to 40 characters, trimmed, duplicates removed. Bad body `400 validation-error`. |

A caller changes their own interests only; there is no id in the path. No sign-in: `401 unauthenticated`.
