// api/search-reference.js
//
// GET /api/search-reference?field=domme|client&q=text
//
// Uses Podio's dedicated "find referenceable items" endpoint
// (GET /item/field/{field_id}/find) — the same mechanism Podio's own webforms use
// to populate a reference-field picker. It searches live, server-side, with no cap
// and no preloading, and is scoped to the field itself (so it authenticates with
// the Bookings app's own token — no separate Domme/Contacts app credentials needed).

const { podioRequest } = require('../lib/podio');

// field_id values from the Bookings app's field list (Developer panel)
const FIELD_IDS = {
  domme: '177053712',
  client: '177053713',
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

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

  const field = req.query.field;
  const q = req.query.q || '';
  const fieldId = FIELD_IDS[field];

  if (!fieldId) {
    res.status(400).json({ error: 'field must be "domme" or "client"' });
    return;
  }

  try {
    const params = new URLSearchParams();
    if (q) params.set('text', q);
    params.set('limit', '20');

    const data = await podioRequest(`/item/field/${fieldId}/find?${params.toString()}`);
    const results = (data || []).map((it) => ({ id: it.item_id, title: it.title }));
    res.status(200).json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
