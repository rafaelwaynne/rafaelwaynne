const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const urlLib = require('url');
const express = require('express');
require('dotenv').config();
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { scheduleDailyBackup } = require('./lib/backup');
const { signToken, authMiddleware, requireRole } = require('./lib/auth');
const jwt = require('jsonwebtoken');
const { sendEmail } = require('./lib/smtp');

const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const BACKUP_DIR = path.join(__dirname, 'backups');
const PORT = process.env.PORT || 3000;

function readJson(file) {
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

function writeJson(file, data) {
  const fp = path.join(DATA_DIR, file);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.enable('trust proxy');
if (process.env.FORCE_HTTPS === 'true') {
  app.use((req, res, next) => {
    if (req.secure) return next();
    const host = req.headers.host;
    return res.redirect('https://' + host + req.originalUrl);
  });
}

app.use(express.static(PUBLIC_DIR));

let sockets = new Set();

function broadcast(event, payload) {
  const msg = JSON.stringify({ event, payload });
  for (const ws of sockets) {
    try {
      ws.send(msg);
    } catch {}
  }
}

// Seed minimal data if not present
const seed = {
  users: [
    { id: uuidv4(), name: 'Admin', email: 'admin@local', role: 'admin', password: 'admin123' },
    { id: uuidv4(), name: 'Operador', email: 'op@local', role: 'operator', password: 'op123' }
  ],
  stores: [
    { id: 'loja-1', name: 'Loja Centro' },
    { id: 'loja-2', name: 'Loja Norte' }
  ],
  invoices: [],
  processes: [],
  events: [],
  cameras: [
    { id: 'cam-1', storeId: 'loja-1', name: 'Entrada', url: '' },
    { id: 'cam-2', storeId: 'loja-2', name: 'Caixa', url: '' }
  ],
  vehicles: [
    { id: 'veh-1', plate: 'ABC-1234' },
    { id: 'veh-2', plate: 'XYZ-5678' }
  ],
  layout: []
};

for (const [file, data] of Object.entries({
  'users.json': seed.users,
  'stores.json': seed.stores,
  'invoices.json': seed.invoices,
  'processes.json': seed.processes,
  'events.json': seed.events,
  'cameras.json': seed.cameras,
  'vehicles.json': seed.vehicles,
  'layout.json': seed.layout
})) {
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) writeJson(file, data);
}

// Auth
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const users = readJson('users.json') || [];
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
  const token = signToken({ id: user.id, role: user.role, name: user.name, email: user.email });
  res.json({ token, user: { id: user.id, role: user.role, name: user.name, email: user.email } });
});

// Firebase public config
app.get('/api/firebase-config', (req, res) => {
  res.json({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || ''
  });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// Layout widgets
app.get('/api/layout', authMiddleware, (req, res) => {
  res.json(readJson('layout.json') || []);
});
app.post('/api/layout', authMiddleware, requireRole(['admin', 'operator']), (req, res) => {
  writeJson('layout.json', req.body || []);
  broadcast('layout:update', req.body || []);
  res.json({ ok: true });
});

// Cameras autoconfig (env-driven, avoids storing secrets in code)
app.get('/api/cameras/autoconfig/cam1', authMiddleware, (req, res) => {
  try {
    const base = (req.query.base || process.env.CAM1_URL || 'http://127.0.0.1:52660');
    const user = process.env.CAM1_USER || '';
    const pass = process.env.CAM1_PASS || '';
    if (!user || !pass) return res.status(400).json({ error: 'Credenciais CAM1 ausentes (CAM1_USER/CAM1_PASS)' });
    const url = new URL(base);
    const proto = url.protocol || 'http:';
    const host = url.host || '127.0.0.1:52660';
    const userinfo = encodeURIComponent(user) + ':' + encodeURIComponent(pass) + '@';
    const snapshot = `${proto}//${userinfo}${host}/cgi-bin/snapshot.cgi`;
    const mjpeg = `${proto}//${userinfo}${host}/cgi-bin/mjpg/video.cgi?channel=1&subtype=1`;
    res.json({ snapshot, mjpeg });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Proxy snapshot through same origin to avoid browser auth/CORS prompts
app.get('/api/cameras/cam1/snapshot', authMiddleware, async (req, res) => {
  try {
    const base = (req.query.base || process.env.CAM1_URL || 'http://127.0.0.1:52660');
    const user = process.env.CAM1_USER || '';
    const pass = process.env.CAM1_PASS || '';
    if (!user || !pass) return res.status(400).json({ error: 'Credenciais CAM1 ausentes' });
    const url = new URL('/cgi-bin/snapshot.cgi', base).href;
    const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    const resp = await fetch(url, { headers: { 'Authorization': auth } });
    if (!resp.ok) return res.status(502).send(await resp.text());
    const ct = resp.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await resp.arrayBuffer());
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});

// Billing
app.get('/api/billing', authMiddleware, (req, res) => {
  const { storeId, status, minValue, maxValue, startDate, endDate } = req.query;
  let invoices = readJson('invoices.json') || [];
  if (storeId) invoices = invoices.filter(i => i.storeId === storeId);
  if (status) invoices = invoices.filter(i => i.status === status);
  if (minValue) invoices = invoices.filter(i => i.amount >= Number(minValue));
  if (maxValue) invoices = invoices.filter(i => i.amount <= Number(maxValue));
  if (startDate) invoices = invoices.filter(i => new Date(i.date) >= new Date(startDate));
  if (endDate) invoices = invoices.filter(i => new Date(i.date) <= new Date(endDate));
  res.json(invoices);
});
app.post('/api/billing', authMiddleware, requireRole(['admin']), (req, res) => {
  const invoices = readJson('invoices.json') || [];
  const inv = { id: uuidv4(), ...req.body };
  invoices.push(inv);
  writeJson('invoices.json', invoices);
  broadcast('billing:update', inv);
  res.json(inv);
});
app.get('/api/billing/report.csv', authMiddleware, (req, res) => {
  const invoices = readJson('invoices.json') || [];
  const rows = [['Loja','Fatura','Valor','Data','Status']].concat(
    invoices.map(i => [i.storeId, i.id, i.amount, i.date, i.status])
  );
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="faturamento.csv"');
  res.send(csv);
});
app.get('/api/billing/report.html', authMiddleware, (req, res) => {
  const invoices = readJson('invoices.json') || [];
  const rows = invoices.map(i => `<tr><td>${i.storeId}</td><td>${i.id}</td><td>${i.amount}</td><td>${i.date}</td><td>${i.status}</td></tr>`).join('');
  res.setHeader('Content-Type','text/html');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Relatório</title></head><body><h1>Relatório de Faturamento</h1><table border="1"><thead><tr><th>Loja</th><th>Fatura</th><th>Valor</th><th>Data</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
});

// Processes
app.get('/api/processes', authMiddleware, (req, res) => {
  res.json(readJson('processes.json') || []);
});
app.post('/api/processes', authMiddleware, requireRole(['admin','operator']), (req, res) => {
  const processes = readJson('processes.json') || [];
  const proc = { id: uuidv4(), history: [], ...req.body };
  processes.push(proc);
  writeJson('processes.json', processes);
  broadcast('processes:update', proc);
  res.json(proc);
});
app.put('/api/processes/:id', authMiddleware, requireRole(['admin','operator']), (req, res) => {
  const processes = readJson('processes.json') || [];
  const idx = processes.findIndex(p => p.id === req.params.id);
  const base = idx >= 0 ? processes[idx] : { id: req.params.id, history: [] };
  const next = { ...base, ...req.body };
  if (idx >= 0) processes[idx] = next;
  else processes.push(next);
  writeJson('processes.json', processes);
  broadcast('processes:update', next);
  res.json(next);
});
function fetchText(u, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = urlLib.parse(u);
      const lib = parsed.protocol === 'https:' ? https : http;
      const opts = { headers: { 'User-Agent': 'Mozilla/5.0 (Dashboard Robot)' } };
      const req = lib.get(u, opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchText(res.headers.location, { timeoutMs }).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode >= 400) {
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk.toString('utf-8'); });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => { try { req.destroy(); } catch {} reject(new Error('timeout')); });
      req.end();
    } catch (e) { reject(e); }
  });
}
function parseMovements(html, originUrl) {
  const text = String(html || '').replace(/\s+/g, ' ').trim();
  const items = [];
  const host = (() => { try { return new URL(originUrl || '').hostname || ''; } catch { return ''; } })();
  let dateRegex = /(\d{2}\/\d{2}\/\d{4})([^<]{0,160})/g;
  if (/jusbrasil\.com\.br$/i.test(host)) {
    dateRegex = /(\d{2}\/\d{2}\/\d{4}).{0,20}?(Andamento[s]?:\s*[^<]{1,160})/gi;
  }
  let m;
  while ((m = dateRegex.exec(text)) && items.length < 50) {
    const dateStr = m[1];
    const desc = (m[2] || '').trim();
    items.push({ dateStr, desc });
  }
  if (!items.length && text) {
    const snippet = text.slice(0, 280);
    items.push({ dateStr: new Date().toLocaleDateString('pt-BR'), desc: snippet });
  }
  const summary = items.length ? (items[0].desc || 'Atualização capturada') : 'Sem dados';
  return { summary, items, rawLength: text.length };
}
async function scanProcess(proc) {
  if (!proc || !proc.link) return { ok: false, reason: 'Sem link' };
  let html = '';
  try {
    const tryFetch = async () => {
      try { return await fetchText(proc.link); } catch (e) { return null; }
    };
    html = await tryFetch();
    if (!html) { await new Promise(r => setTimeout(r, 800)); html = await tryFetch(); }
    if (!html) throw new Error('Falha ao obter HTML');
  } catch (e) {
    const entry = { id: uuidv4(), date: new Date().toISOString(), error: true, message: 'Falha ao acessar link' };
    const processes = readJson('processes.json') || [];
    const idx = processes.findIndex(p => p.id === proc.id);
    if (idx >= 0) {
      processes[idx].history = processes[idx].history || [];
      processes[idx].history.push(entry);
      processes[idx].lastErrorAt = new Date().toISOString();
      processes[idx].lastAttempts = (processes[idx].lastAttempts || 0) + 1;
      writeJson('processes.json', processes);
      broadcast('processes:history', { processId: proc.id, entry });
    }
    return { ok: false, reason: 'Falha ao acessar link' };
  }
  const { summary, items } = parseMovements(html, proc.link);
  const fingerprint = String(summary).slice(0, 140);
  const processes = readJson('processes.json') || [];
  const idx = processes.findIndex(p => p.id === proc.id);
  if (idx < 0) return { ok: false, reason: 'Processo não encontrado' };
  const last = processes[idx].lastFingerprint || '';
  if (last === fingerprint) return { ok: true, noChange: true };
  const entry = {
    id: uuidv4(),
    date: new Date().toISOString(),
    summary,
    movements: items.map(i => ({
      date: i.dateStr,
      text: i.desc
    }))
  };
  processes[idx].history = processes[idx].history || [];
  processes[idx].history.push(entry);
  processes[idx].lastFingerprint = fingerprint;
  processes[idx].lastOkAt = new Date().toISOString();
  writeJson('processes.json', processes);
  broadcast('processes:history', { processId: proc.id, entry });
  return { ok: true, entry };
}
app.post('/api/processes/:id/scan', authMiddleware, requireRole(['admin','operator']), async (req, res) => {
  const processes = readJson('processes.json') || [];
  const proc = processes.find(p => p.id === req.params.id);
  if (!proc) return res.status(404).json({ error: 'Processo não encontrado' });
  const result = await scanProcess(proc);
  res.json(result);
});
app.post('/api/processes/:id/history', authMiddleware, requireRole(['admin','operator']), (req, res) => {
  const processes = readJson('processes.json') || [];
  const idx = processes.findIndex(p => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Processo não encontrado' });
  const entry = { id: uuidv4(), date: new Date().toISOString(), ...req.body };
  processes[idx].history = processes[idx].history || [];
  processes[idx].history.push(entry);
  processes[idx].lastOkAt = new Date().toISOString();
  writeJson('processes.json', processes);
  broadcast('processes:history', { processId: req.params.id, entry });
  res.json(entry);
});
// Endpoint de teste: página mock de processo para E2E
app.get('/api/test/process-page', authMiddleware, (req, res) => {
  const rev = String(req.query.rev || '1');
  const date = new Date().toLocaleDateString('pt-BR');
  const mov = rev === '1' ? 'Distribuído' : (rev === '2' ? 'Concluso para Despacho' : 'Baixa de Distribuição');
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(`<!doctype html><html><body><h1>Processo Mock</h1><div>Data: ${date}</div><div>Andamento: ${mov}</div></body></html>`);
});
app.get('/api/processes/scan/status', authMiddleware, (req, res) => {
  const processes = readJson('processes.json') || [];
  const items = processes.map(p => ({
    id: p.id,
    autor: p.autor || '',
    link: p.link || '',
    lastOkAt: p.lastOkAt || null,
    lastErrorAt: p.lastErrorAt || null,
    lastFingerprint: p.lastFingerprint || null,
    attempts: p.lastAttempts || 0
  }));
  res.json({ items });
});
app.post('/api/processes/alerts/send', authMiddleware, requireRole(['admin','operator']), async (req, res) => {
  try {
    const ok = await sendDailyProcessEmail();
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});
function appendScanLog(rec) {
  try {
    const fp = path.join(DATA_DIR, 'process-scan-logs.json');
    const arr = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf-8')) : [];
    arr.push(rec);
    fs.writeFileSync(fp, JSON.stringify(arr, null, 2), 'utf-8');
  } catch {}
}
async function runProcessAudit() {
  const processes = readJson('processes.json') || [];
  const results = [];
  for (const p of processes) {
    const start = new Date().toISOString();
    let status = 'ok';
    let updated = false;
    let obs = '';
    let entry = null;
    try {
      const r = await scanProcess(p);
      if (r && r.ok) {
        if (r.entry) {
          updated = true;
          entry = r.entry;
          obs = r.entry.summary || '';
        } else {
          updated = false;
          obs = 'Sem mudanças';
        }
      } else {
        status = 'error';
        updated = false;
        obs = 'Falha ao acessar';
      }
    } catch {
      status = 'error';
      updated = false;
      obs = 'Erro inesperado';
    }
    const end = new Date().toISOString();
    results.push({
      id: p.id,
      autor: p.autor || '',
      link: p.link || '',
      updated,
      status,
      start,
      end,
      summary: obs,
      entry
    });
    appendScanLog({ id: p.id, at: end, status, updated });
  }
  const stamp = new Date().toISOString().replace(/[:]/g, '').slice(0,19);
  const base = 'process-audit-' + stamp;
  const jsonFp = path.join(DATA_DIR, base + '.json');
  fs.writeFileSync(jsonFp, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), 'utf-8');
  const rows = results.map(r => {
    const hl = r.updated ? ' style="background:#e6ffed"' : '';
    const title = r.autor || r.id;
    const link = r.link ? `<div>Link: ${r.link}</div>` : '';
    const status = r.updated ? 'Atualizado' : (r.status === 'error' ? 'Erro' : 'Não atualizado');
    const when = new Date(r.end).toLocaleString('pt-BR');
    const entryHtml = r.entry ? `<div>${(r.entry.movements||[]).slice(0,3).map(m=>`${m.date||''} - ${m.text||''}`).join('<br>')}</div>` : '';
    return `<section${hl}><h3>${title}</h3><div>Status: ${status}</div><div>Última verificação: ${when}</div>${link}<div>Observações: ${r.summary || ''}</div>${entryHtml}</section>`;
  }).join('<hr>');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Relatório de Processos</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:16px}h1{margin:0 0 12px}section{padding:10px;border:1px solid #ddd;border-radius:8px}</style></head><body><h1>Relatório de Verificação de Processos</h1>${rows || '<div>Sem processos</div>'}</body></html>`;
  const htmlFp = path.join(DATA_DIR, base + '.html');
  fs.writeFileSync(htmlFp, html, 'utf-8');
  return { htmlFile: path.basename(htmlFp), jsonFile: path.basename(jsonFp), results };
}
app.post('/api/processes/audit', authMiddleware, requireRole(['admin','operator']), async (req, res) => {
  try {
    const out = await runProcessAudit();
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});
app.get('/api/processes/audit/latest', authMiddleware, (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => /^process-audit-.*\.html$/.test(f)).sort();
    const last = files[files.length - 1];
    if (!last) return res.status(404).send('Sem relatório');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(fs.readFileSync(path.join(DATA_DIR, last), 'utf-8'));
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});

// Calendar
app.get('/api/events', authMiddleware, (req, res) => {
  res.json(readJson('events.json') || []);
});
app.post('/api/events', authMiddleware, requireRole(['admin','operator']), (req, res) => {
  const events = readJson('events.json') || [];
  const ev = { id: uuidv4(), ...req.body };
  events.push(ev);
  writeJson('events.json', events);
  broadcast('events:update', ev);
  res.json(ev);
});
app.delete('/api/events/:id', authMiddleware, requireRole(['admin','operator']), (req, res) => {
  let events = readJson('events.json') || [];
  events = events.filter(e => e.id !== req.params.id);
  writeJson('events.json', events);
  broadcast('events:delete', { id: req.params.id });
  res.json({ ok: true });
});
app.get('/api/events/ics-url', authMiddleware, (req, res) => {
  try {
    const t = signToken({ type: 'ics', uid: req.user.id });
    const origin = req.headers.origin || `http://localhost:${process.env.PORT || 3000}`;
    const url = `${origin}/api/events.ics?t=${encodeURIComponent(t)}`;
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});
app.get('/api/events.ics', async (req, res) => {
  try {
    const SECRET = process.env.JWT_SECRET || 'dev-secret';
    const t = req.query.t || '';
    if (!t) return res.status(401).send('Unauthorized');
    let payload;
    try { payload = jwt.verify(String(t), SECRET); } catch { return res.status(401).send('Unauthorized'); }
    if (!payload || payload.type !== 'ics') return res.status(401).send('Unauthorized');
    let events = [];
    try {
      const access = await getCalendarAccessToken();
      const now = new Date();
      const timeMin = new Date(now.getTime() - 7*24*60*60*1000).toISOString();
      const timeMax = new Date(now.getTime() + 90*24*60*60*1000).toISOString();
      const params = new URLSearchParams({
        calendarId: 'primary',
        maxResults: '300',
        singleEvents: 'true',
        orderBy: 'startTime',
        timeMin,
        timeMax
      });
      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`;
      const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${access}` } });
      if (resp.ok) {
        const json = await resp.json();
        const items = Array.isArray(json.items) ? json.items : [];
        events = items.map(i => ({
          id: i.id,
          summary: i.summary || '',
          start: i.start?.dateTime || i.start?.date || '',
          end: i.end?.dateTime || i.end?.date || '',
          location: i.location || '',
          description: i.description || ''
        }));
      } else {
        events = readJson('events.json') || [];
      }
    } catch {
      events = readJson('events.json') || [];
    }
    const fmt = (d) => {
      const x = new Date(d);
      const y = new Date(x.getTime() - x.getTimezoneOffset()*60000);
      const s = y.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';
      return s;
    };
    const lines = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//DescomplicarAFAO//Dashboard//PT');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    events.forEach(ev => {
      const uid = (ev.id || uuidv4()) + '@dashboard';
      const summary = (ev.summary || ev.title || '').replace(/\r?\n/g,' ');
      const description = (ev.description || '').replace(/\r?\n/g,' ');
      const location = (ev.location || '').replace(/\r?\n/g,' ');
      const start = ev.start || ev.date || new Date().toISOString();
      const end = ev.end || '';
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + uid);
      lines.push('DTSTAMP:' + fmt(new Date().toISOString()));
      lines.push('DTSTART:' + fmt(start));
      if (end) lines.push('DTEND:' + fmt(end));
      if (summary) lines.push('SUMMARY:' + summary);
      if (location) lines.push('LOCATION:' + location);
      if (description) lines.push('DESCRIPTION:' + description);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(lines.join('\r\n'));
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});

// Cameras
app.get('/api/cameras', authMiddleware, (req, res) => {
  res.json(readJson('cameras.json') || []);
});
app.post('/api/cameras', authMiddleware, requireRole(['admin']), (req, res) => {
  const cams = readJson('cameras.json') || [];
  const cam = { id: uuidv4(), ...req.body };
  cams.push(cam);
  writeJson('cameras.json', cams);
  broadcast('cameras:update', cam);
  res.json(cam);
});
app.post('/api/cameras/:id/snapshot', authMiddleware, requireRole(['admin','operator']), (req, res) => {
  const { imageData } = req.body || {};
  if (!imageData) return res.status(400).json({ error: 'Sem imagem' });
  const file = path.join(DATA_DIR, `snapshot-${req.params.id}-${Date.now()}.png`);
  const base64 = imageData.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(file, Buffer.from(base64, 'base64'));
  res.json({ ok: true, file: path.basename(file) });
});

// Google Calendar OAuth + Events
function readCalendarOAuth() {
  try {
    const fp = path.join(DATA_DIR, 'google_calendar_oauth.json');
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch { return null; }
}
app.get('/api/google-calendar/status', authMiddleware, (req, res) => {
  const j = readCalendarOAuth();
  res.json({ connected: !!(j && j.refresh_token) });
});
app.get('/api/google-calendar/oauth/url', authMiddleware, async (req, res) => {
  const client_id = process.env.GOOGLE_CAL_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_ID || '';
  const client_secret = process.env.GOOGLE_CAL_CLIENT_SECRET || process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '';
  if (!client_id || !client_secret) return res.status(400).json({ error: 'Credenciais ausentes' });
  const origin = req.query.origin || (req.headers.origin || '');
  const redirect = (process.env.GOOGLE_CAL_REDIRECT_URL || `${origin}/api/google-calendar/oauth/callback`);
  const params = new URLSearchParams({
    client_id,
    redirect_uri: redirect,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/calendar.readonly'
  });
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
});
app.get('/api/google-calendar/oauth/callback', async (req, res) => {
  try {
    const code = req.query.code || '';
    const client_id = process.env.GOOGLE_CAL_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_ID || '';
    const client_secret = process.env.GOOGLE_CAL_CLIENT_SECRET || process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '';
    const origin = req.headers.origin || '';
    const redirect = (process.env.GOOGLE_CAL_REDIRECT_URL || `${origin}/api/google-calendar/oauth/callback`);
    if (!code || !client_id || !client_secret) return res.status(400).send('OAuth incompleto');
    const body = new URLSearchParams({
      code,
      client_id,
      client_secret,
      redirect_uri: redirect,
      grant_type: 'authorization_code'
    });
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!resp.ok) return res.status(400).send(await resp.text());
    const json = await resp.json();
    const fp = path.join(DATA_DIR, 'google_calendar_oauth.json');
    fs.writeFileSync(fp, JSON.stringify(json, null, 2), 'utf-8');
    res.setHeader('Content-Type','text/html');
    res.send('<!doctype html><html><body><script>window.close();</script>Conectado. Você pode fechar esta janela.</body></html>');
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});
async function getCalendarAccessToken() {
  const j = readCalendarOAuth() || {};
  const refresh_token = j.refresh_token || process.env.GOOGLE_CAL_REFRESH_TOKEN || '';
  const client_id = process.env.GOOGLE_CAL_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_ID || '';
  const client_secret = process.env.GOOGLE_CAL_CLIENT_SECRET || process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '';
  if (!refresh_token || !client_id || !client_secret) throw new Error('OAuth Google Calendar ausente');
  const body = new URLSearchParams({
    client_id, client_secret, refresh_token, grant_type: 'refresh_token'
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!resp.ok) throw new Error('Falha token: ' + (await resp.text()));
  const json = await resp.json();
  return json.access_token;
}
app.get('/api/google-calendar/events', authMiddleware, async (req, res) => {
  try {
    const access = await getCalendarAccessToken();
    const now = new Date();
    const timeMin = new Date(now.getTime() - 7*24*60*60*1000).toISOString();
    const timeMax = new Date(now.getTime() + 90*24*60*60*1000).toISOString();
    const params = new URLSearchParams({
      calendarId: 'primary',
      maxResults: '100',
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin,
      timeMax
    });
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`;
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${access}` }
    });
    if (!resp.ok) return res.status(400).json({ error: await resp.text() });
    const json = await resp.json();
    const items = Array.isArray(json.items) ? json.items : [];
    const events = items.map(i => ({
      id: i.id,
      summary: i.summary || '',
      start: i.start?.dateTime || i.start?.date || '',
      end: i.end?.dateTime || i.end?.date || '',
      location: i.location || '',
      description: i.description || ''
    }));
    res.json({ items: events });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// (removido) Google Custom Search integrado — revertido para pesquisa externa

app.get('/api/auth/google/url', async (req, res) => {
  try {
    const client_id = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CAL_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_ID || '';
    const client_secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CAL_CLIENT_SECRET || process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '';
    if (!client_id || !client_secret) return res.status(400).json({ error: 'Credenciais Google OAuth ausentes' });
    const origin = req.query.origin || (req.headers.origin || '');
    const redirect = (process.env.GOOGLE_OAUTH_REDIRECT_URL || `${origin}/api/auth/google/callback`);
    const params = new URLSearchParams({
      client_id,
      redirect_uri: redirect,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: 'openid email profile'
    });
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});
app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const code = req.query.code || '';
    const client_id = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CAL_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_ID || '';
    const client_secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CAL_CLIENT_SECRET || process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '';
    const origin = req.headers.origin || '';
    const redirect = (process.env.GOOGLE_OAUTH_REDIRECT_URL || `${origin}/api/auth/google/callback`);
    if (!code || !client_id || !client_secret) return res.status(400).send('OAuth incompleto');
    const body = new URLSearchParams({
      code,
      client_id,
      client_secret,
      redirect_uri: redirect,
      grant_type: 'authorization_code'
    });
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!resp.ok) return res.status(400).send(await resp.text());
    const json = await resp.json();
    const access = json.access_token || '';
    if (!access) return res.status(400).send('Sem access token');
    const uinfo = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${access}` }
    }).then(r => r.json());
    const email = uinfo.email || '';
    const name = uinfo.name || (uinfo.given_name || '') || 'Usuário';
    if (!email) return res.status(400).send('Sem email');
    const users = readJson('users.json') || [];
    let user = users.find(u => u.email === email);
    if (!user) {
      user = { id: uuidv4(), name, email, role: 'operator', password: null };
      users.push(user);
      writeJson('users.json', users);
    }
    const token = signToken({ id: user.id, role: user.role, name: user.name, email: user.email });
    res.setHeader('Content-Type','text/html');
    res.send(`<!doctype html><html><body><script>
      try { window.opener && window.opener.postMessage({ type: 'google-login', token: '${token}' }, '*'); } catch(e) {}
      window.close();
    </script>Login concluído. Você pode fechar esta janela.</body></html>`);
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});
// Vehicles
app.get('/api/vehicles', authMiddleware, (req, res) => {
  res.json(readJson('vehicles.json') || []);
});
app.get('/api/vehicles/routes', authMiddleware, (req, res) => {
  const fp = path.join(DATA_DIR, 'routes.json');
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, '[]', 'utf-8');
  res.json(JSON.parse(fs.readFileSync(fp, 'utf-8')));
});
app.post('/api/vehicles/routes', authMiddleware, requireRole(['admin','operator']), (req, res) => {
  const fp = path.join(DATA_DIR, 'routes.json');
  const routes = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp,'utf-8')) : [];
  const route = { id: uuidv4(), ...req.body };
  routes.push(route);
  fs.writeFileSync(fp, JSON.stringify(routes, null, 2), 'utf-8');
  broadcast('vehicles:routes', route);
  res.json(route);
});

let server;
try {
  const certFile = process.env.SSL_CERT_FILE || '';
  const keyFile = process.env.SSL_KEY_FILE || '';
  if (certFile && keyFile && fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    const ssl = { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
    server = https.createServer(ssl, app);
    console.log('HTTPS habilitado');
  } else {
    server = http.createServer(app);
  }
} catch {
  server = http.createServer(app);
}
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.on('close', () => sockets.delete(ws));
});
wss.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.log(`Servidor já ativo em http://localhost:${PORT} — reutilizando`);
    try { server.close(); } catch {}
    process.exit(0);
  }
});

scheduleDailyBackup(DATA_DIR, BACKUP_DIR);
async function scanAll() {
  const processes = readJson('processes.json') || [];
  let running = 0;
  for (const proc of processes) {
    const run = async () => { try { await scanProcess(proc); } catch {} };
    while (running >= 4) { await new Promise(r => setTimeout(r, 300)); }
    running++;
    await run();
    running--;
  }
}
setTimeout(() => { scanAll(); }, 5000);
const SCAN_MIN = Number(process.env.PROCESS_SCAN_INTERVAL_MINUTES || 60);
const SCAN_MS = Math.max(1, SCAN_MIN) * 60 * 1000;
setInterval(() => { scanAll(); }, SCAN_MS);

function formatDailyReport() {
  const processes = readJson('processes.json') || [];
  const now = Date.now();
  const start = now - 24*60*60*1000;
  const rows = processes.map(p => {
    const hist = (p.history || []).filter(h => {
      const t = new Date(h.date || Date.now()).getTime();
      return t >= start;
    }).map(h => {
      const t = new Date(h.date || Date.now()).toLocaleString('pt-BR');
      const movs = Array.isArray(h.movements) ? h.movements.map(m => `${m.date || ''} - ${m.text || ''}`).join('<br>') : (h.summary || h.message || '');
      return `<tr><td>${t}</td><td>${movs}</td></tr>`;
    }).join('');
    const title = p.autor || 'Processo';
    const link = p.link || '';
    const table = hist ? (`<table border="1" cellpadding="4" cellspacing="0"><thead><tr><th>Data/Hora</th><th>Movimentos</th></tr></thead><tbody>${hist}</tbody></table>`) : '<div>Sem atualizações nas últimas 24h</div>';
    return `<h3>${title}</h3>${link ? `<div>Link: ${link}</div>` : ''}${table}`;
  }).join('<hr>');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Resumo diário</title></head><body><h1>Resumo diário de andamentos</h1>${rows || '<div>Sem processos cadastrados</div>'}</body></html>`;
  const text = (processes || []).map(p => {
    const title = p.autor || 'Processo';
    const hist = (p.history || []).filter(h => {
      const t = new Date(h.date || Date.now()).getTime();
      return t >= start;
    }).map(h => {
      const t = new Date(h.date || Date.now()).toLocaleString('pt-BR');
      const movs = Array.isArray(h.movements) ? h.movements.map(m => `${m.date || ''} - ${m.text || ''}`).join(' | ') : (h.summary || h.message || '');
      return `- ${t}: ${movs}`;
    }).join('\n');
    return `${title}\n${hist || 'Sem atualizações'}`;
  }).join('\n\n');
  return { html, text };
}
async function sendDailyProcessEmail() {
  const to = (process.env.ALERT_EMAILS || 'rwaynne84@gmail.com').split(',')[0].trim();
  const host = process.env.SMTP_HOST || '';
  if (!to || !host) return false;
  const { html, text } = formatDailyReport();
  try {
    await sendEmail({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE || 'true') === 'true',
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
      from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
      to,
      subject: 'Resumo diário de andamentos de processos',
      text,
      html
    });
    return true;
  } catch {
    return false;
  }
}
function extractCNJ(str) {
  const m = String(str || '').match(/(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/);
  return m ? m[1] : '';
}
function buildIndividualEmail({ proc, updates }) {
  const numero = extractCNJ(proc.autor || '') || extractCNJ(proc.link || '');
  const ativo = (proc.autor || '').split(' x ')[0] || '';
  const passivo = (proc.autor || '').split(' x ')[1] || '';
  const classe = '';
  const orgao = '';
  const autuacao = '';
  const assunto = '';
  const rows = updates.map(u => {
    const movs = Array.isArray(u.movements) ? u.movements : [];
    const first = movs[0] || { date: '', text: (u.summary || '') };
    const dt = first.date || (u.date ? new Date(u.date).toLocaleString('pt-BR') : '');
    const tx = first.text || (u.summary || '');
    return `<tr><td>${dt}</td><td>${tx}</td></tr>`;
  }).join('');
  const table = rows ? `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse"><thead><tr><th>Data</th><th>Movimento</th></tr></thead><tbody>${rows}</tbody></table>` : '<div>Sem novas movimentações</div>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>PJe Push</title></head><body><div style="font-family:Arial,Helvetica,sans-serif">
  <h2>PJe Push - Serviço de Acompanhamento automático de processos</h2>
  <p>Prezado(a),</p>
  <p>Informamos que o processo a seguir sofreu movimentação:</p>
  <div>Número do Processo: ${numero || '—'}</div>
  <div>Polo Ativo: ${ativo || '—'}</div>
  <div>Polo Passivo: ${passivo || '—'}</div>
  <div>Classe Judicial: ${classe || '—'}</div>
  <div>Órgão: ${orgao || '—'}</div>
  <div>Data da Autuação: ${autuacao || '—'}</div>
  <div>Assunto: ${assunto || '—'}</div>
  <div style="margin-top:12px">${table}</div>
  <div style="margin-top:12px">Link: ${proc.link || '—'}</div>
  </div></body></html>`;
  const text = `PJe Push - Serviço de Acompanhamento automático de processos
Número do Processo: ${numero || '—'}
Polo Ativo: ${ativo || '—'}
Polo Passivo: ${passivo || '—'}
Classe Judicial: ${classe || '—'}
Órgão: ${orgao || '—'}
Data da Autuação: ${autuacao || '—'}
Assunto: ${assunto || '—'}
${updates.map(u => {
  const movs = Array.isArray(u.movements) ? u.movements : [];
  const first = movs[0] || { date: '', text: (u.summary || '') };
  const dt = first.date || (u.date ? new Date(u.date).toLocaleString('pt-BR') : '');
  const tx = first.text || (u.summary || '');
  return `- ${dt} - ${tx}`;
}).join('\n')}`;
  return { html, text, numero };
}
async function sendDailyProcessEmailsIndividuals() {
  const host = process.env.SMTP_HOST || '';
  const to = (process.env.ALERT_EMAILS || 'rwaynne84@gmail.com').split(',')[0].trim();
  if (!host || !to) return false;
  const processes = readJson('processes.json') || [];
  const since = Date.now() - 24*60*60*1000;
  let sent = 0;
  for (const p of processes) {
    const updates = (p.history || []).filter(h => {
      const t = new Date(h.date || Date.now()).getTime();
      return t >= since;
    });
    if (!updates.length) continue;
    const payload = buildIndividualEmail({ proc: p, updates });
    try {
      await sendEmail({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 465),
        secure: String(process.env.SMTP_SECURE || 'true') === 'true',
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
        to,
        subject: `Movimentação de processo ${payload.numero || (p.autor || p.id)}`,
        text: payload.text,
        html: payload.html
      });
      sent++;
    } catch {}
  }
  return sent > 0;
}
function scheduleDailyAlerts() {
  const ms = 24 * 60 * 60 * 1000;
  setTimeout(() => { sendDailyProcessEmailsIndividuals().catch(()=>{}); }, 120000);
  setInterval(() => { sendDailyProcessEmailsIndividuals().catch(()=>{}); }, ms);
}
scheduleDailyAlerts();
app.post('/api/processes/alerts/send-individual', authMiddleware, requireRole(['admin','operator']), async (req, res) => {
  try {
    const ok = await sendDailyProcessEmailsIndividuals();
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.log(`Servidor já ativo em http://localhost:${PORT} — reutilizando`);
    process.exit(0);
  }
});
server.listen(PORT, () => {
  console.log(`Dashboard iniciado em http://localhost:${PORT}`);
});
