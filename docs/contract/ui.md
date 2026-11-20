# Contract: the screens and what the browser receives

Status: **v1**. Tests in `test/ui.test.ts`.

One page at `/` (`index.html`, `app.js`, `style.css`), no framework, no external script or font. It only
calls the endpoints of the other contracts.

## Screens

1. **Sign in** (`POST /auth/login`); the token is kept in memory for the tab.
2. **Search**: type, district, open day and time, price level; a list; a detail page with the menu and prices.
3. **My interests** (`GET /me`, `PUT /me/interests`).
4. **Group**: create, join with an invite link, the members with their caps, "set my cap" (only my own),
   the group total (owner), the invite link (owner).
5. **Plan**: date and preferences, "Ask the agent"; the proposed places with **Pin** and **Remove**, then
   **Confirm places** (first confirmation); the draft with the stops (time, items, quantity; remove a stop),
   the spending per person, the violations preview and the red warning if a limit was hit; **Save**
   (second confirmation, with an Idempotency-Key). The saved plans of the group are listed for every member.
6. **Footer on every screen**: OpenStreetMap, Wikimedia and Open-Meteo are credited with links.

## What the browser receives

- No secret: the model key stays in the backend; `app.js` contains no key, no `MODEL_API_KEY` name and no
  provider URL. No `NEXT_PUBLIC_` or `VITE_` variable exists.
- Data is written into the page with `textContent`, never `innerHTML`, so a place name or an interest
  cannot run script.
- Every response carries `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. The page has no inline script or
  inline event handler.
- Only the three files of `public/` are served. Source code, `.env` and `data/` are not.
