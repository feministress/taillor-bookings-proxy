// api/schema.js
//
// GET /api/schema
// Returns the dropdown options the booking form needs for its fixed-choice fields
// (rooms, shadowable, deposit), pulled live from Podio's app definition.
//
// Domme and Client are NOT included here anymore — those are populated live via
// /api/search-reference as the person types, using Podio's dedicated reference-field
// search endpoint, since preloading thousands of Contacts entries doesn't scale.

const { podioRequest, PODIO_APP_ID } = require('../lib/podio');

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

    res.status(200).json({
      room: optionsOf(roomField),
      shadowable: optionsOf(shadowableField),
      deposit: optionsOf(depositField),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
