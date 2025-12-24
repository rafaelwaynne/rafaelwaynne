const https = require('https');

function getJson({ base, path, query, headers = {} }) {
  return new Promise((resolve, reject) => {
    const urlPath = path + (query ? '?' + new URLSearchParams(query).toString() : '');
    const opts = {
      hostname: base.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      path: urlPath,
      method: 'GET',
      headers
    };
    const req = https.request(opts, (res) => {
      let chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf-8');
        try {
          const json = JSON.parse(text);
          resolve(json);
        } catch (e) {
          reject(new Error(text));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function listAll({ base, token, page = 1, per_page = 10 }) {
  const headers = { Authorization: `Bearer ${token}`, accept: 'application/json' };
  return await getJson({ base, path: '/api/monitoramento/oab/vinculos/processos/', query: { page, per_page }, headers });
}

async function listByOab({ base, token, correlation_id, oab_id, page = 1, per_page = 10 }) {
  const headers = { Authorization: `Bearer ${token}`, accept: 'application/json' };
  const query = {};
  if (correlation_id) query.correlation_id = correlation_id;
  if (oab_id) query.oab_id = oab_id;
  query.page = page;
  query.per_page = per_page;
  return await getJson({ base, path: '/api/monitoramento/oab/vinculos/processos/oab', query, headers });
}

async function listByCnj({ base, token, numero_cnj, page = 1, per_page = 10 }) {
  const headers = { Authorization: `Bearer ${token}`, accept: 'application/json' };
  const query = { numero_cnj, page, per_page };
  return await getJson({ base, path: '/api/monitoramento/oab/vinculos/processos/cnj', query, headers });
}

module.exports = { listAll, listByOab, listByCnj };
