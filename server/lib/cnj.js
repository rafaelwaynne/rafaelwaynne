const https = require('https');
const BASE = 'api-publica.datajud.cnj.jus.br';

function normalizeAlias(alias) {
  if (!alias) return 'api_publica_tjdft';
  return alias.startsWith('api_publica_') ? alias : `api_publica_${alias}`;
}

function postJson({ path, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const opts = {
      hostname: BASE,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      }
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
          reject(new Error(`Invalid JSON response: ${text.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function buildQuery({ numeroProcesso, classeCodigo, orgaoJulgadorCodigo, oab, size, search_after, sortOrder }) {
  if (numeroProcesso) {
    return {
      size: size || 10,
      query: { match: { numeroProcesso } }
    };
  }
  const must = [];
  if (classeCodigo) must.push({ match: { 'classe.codigo': Number(classeCodigo) } });
  if (orgaoJulgadorCodigo) must.push({ match: { 'orgaoJulgador.codigo': Number(orgaoJulgadorCodigo) } });
  if (oab) {
    must.push({
      query_string: {
        query: `"${String(oab).trim()}"`,
        default_operator: 'AND'
      }
    });
  }
  const q = {
    size: size || 10,
    query: must.length ? { bool: { must } } : { match_all: {} }
  };
  if (search_after) q.search_after = Array.isArray(search_after) ? search_after : [search_after];
  q.sort = [{ '@timestamp': { order: (sortOrder || 'asc') } }];
  return q;
}

async function searchCNJ({ apiKey, alias, numeroProcesso, classeCodigo, orgaoJulgadorCodigo, oab, size, search_after, sortOrder }) {
  if (!apiKey) throw new Error('CNJ API key não configurada (defina CNJ_API_KEY no .env)');
  const al = normalizeAlias(alias);
  const path = `/${al}/_search`;
  const body = buildQuery({ numeroProcesso, classeCodigo, orgaoJulgadorCodigo, oab, size, search_after, sortOrder });
  const headers = { Authorization: `ApiKey ${apiKey}` };
  const json = await postJson({ path, body, headers });
  const hits = (json && json.hits && json.hits.hits) || [];
  const items = hits.map(h => ({ ...h._source, sort: h.sort, score: h._score }));
  const total = (json && json.hits && json.hits.total && json.hits.total.value) || items.length;
  return { total, items, raw: json };
}

module.exports = { searchCNJ };
