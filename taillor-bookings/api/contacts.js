// api/contacts.js
//
// GET /api/contacts?q=search+text        -> lightweight search results (id + name only)
// GET /api/contacts?id=123456             -> full contact detail (no booking count)
// GET /api/contacts?id=123456&withCount=1 -> full contact detail + bookingCount
//
// Search re-uses the exact same Podio mechanism as api/search-reference.js: the
// Bookings app's "Client" field already references the Contacts app, so Podio's
// "find referenceable items" endpoint (GET /item/field/{field_id}/find?text=...)
// gives us type-ahead search against Contacts for free, scoped through the
// Bookings app token we already have cached. We resolve that field's numeric
// field_id dynamically from the Bookings app schema (same technique schema.js
// uses for Domme/Client) rather than hardcoding it, since it was never confirmed
// against a live response.
//
// Detail fetches hit the Contacts app directly via podioRequestAs, using
// PODIO_CONTACTS_APP_ID / PODIO_CONTACTS_APP_TOKEN.
//
// HONEST CAVEAT: the field-parsing helpers below (phone / email / tag / location /
// embed / image) are written defensively against Podio's documented shapes, but —
// same as bookings.js's original date/category/relationship parsing — they have
// NOT been verified against a live Contacts item response yet. If any detail field
// shows up blank or wrong after first deploy, share the raw JSON from
// /api/contacts?id=<one that's wrong> and it's a quick targeted fix.

const { podioRequest, podioRequestAs, PODIO_APP_ID } = require('../lib/podio');

const PODIO_CONTACTS_APP_ID = process.env.PODIO_CONTACTS_APP_ID;
const PODIO_CONTACTS_APP_TOKEN = process.env.PODIO_CONTACTS_APP_TOKEN;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Cache the Bookings app's Client (relationship) field_id in-memory so we don't
// refetch the app schema on every request. Same idea as the token cache in lib/podio.js.
let clientFieldIdCache = null;

async function getClientFieldId() {
  if (clientFieldIdCache) return clientFieldIdCache;

  const app = await podioRequest(`/app/${PODIO_APP_ID}`);
  const fields = app.fields || [];
  const clientField = fields.find((f) => f.external_id === 'relationship');

  if (!clientField) {
    throw new Error(
      "Could not find a field with external_id 'relationship' on the Bookings app — the field may have been renamed in Podio."
    );
  }

  clientFieldIdCache = clientField.field_id;
  return clientFieldIdCache;
}

// ---- Field parsing helpers -------------------------------------------------
// Each of these tries the documented Podio shape first, then falls back
// defensively. None of this has been checked against a live response yet.

function findFieldByExternalId(item, externalId) {
  const fields = item.fields || [];
  return fields.find((f) => f.external_id === externalId);
}

function parseText(item, externalId) {
  const field = findFieldByExternalId(item, externalId);
  const val = field?.values?.[0]?.value;
  return typeof val === 'string' ? val : val ?? null;
}

function parsePhones(item) {
  const field = findFieldByExternalId(item, 'phone');
  if (!field?.values) return [];
  return field.values.map((v) => ({ type: v.type || null, value: v.value }));
}

function parseEmails(item) {
  const field = findFieldByExternalId(item, 'email-address');
  if (!field?.values) return [];
  return field.values.map((v) => ({ type: v.type || null, value: v.value }));
}

function parseCategory(item, externalId) {
  const field = findFieldByExternalId(item, externalId);
  const val = field?.values?.[0]?.value;
  if (!val) return null;
  // Podio category values are typically { id, text, ... }
  return val.text ?? val;
}

function parseTags(item, externalId) {
  const field = findFieldByExternalId(item, externalId);
  if (!field?.values) return [];
  return field.values.map((v) => v.value ?? v);
}

function parseLocation(item, externalId) {
  const field = findFieldByExternalId(item, externalId);
  const val = field?.values?.[0];
  if (!val) return null;
  // Location fields usually carry a formatted_address plus lat/lng; falling
  // back to whatever string-ish value is present if that shape isn't right.
  return val.formatted_address || val.value || null;
}

function parseEmbed(item, externalId) {
  const field = findFieldByExternalId(item, externalId);
  const val = field?.values?.[0]?.value;
  if (!val) return null;
  return val.embed?.original_url || val.embed?.url || val.embed?.resolved_url || null;
}

function parseImage(item, externalId) {
  const field = findFieldByExternalId(item, externalId);
  const val = field?.values?.[0]?.value;
  if (!val) return null;
  const file = val.file || val;
  return file?.link || file?.thumbnail_link || null;
}

function parseContact(item) {
  return {
    id: item.item_id,
    name: parseText(item, 'namenickname'),
    callerId: parseText(item, 'caller-id'),
    phones: parsePhones(item),
    emails: parseEmails(item),
    canWeTextHim: parseCategory(item, 'can-we-text-him'),
    work: parseTags(item, 'organization'),
    address: parseLocation(item, 'address'),
    website: parseEmbed(item, 'website'),
    photo: parseImage(item, 'photo'),
    notes: parseText(item, 'notes'),
  };
}

// ---- Booking list for a contact --------------------------------------------
// Reuses the exact field shapes confirmed working in api/bookings.js's own
// parseBookingItem — domme/client relationship values are { item_id, title },
// date values are { start, end } directly on values[0] (not nested under
// .value), category fields (room, shadowable, deposit) are { id, text }.

function parsePodioUtc(str) {
  if (!str) return null;
  const iso = str.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function parseBookingForContact(item) {
  const getField = (extId) => (item.fields || []).find((f) => f.external_id === extId);

  const dateField = getField('date');
  const roomField = getField('room');
  const dommeField = getField('domme');
  const shadowableField = getField('is-it-shadowable');
  const depositField = getField('have-you-received-a-deposit');
  const preNotesField = getField('pre-session-notes');
  const postNotesField = getField('notes');

  const dateVal = dateField?.values?.[0] || {};
  const startRaw = dateVal.start || null;
  const endRaw = dateVal.end || null;

  const roomVal = roomField?.values?.[0]?.value;
  const dommeVal = dommeField?.values?.[0]?.value;
  const shadowableVal = shadowableField?.values?.[0]?.value;
  const depositVal = depositField?.values?.[0]?.value;

  return {
    id: item.item_id,
    start: startRaw ? parsePodioUtc(startRaw) : null,
    end: endRaw ? parsePodioUtc(endRaw) : null,
    room: roomVal?.text || null,
    dommeTitle: dommeVal?.title || null,
    shadowable: shadowableVal?.text || null,
    depositReceived: depositVal?.text || null,
    preSessionNotes: preNotesField?.values?.[0]?.value || null,
    postSessionNotes: postNotesField?.values?.[0]?.value || null,
  };
}

// ---- Handler ----------------------------------------------------------------

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { q, id, withCount } = req.query;

    if (id) {
      // ---- Detail mode ----
      const item = await podioRequestAs(
        PODIO_CONTACTS_APP_ID,
        PODIO_CONTACTS_APP_TOKEN,
        `/item/${id}`
      );
      const contact = parseContact(item);

      if (withCount) {
        const fieldId = await getClientFieldId();
        const filterResult = await podioRequest(`/item/app/${PODIO_APP_ID}/filter`, {
          method: 'POST',
          body: JSON.stringify({
            filters: { [fieldId]: [Number(id)] },
            limit: 500,
            sort_by: 'created_on',
            sort_desc: true,
          }),
        });
        // Podio's filter response has TWO counts: "total" = every item in the
        // whole app (unfiltered), "filtered" = only the ones matching our filter.
        // This was backwards before (total ?? filtered), which is why a contact
        // was showing the entire app's booking count instead of their own.
        contact.bookingCount = filterResult.filtered ?? filterResult.total ?? null;
        contact.bookings = (filterResult.items || []).map(parseBookingForContact);
      }

      res.status(200).json(contact);
      return;
    }

    // ---- Search mode ----
    if (!q || !q.trim()) {
      res.status(200).json({ results: [] });
      return;
    }

    const fieldId = await getClientFieldId();
    const found = await podioRequest(
      `/item/field/${fieldId}/find?text=${encodeURIComponent(q.trim())}`
    );

    // CONFIRMED shape (matches search-reference.js, which already works in
    // production): "find referenceable items" returns { item_id, title }, not
    // { id, title }. That was the actual bug — fixed now, debug field removed.
    const results = (Array.isArray(found) ? found : []).map((r) => ({
      id: r.item_id,
      name: r.title,
    }));

    res.status(200).json({ results });
  } catch (err) {
    console.error('contacts.js error:', err);
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
};
