const path = require('path');
const fs = require('fs');
const https = require('https');
const { listByCnj: digestoListByCnj, listByOab: digestoListByOab } = require('./digesto');
const { searchCNJ } = require('./cnj');
const { sendEmail } = require('./smtp');

function readJson(fp) {
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return null; }
}

function writeJson(fp, data) {
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
}

function getDataDir() {
  return path.join(__dirname, '..', 'data');
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 Robot' } };
    const req = https.request(opts, (res) => {
      let chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => { resolve(Buffer.concat(chunks).toString('utf-8')); });
    });
    req.on('error', reject);
    req.end();
  });
}

function parseJusbrasil(html) {
  const items = [];
  const regex = /Processo\s*([\d\.-\/]+)[\s\S]*?Partes[\s\S]*?<[^>]*>(.*?)<\/|Andamentos?[\s\S]*?<[^>]*>(.*?)</gi;
  let m;
  while ((m = regex.exec(html))) {
    items.push({ numero: m[1] || '', partes: (m[2] || '').trim(), andamento: (m[3] || '').trim(), fonte: 'Jusbrasil' });
  }
  if (!items.length) {
    const rx = /href="\/processo\/([^"]+)".*?>(.*?)</gi;
    while ((m = rx.exec(html))) {
      items.push({ numero: (m[2] || '').trim(), partes: '', andamento: '', fonte: 'Jusbrasil' });
    }
  }
  return items;
}

async function runRobot({ pjeUrl, oab, cnjs = [] }) {
  const dataDir = getDataDir();
  const dataFp = path.join(dataDir, 'robot-data.json');
  const metaFp = path.join(dataDir, 'robot-meta.json');
  const logsFp = path.join(dataDir, 'robot-logs.json');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const prev = readJson(dataFp) || { items: [] };
  const prevItems = prev.items || [];
  const token = process.env.DIGESTO_API_TOKEN || '';
  const base = process.env.DIGESTO_API_BASE || 'https://op.digesto.com.br';
  const apiKey = process.env.CNJ_API_KEY || '';
  const now = new Date().toISOString();
  const logs = readJson(logsFp) || [];
  const runLog = { id: now, start: now, status: 'running', detail: '' };
  logs.push(runLog);
  writeJson(logsFp, logs);
  let collected = [];
  try {
    if (oab && token) {
      const j = await digestoListByOab({ base, token, oab_id: undefined, correlation_id: undefined, page: 1, per_page: 20 });
      const items = Array.isArray(j) ? j : (j.data || j.items || j.results || []);
      const mapped = items.map(i => ({
        numero: i.numero_cnj || i.cnj || i.numeroCNJ || '',
        partes: '',
        andamento: i.status || i.situacao || '',
        prazos: [],
        status: i.status || i.situacao || '',
        fonte: 'Digesto'
      }));
      collected = collected.concat(mapped);
    }
    if (cnjs.length && token) {
      for (const numero_cnj of cnjs) {
        const j = await digestoListByCnj({ base, token, numero_cnj, page: 1, per_page: 10 });
        const items = Array.isArray(j) ? j : (j.data || j.items || j.results || []);
        const mapped = items.map(i => ({
          numero: i.numero_cnj || i.cnj || i.numeroCNJ || '',
          partes: '',
          andamento: i.status || i.situacao || '',
          prazos: [],
          status: i.status || i.situacao || '',
          fonte: 'Digesto'
        }));
        collected = collected.concat(mapped);
      }
    }
    if (apiKey && (oab || cnjs.length)) {
      const alias = 'tjdft';
      const res = await searchCNJ({ apiKey, alias, oab, numeroProcesso: cnjs[0] || undefined, size: 10 });
      const items = res.items || [];
      const mapped = items.map(i => ({
        numero: i.numeroProcesso || '',
        partes: (i.partes || []).map(p => p.nome).join('; '),
        andamento: (i.movimentos || []).slice(-1)[0]?.movimento || '',
        prazos: [],
        status: i.situacao || i.classe?.nome || '',
        fonte: 'CNJ'
      }));
      collected = collected.concat(mapped);
    }
    if (oab) {
      const q = encodeURIComponent(oab);
      const html = await fetchHtml(`https://www.jusbrasil.com.br/processos/?q=${q}`);
      const parsed = parseJusbrasil(html);
      const mapped = parsed.map(i => ({ numero: i.numero || '', partes: i.partes || '', andamento: i.andamento || '', prazos: [], status: '', fonte: 'Jusbrasil' }));
      collected = collected.concat(mapped);
    }
    const key = x => x.numero + '|' + (x.fonte || '');
    const seen = new Set();
    collected = collected.filter(x => {
      const k = key(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const meta = readJson(metaFp) || { lastRun: null, lastCount: 0 };
    const prevSet = new Set(prevItems.map(i => i.numero + '|' + i.andamento));
    const newMovs = collected.filter(i => !prevSet.has(i.numero + '|' + i.andamento));
    writeJson(dataFp, { items: collected, updatedAt: now });
    meta.lastRun = now;
    meta.lastCount = collected.length;
    meta.newMovements = newMovs.length;
    writeJson(metaFp, meta);
    const day = new Date().toISOString().slice(0,10);
    const reportHtml = path.join(dataDir, `robot-report-${day}.html`);
    const reportCsv = path.join(dataDir, `robot-report-${day}.csv`);
    const rows = collected.map(i => [i.numero, i.partes, i.andamento, (i.prazos||[]).join('|'), i.status, i.fonte]);
    const header = ['Número','Partes','Andamento','Prazos','Status','Fonte'];
    const csv = [header].concat(rows).map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Relatório Robô</title></head><body><h1>Relatório Robô ${day}</h1><table border="1"><thead><tr>${header.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
    fs.writeFileSync(reportCsv, csv, 'utf-8');
    fs.writeFileSync(reportHtml, html, 'utf-8');
    const mh = process.env.SMTP_HOST || '';
    const me = process.env.ALERT_EMAILS || '';
    if (mh && me && newMovs.length) {
      const to = me.split(',')[0].trim();
      await sendEmail({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 465),
        secure: String(process.env.SMTP_SECURE || 'true') === 'true',
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
        to,
        subject: `Novos andamentos (${newMovs.length})`,
        text: `Novos andamentos: ${newMovs.length}`,
        html: `<p>Novos andamentos: ${newMovs.length}</p>`
      });
    }
    runLog.status = 'ok';
    runLog.detail = `Coletados ${collected.length} itens`;
  } catch (e) {
    runLog.status = 'error';
    runLog.detail = String(e.message || e);
  } finally {
    runLog.end = new Date().toISOString();
    const updatedLogs = readJson(logsFp) || [];
    updatedLogs.push(runLog);
    writeJson(logsFp, updatedLogs);
  }
  return true;
}

function getRobotData() {
  const dataFp = path.join(getDataDir(), 'robot-data.json');
  return readJson(dataFp) || { items: [] };
}

function getRobotMeta() {
  const metaFp = path.join(getDataDir(), 'robot-meta.json');
  return readJson(metaFp) || { lastRun: null, lastCount: 0, newMovements: 0 };
}

function getRobotLogs() {
  const logsFp = path.join(getDataDir(), 'robot-logs.json');
  return readJson(logsFp) || [];
}

function latestReport() {
  const dir = getDataDir();
  const files = fs.readdirSync(dir).filter(f => f.startsWith('robot-report-') && f.endsWith('.html'));
  files.sort();
  const last = files[files.length - 1];
  if (!last) return null;
  return path.join(dir, last);
}

module.exports = { runRobot, getRobotData, getRobotMeta, getRobotLogs, latestReport };
