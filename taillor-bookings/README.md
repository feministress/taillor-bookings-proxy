# Taillor Bookings (Podio-backed)

Two pieces:
- **API** (`lib/`, `api/`) — deploy to Vercel. Holds your Podio credentials server-side and does the overlap check before writing.
- **Frontend** (`frontend/bookings.html`) — a static page, deploy to GitHub Pages (or anywhere static).

## 1. Deploy the API to Vercel

1. Push this whole folder (minus `.env.local` if you create one) to a new GitHub repo.
2. Go to vercel.com → **Add New → Project** → import that repo.
3. Before first deploy, add these 4 Environment Variables (Project → Settings → Environment Variables). Get the actual values from Podio → the Bookings app → ⋮ → Developer (App ID/App Token) and podio.com/settings/api (Client ID/Secret):
   - `PODIO_APP_ID`
   - `PODIO_APP_TOKEN`
   - `PODIO_CLIENT_ID`
   - `PODIO_CLIENT_SECRET`

   **Never put the real values in this README or any other committed file** — enter them directly in Vercel's Environment Variables screen, and nowhere else.
4. Deploy. You'll get a URL like `https://taillor-bookings-xxxx.vercel.app`.
5. Test it directly: visit `https://YOUR-URL.vercel.app/api/schema` in the browser — should return JSON with room/shadowable/deposit options and domme/client lists.
6. Test `https://YOUR-URL.vercel.app/api/bookings` (GET) — should return `{ "bookings": [...] }`.

**If `/api/bookings` returns bookings with `start`/`end` as `null`** — Podio's read response for the date field didn't match the shapes the parser tries. Copy the raw JSON of one item's `date` field from the response and send it over; it's a one-line fix to `parseBookingItem` in `api/bookings.js`.

## 2. Point the frontend at your API

In `frontend/bookings.html`, find:
```js
const API_BASE = 'https://YOUR-VERCEL-PROJECT.vercel.app';
```
Replace with your actual Vercel URL from step 1.

## 3. Deploy the frontend to GitHub Pages

1. Push `frontend/bookings.html` to a repo (can be the same repo, or a separate one like your existing calendar page's repo).
2. Repo → Settings → Pages → deploy from the branch/folder containing it.
3. Visit the page — it should load bookings and let you create new ones.

## Notes / things to double check after first deploy

- **Deposit checkbox → Podio option ID**: the frontend assumes `schema.deposit[0]` is the "Yes" option. If your deposit category's first option is actually "No", swap the logic in `bookings.html` (`depositOptionIdForYes`).
- **Timezone**: bookings are converted from your browser's local time to UTC before being sent to Podio, matching Podio's storage convention. Worth doing one test booking and checking it shows at the right time inside Podio itself.
- **Overlap check** is global (any two bookings can't overlap), since you said there's currently only one room. If you add more rooms later, the check needs to also compare `room` and only block same-room overlaps — flag it and I'll adjust.
