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
  try {
    const data = await podioRequestAs(appId, appToken, `/item/app/${appId}/filter`, {
      method: 'POST',
      body: JSON.stringify({ limit: 500, sort_by: 'title' }),
    });
    return (data.items || []).map((it) => ({ id: it.item_id, title: it.title }));
  } catch (e) {
    return [];
  }
}
