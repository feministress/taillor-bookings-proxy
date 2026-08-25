// api/bookings.js
//
// GET  /api/bookings         -> list of all bookings, parsed into a clean shape
// POST /api/bookings         -> create a booking; rejects with 409 if it overlaps
//                                an existing booking (single-room assumption: any
//                                two bookings whose time ranges overlap conflict).
//
// POST body:
// {
//   "start": "2026-08-25 14:00:00",   // UTC, "YYYY-MM-DD HH:MM:SS"
//   "end":   "2026-08-25 15:00:00",   // UTC, "YYYY-MM-DD HH:MM:SS"
//   "room": 123,                       // option id, optional
//   "dommeId": 456,                    // Podio item_id, optional
//   "clientId": 789,                   // Podio item_id, optional
//   "shadowable": 1,                   // option id, optional
//   "deposit": 1,                      // option id, optional
//   "notes": "free text"               // optional
// }

const { podioRequest, PODIO_APP_ID } = require('../lib/podio');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const bookings = await fetchAllBookings();
      res.status(200).json({ bookings });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
      const { start, end, room, dommeId, clientId, shadowable, deposit, notes } = body;

      if (!start || !end) {
        res.status(400).json({ error: 'start and end are required, format "YYYY-MM-DD HH:MM:SS" (UTC)' });
        return;
      }

      const newStart = parsePodioUtc(start);
      const newEnd = parsePodioUtc(end);

      if (!newStart || !newEnd || newEnd <= newStart) {
        res.status(400).json({ error: 'Invalid start/end — end must be after start.' });
        return;
      }

      const existing = await fetchAllBookings();
      const conflict = existing.find((b) => b.start && b.end && newStart < b.end && newEnd > b.start);

      if (conflict) {
        res.status(409).json({
          error: 'This time overlaps with an existing booking.',
          conflictingBooking: {
            id: conflict.id,
            start: conflict.startRaw,
            end: conflict.endRaw,
            client: conflict.clientTitle,
          },
        });
        return;
      }

      const fields = { date: { start } }; // this Date field has no end-date component (config: "Hide end date") — only start is ever stored
      fields['length-2'] = Math.round((newEnd - newStart) / 1000);

      if (room !== undefined && room !== null && room !== '') fields.room = Number(room);
      if (dommeId) fields.domme = Number(dommeId);
      if (clientId) fields.relationship = Number(clientId);
      if (shadowable !== undefined && shadowable !== null && shadowable !== '')
        fields['is-it-shadowable'] = Number(shadowable);
      if (deposit !== undefined && deposit !== null && deposit !== '')
        fields['have-you-received-a-deposit'] = Number(deposit);
      if (notes) fields['pre-session-notes'] = notes; // booking-time notes go on Pre-Session Notes; Post-Session Notes stays for after the fact

      const created = await podioRequest(`/item/app/${PODIO_APP_ID}/`, {
        method: 'POST',
        body: JSON.stringify({ fields }),
      });

      res.status(201).json({ ok: true, item: created });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

async function fetchAllBookings() {
  const data = await podioRequest(`/item/app/${PODIO_APP_ID}/filter`, {
    method: 'POST',
    body: JSON.stringify({ limit: 500, sort_by: 'created_on', sort_desc: true }),
  });
  return (data.items || []).map(parseBookingItem);
}

function parseBookingItem(item) {
  const getField = (extId) => (item.fields || []).find((f) => f.external_id === extId);

  const dateField = getField('date');
  const roomField = getField('room');
  const dommeField = getField('domme');
  const clientField = getField('relationship');
  const shadowableField = getField('is-it-shadowable');
  const depositField = getField('have-you-received-a-deposit');
  const lengthField = getField('length-2');
  const preNotesField = getField('pre-session-notes');
  const postNotesField = getField('notes');

  const dateVal = dateField?.values?.[0] || {};
  // This Date field has no end-date component (config: "Hide end date") — only a
  // start value is ever stored. Trying known Podio shapes for that start value.
  const startRaw =
    dateVal.start || dateVal.start_utc || (dateVal.start_date ? `${dateVal.start_date} ${dateVal.start_time || '00:00:00'}` : null);

  const lengthSeconds = lengthField?.values?.[0]?.value;
  const startParsed = startRaw ? parsePodioUtc(startRaw) : null;
  const endParsed = startParsed && lengthSeconds ? new Date(startParsed.getTime() + Number(lengthSeconds) * 1000) : null;

  const roomVal = roomField?.values?.[0]?.value;
  const dommeVal = dommeField?.values?.[0]?.value;
  const clientVal = clientField?.values?.[0]?.value;
  const shadowableVal = shadowableField?.values?.[0]?.value;
  const depositVal = depositField?.values?.[0]?.value;

  return {
    id: item.item_id,
    startRaw,
    endRaw: endParsed ? endParsed.toISOString() : null,
    start: startParsed,
    end: endParsed,
    room: roomVal ? { id: roomVal.id, text: roomVal.text } : null,
    domme: dommeVal ? { id: dommeVal.item_id, title: dommeVal.title } : null,
    client: clientVal ? { id: clientVal.item_id, title: clientVal.title } : null,
    clientTitle: clientVal?.title || null,
    shadowable: shadowableVal ? { id: shadowableVal.id, text: shadowableVal.text } : null,
    deposit: depositVal ? { id: depositVal.id, text: depositVal.text } : null,
    preSessionNotes: preNotesField?.values?.[0]?.value || null,
    postSessionNotes: postNotesField?.values?.[0]?.value || null,
  };
}

// Podio date strings are "YYYY-MM-DD HH:MM:SS" in UTC with no timezone suffix.
function parsePodioUtc(str) {
  if (!str) return null;
  const iso = str.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}
