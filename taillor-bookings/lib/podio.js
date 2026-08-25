// lib/podio.js
//
// Shared Podio API helper: handles "app authentication" (App ID + App Token +
// Client ID + Client Secret, no user login needed) and a generic request wrapper.
//
// NOTE ON CONFIDENCE: the auth flow and the item-creation field formats below are
// confirmed against Podio's own "Developer" panel for this app (screenshot showed
// exact sample JSON per field). The GET/read response shapes for date, category,
// and app-reference fields are the standard documented Podio shapes but have not
// been verified against a live call from this environment. If bookings.js parses
// fields incorrectly after first deploy, check the raw JSON and we'll adjust.

const PODIO_APP_ID = process.env.PODIO_APP_ID;
const PODIO_APP_TOKEN = process.env.PODIO_APP_TOKEN;
const PODIO_CLIENT_ID = process.env.PODIO_CLIENT_ID;
const PODIO_CLIENT_SECRET = process.env.PODIO_CLIENT_SECRET;

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry - 60000) {
    return cachedToken;
  }

  if (!PODIO_APP_ID || !PODIO_APP_TOKEN || !PODIO_CLIENT_ID || !PODIO_CLIENT_SECRET) {
    throw new Error(
      'Missing Podio env vars. Required: PODIO_APP_ID, PODIO_APP_TOKEN, PODIO_CLIENT_ID, PODIO_CLIENT_SECRET.'
    );
  }

  const body = new URLSearchParams({
    grant_type: 'app',
    app_id: PODIO_APP_ID,
    app_token: PODIO_APP_TOKEN,
    client_id: PODIO_CLIENT_ID,
    client_secret: PODIO_CLIENT_SECRET,
  });

  const resp = await fetch('https://podio.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Podio auth failed (${resp.status}): ${text}`);
  }

  const data = JSON.parse(text);
  cachedToken = data.access_token;
  cachedTokenExpiry = now + (data.expires_in ? data.expires_in * 1000 : 8 * 60 * 60 * 1000);
  return cachedToken;
}

async function podioRequest(path, options = {}) {
  const token = await getAccessToken();
  const resp = await fetch(`https://api.podio.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    json = { raw: text };
  }

  if (!resp.ok) {
    const err = new Error(`Podio API error (${resp.status}) on ${path}: ${JSON.stringify(json)}`);
    err.status = resp.status;
    err.body = json;
    throw err;
  }
  return json;
}

module.exports = { getAccessToken, podioRequest, PODIO_APP_ID };
