const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
require('dotenv').config();
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { scheduleDailyBackup } = require('./lib/backup');
const { signToken, authMiddleware, requireRole } = require('./lib/auth');

const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const BACKUP_DIR = path.join(__dirname, 'backups');

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
app.post('/api/processes/:id/history', authMiddleware, requireRole(['admin','operator']), (req, res) => {
  const processes = readJson('processes.json') || [];
  const idx = processes.findIndex(p => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Processo não encontrado' });
  const entry = { id: uuidv4(), date: new Date().toISOString(), ...req.body };
  processes[idx].history = processes[idx].history || [];
  processes[idx].history.push(entry);
  writeJson('processes.json', processes);
  broadcast('processes:history', { processId: req.params.id, entry });
  res.json(entry);
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

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.on('close', () => sockets.delete(ws));
});

scheduleDailyBackup(DATA_DIR, BACKUP_DIR);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Dashboard iniciado em http://localhost:${PORT}`);
});
