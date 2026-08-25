// api/schema.js
//
// GET /api/schema
// Returns the dropdown options the booking form needs, pulled live from Podio's
// app definition so we never have to hardcode option IDs:
//   { room: [...], shadowable: [...], deposit: [...], dommes: [...], clients: [...] }

const {
  podioRequest,
  podioRequestAs,
  PODIO_APP_ID,
  PODIO_DOMME_APP_ID,
  PODIO_DOMME_APP_TOKEN,
  PODIO_CONTACTS_APP_ID,
  PODIO_CONTACTS_APP_TOKEN,
} = require('../lib/podio');

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

  try {
    const app = await podioRequest(`/app/${PODIO_APP_ID}`);
    const fields = app.fields || [];

    const findField = (extId) => fields.find((f) => f.external_id === extId);

    const roomField = findField('room');
    const shadowableField = findField('is-it-shadowable');
    const depositField = findField('have-you-received-a-deposit');

    const optionsOf = (field) => (field?.config?.settings?.options || []).map((o) => ({ id: o.id, text: o.text }));

    const [dommes, clients] = await Promise.all([
      fetchItemTitles(PODIO_DOMME_APP_ID, PODIO_DOMME_APP_TOKEN),
      fetchItemTitles(PODIO_CONTACTS_APP_ID, PODIO_CONTACTS_APP_TOKEN),
    ]);

    res.status(200).json({
      room: optionsOf(roomField),
      shadowable: optionsOf(shadowableField),
      deposit: optionsOf(depositField),
      dommes,
      clients,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

async function fetchItemTitles(appId, appToken) {
  if (!appId || !appToken) return [];
  // Podio's filter endpoint paginates via limit/offset — looping here instead of a
  // single capped call, since apps like Contacts can have thousands of items and a
  // flat 500-item cap silently hid everything past that. Safety cap at 5000 total
  // just to avoid an unbounded loop if something's misconfigured.
  const results = [];
  const pageSize = 500;
  let offset = 0;
  const maxTotal = 5000;
  try {
    while (results.length < maxTotal) {
      const data = await podioRequestAs(appId, appToken, `/item/app/${appId}/filter`, {
        method: 'POST',
        body: JSON.stringify({ limit: pageSize, offset, sort_by: 'title' }),
      });
      const items = data.items || [];
      results.push(...items.map((it) => ({ id: it.item_id, title: it.title })));
      if (items.length < pageSize) break; // last page
      offset += pageSize;
    }
  } catch (e) {
    // return whatever we managed to collect before the failure
  }
  return results;
}
