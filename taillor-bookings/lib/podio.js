// lib/podio.js
//
// Shared Podio API helper. Podio's "app authentication" scopes an access token to
// exactly one app — you can't use the Bookings app's token to read the Dommes or
// Contacts apps. So this file can mint and cache a separate token per app, keyed by
// app id, and exposes a convenience wrapper (podioRequest) pre-bound to the Bookings
// app for the existing bookings.js code.

const PODIO_CLIENT_ID = process.env.PODIO_CLIENT_ID;
const PODIO_CLIENT_SECRET = process.env.PODIO_CLIENT_SECRET;

const PODIO_APP_ID = process.env.PODIO_APP_ID; // Bookings app
const PODIO_APP_TOKEN = process.env.PODIO_APP_TOKEN;

const PODIO_DOMME_APP_ID = process.env.PODIO_DOMME_APP_ID;
const PODIO_DOMME_APP_TOKEN = process.env.PODIO_DOMME_APP_TOKEN;
const PODIO_CONTACTS_APP_ID = process.env.PODIO_CONTACTS_APP_ID;
const PODIO_CONTACTS_APP_TOKEN = process.env.PODIO_CONTACTS_APP_TOKEN;

const tokenCache = {}; // keyed by appId -> { token, expiry }

async function getAccessTokenForApp(appId, appToken) {
  const now = Date.now();
  const cached = tokenCache[appId];
  if (cached && now < cached.expiry - 60000) {
    return cached.token;
  }

  if (!appId || !appToken || !PODIO_CLIENT_ID || !PODIO_CLIENT_SECRET) {
    throw new Error(
      `Missing Podio credentials for app ${appId}. Required: matching *_APP_ID/*_APP_TOKEN env vars plus PODIO_CLIENT_ID/PODIO_CLIENT_SECRET.`
    );
  }

  const body = new URLSearchParams({
    grant_type: 'app',
    app_id: appId,
    app_token: appToken,
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
    throw new Error(`Podio auth failed for app ${appId} (${resp.status}): ${text}`);
  }

  const data = JSON.parse(text);
  tokenCache[appId] = {
    token: data.access_token,
    expiry: now + (data.expires_in ? data.expires_in * 1000 : 8 * 60 * 60 * 1000),
  };
  return data.access_token;
}

async function podioRequestAs(appId, appToken, path, options = {}) {
  const token = await getAccessTokenForApp(appId, appToken);
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

// Convenience: pre-bound to the Bookings app, for existing call sites.
function podioRequest(path, options) {
  return podioRequestAs(PODIO_APP_ID, PODIO_APP_TOKEN, path, options);
}

module.exports = {
  podioRequest,
  podioRequestAs,
  PODIO_APP_ID,
  PODIO_DOMME_APP_ID,
  PODIO_DOMME_APP_TOKEN,
  PODIO_CONTACTS_APP_ID,
  PODIO_CONTACTS_APP_TOKEN,
};
