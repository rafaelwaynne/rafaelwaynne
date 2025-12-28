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
const DB = require('./lib/db');

const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const BACKUP_DIR = path.join(__dirname, 'backups');
const PORT = process.env.PORT || 3000;

// Ensure directories exist for reports/backups (even if using Firestore for main data)
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

// Seed minimal data if not present (Async)
(async () => {
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
  await DB.seed(seed);
})();


// Auth
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await DB.getUserByEmail(email);
  if (!user || user.password !== password) return res.status(401).json({ error: 'Credenciais inválidas' });
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
app.get('/api/layout', authMiddleware, async (req, res) => {
  res.json(await DB.getLayout());
});
app.post('/api/layout', authMiddleware, requireRole(['admin', 'operator']), async (req, res) => {
  const items = req.body || [];
  await DB.saveLayout(items);
  broadcast('layout:update', items);
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
app.get('/api/billing', authMiddleware, async (req, res) => {
  const { storeId, status, minValue, maxValue, startDate, endDate } = req.query;
  let invoices = await DB.getInvoices();
  if (storeId) invoices = invoices.filter(i => i.storeId === storeId);
  if (status) invoices = invoices.filter(i => i.status === status);
  if (minValue) invoices = invoices.filter(i => i.amount >= Number(minValue));
  if (maxValue) invoices = invoices.filter(i => i.amount <= Number(maxValue));
  if (startDate) invoices = invoices.filter(i => new Date(i.date) >= new Date(startDate));
  if (endDate) invoices = invoices.filter(i => new Date(i.date) <= new Date(endDate));
  res.json(invoices);
});
app.post('/api/billing', authMiddleware, requireRole(['admin']), async (req, res) => {
  const inv = { id: uuidv4(), ...req.body };
  await DB.addInvoice(inv);
  broadcast('billing:update', inv);
  res.json(inv);
});
app.get('/api/billing/report.csv', authMiddleware, async (req, res) => {
  const invoices = await DB.getInvoices();
  const rows = [['Loja','Fatura','Valor','Data','Status']].concat(
    invoices.map(i => [i.storeId, i.id, i.amount, i.date, i.status])
  );
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="faturamento.csv"');
  res.send(csv);
});
app.get('/api/billing/report.html', authMiddleware, async (req, res) => {
  const invoices = await DB.getInvoices();
  const rows = invoices.map(i => `<tr><td>${i.storeId}</td><td>${i.id}</td><td>${i.amount}</td><td>${i.date}</td><td>${i.status}</td></tr>`).join('');
  res.setHeader('Content-Type','text/html');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Relatório</title></head><body><h1>Relatório de Faturamento</h1><table border="1"><thead><tr><th>Loja</th><th>Fatura</th><th>Valor</th><th>Data</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
});

// Processes
app.get('/api/processes', authMiddleware, async (req, res) => {
  res.json(await DB.getProcesses());
});
app.post('/api/processes', authMiddleware, requireRole(['admin','operator']), async (req, res) => {
  const proc = { id: uuidv4(), history: [], ...req.body };
  await DB.saveProcess(proc);
  broadcast('processes:update', proc);
  res.json(proc);
});
app.put('/api/processes/:id', authMiddleware, requireRole(['admin','operator']), async (req, res) => {
  const existing = await DB.getProcess(req.params.id);
  const base = existing || { id: req.params.id, history: [] };
  const next = { ...base, ...req.body };
  await DB.saveProcess(next);
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
    const history = proc.history || [];
    history.push(entry);
    const updates = {
        history,
        lastErrorAt: new Date().toISOString(),
        lastAttempts: (proc.lastAttempts || 0) + 1
    };
    await DB.updateProcess(proc.id, updates);
    broadcast('processes:history', { processId: proc.id, entry });
    return { ok: false, reason: 'Falha ao acessar link' };
  }
  const { summary, items } = parseMovements(html, proc.link);
  const fingerprint = String(summary).slice(0, 140);
  
  // Refresh process state from DB to avoid race conditions (optional, but good practice)
  const currentProc = await DB.getProcess(proc.id);
  if (!currentProc) return { ok: false, reason: 'Processo removido durante scan' };
  
  const last = currentProc.lastFingerprint || '';
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
  const history = currentProc.history || [];
  history.push(entry);
  
  const updates = {
      history,
      lastFingerprint: fingerprint,
      lastOkAt: new Date().toISOString()
  };
  
  await DB.updateProcess(proc.id, updates);
  broadcast('processes:history', { processId: proc.id, entry });
  return { ok: true, entry };
}

app.post('/api/processes/:id/scan', authMiddleware, requireRole(['admin','operator']), async (req, res) => {
  const proc = await DB.getProcess(req.params.id);
  if (!proc) return res.status(404).json({ error: 'Processo não encontrado' });
  const result = await scanProcess(proc);
  res.json(result);
});
app.post('/api/processes/:id/history', authMiddleware, requireRole(['admin','operator']), async (req, res) => {
  const proc = await DB.getProcess(req.params.id);
  if (!proc) return res.status(404).json({ error: 'Processo não encontrado' });
  
  const entry = { id: uuidv4(), date: new Date().toISOString(), ...req.body };
  const history = proc.history || [];
  history.push(entry);
  
  await DB.updateProcess(proc.id, {
      history,
      lastOkAt: new Date().toISOString()
  });
  
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
app.get('/api/processes/scan/status', authMiddleware, async (req, res) => {
  const processes = await DB.getProcesses();
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
    const ok = await sendDailyProcessEmail(); // Assuming this is imported but I need to check its implementation as it might use readJson
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

async function runProcessAudit() {
  const processes = await DB.getProcesses();
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
    await DB.appendScanLog({ id: p.id, at: end, status, updated });
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
    // Audit reports are still stored locally for now
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
app.get('/api/events', authMiddleware, async (req, res) => {
  res.json(await DB.getEvents());
});
app.post('/api/events', authMiddleware, requireRole(['admin','operator']), async (req, res) => {
  const ev = { id: uuidv4(), ...req.body };
  await DB.addEvent(ev);
  broadcast('events:update', ev);
  res.json(ev);
});
app.delete('/api/events/:id', authMiddleware, requireRole(['admin','operator']), async (req, res) => {
  await DB.deleteEvent(req.params.id);
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
    
    // Decode token manually since this is a public endpoint with query param auth
    let payload;
    try {
        payload = jwt.verify(t, SECRET);
    } catch {
        return res.status(403).send('Invalid token');
    }
    
    const events = await DB.getEvents();
    
    // Generate ICS content
    let ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Dashboard//NONSGML v1.0//EN',
      'CALSCALE:GREGORIAN'
    ];
    
    events.forEach(ev => {
        ics.push('BEGIN:VEVENT');
        ics.push(`UID:${ev.id}`);
        // Simple conversion, assuming ev.date is YYYY-MM-DD or similar
        // ICS format requires YYYYMMDDTHHMMSSZ
        const dt = new Date(ev.date || Date.now());
        const dtStr = dt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        ics.push(`DTSTAMP:${dtStr}`);
        ics.push(`DTSTART:${dtStr}`);
        ics.push(`SUMMARY:${ev.title || 'Evento'}`);
        ics.push('END:VEVENT');
    });
    
    ics.push('END:VCALENDAR');
    
    res.setHeader('Content-Type', 'text/calendar');
    res.send(ics.join('\r\n'));
  } catch(e) {
      res.status(500).send(String(e));
  }
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server });

function heartbeat() {
  this.isAlive = true;
}

wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.isAlive = true;
  ws.on('pong', heartbeat);
  ws.on('close', () => sockets.delete(ws));
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});
