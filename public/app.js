let state = {
  token: null,
  user: null,
  stores: [],
  invoices: [],
  processes: [],
  events: [],
  cameras: [],
  vehicles: [],
  layout: []
};

let fb = {
  app: null,
  db: null
};

function setAuth(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('token', token);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) throw new Error(await res.text());
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  ws.onmessage = (ev) => {
    const { event, payload } = JSON.parse(ev.data);
    if (event === 'billing:update') loadBilling();
    if (event === 'processes:update' || event === 'processes:history') loadProcesses();
    if (event === 'events:update' || event === 'events:delete') loadCalendar();
    if (event === 'cameras:update') loadCameras();
    if (event === 'vehicles:routes') loadVehicles();
    if (event === 'layout:update') applyLayout(payload);
  };
}

function initAuthUI() {
  const loginView = document.getElementById('login-view');
  const app = document.getElementById('app');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const error = document.getElementById('login-error');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const userInfo = document.getElementById('user-info');
  loginBtn.onclick = async () => {
    try {
      const { token, user } = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.value, password: password.value })
      });
      setAuth(token, user);
      loginView.classList.add('hidden');
      app.classList.remove('hidden');
      userInfo.textContent = `${user.name} (${user.role})`;
      bootApp();
    } catch (e) {
      error.textContent = 'Falha no login';
    }
  };
  logoutBtn.onclick = () => {
    localStorage.removeItem('token');
    location.reload();
  };
  const saved = localStorage.getItem('token');
  if (saved) {
    state.token = saved;
    api('/api/me').then(({ user }) => {
      state.user = user;
      userInfo.textContent = `${user.name} (${user.role})`;
      loginView.classList.add('hidden');
      app.classList.remove('hidden');
      bootApp();
    }).catch(() => { localStorage.removeItem('token'); });
  }
}

async function bootApp() {
  connectWS();
  await loadStores();
  await loadLayout();
  initTabs();
  initDrag();
  await Promise.all([loadBilling(), loadProcesses(), loadCalendar(), loadCameras(), loadVehicles()]);
  const btnCreateInvoice = document.getElementById('create-invoice');
  if (btnCreateInvoice && state.user && state.user.role !== 'admin') {
    btnCreateInvoice.disabled = true;
    btnCreateInvoice.title = 'Apenas administradores';
  }
  initSidebar();
  await initFirebase();
}

function initTabs() {
  for (const btn of document.querySelectorAll('.tabs button')) {
    btn.onclick = () => {
      const id = btn.dataset.tab;
      const el = document.querySelector(`.widget[data-id="${id}"]`);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }
}

async function initFirebase() {
  try {
    const cfg = await api('/api/firebase-config');
    if (!cfg.apiKey || !window.firebase) return;
    fb.app = firebase.initializeApp(cfg);
    fb.db = firebase.firestore();
  } catch {}
}

async function loadStores() {
  const stores = await api('/api/billing?storeId=').then(() => api('/api/layout')).catch(()=>[]);
  // fallback: read stores via billing table later
}

async function loadLayout() {
  try {
    const layout = await api('/api/layout');
    state.layout = layout;
    applyLayout(layout);
  } catch {}
}

function applyLayout(layout) {
  const dash = document.getElementById('dashboard');
  layout.forEach(item => {
    const el = dash.querySelector(`.widget[data-id="${item.id}"]`);
    if (el) el.style.order = item.order;
  });
}

function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('menu-toggle');
  if (toggle) {
    toggle.onclick = () => {
      if (getComputedStyle(sidebar).display === 'none') {
        sidebar.style.display = 'block';
      } else {
        sidebar.style.display = 'none';
      }
    };
  }
  const items = Array.from(document.querySelectorAll('.sidebar-item'));
  items.forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.target;
      const el = document.querySelector(`.widget[data-id="${id}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
  const widgets = Array.from(document.querySelectorAll('.widget'));
  document.addEventListener('scroll', () => {
    let activeId = null;
    for (const w of widgets) {
      const rect = w.getBoundingClientRect();
      if (rect.top <= 120 && rect.bottom >= 120) {
        activeId = w.dataset.id;
        break;
      }
    }
    items.forEach(i => i.classList.toggle('active', i.dataset.target === activeId));
  }, { passive: true });
}

function initDrag() {
  const dash = document.getElementById('dashboard');
  let dragEl = null;
  dash.addEventListener('dragstart', (e) => {
    dragEl = e.target.closest('.widget');
    e.dataTransfer.effectAllowed = 'move';
  });
  dash.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target.closest('.widget');
    if (!dragEl || !target || dragEl === target) return;
    const widgets = Array.from(dash.querySelectorAll('.widget'));
    const dragIdx = widgets.indexOf(dragEl);
    const targIdx = widgets.indexOf(target);
    if (dragIdx < targIdx) dash.insertBefore(target, dragEl);
    else dash.insertBefore(dragEl, target);
  });
  dash.addEventListener('dragend', async () => {
    const layout = Array.from(dash.querySelectorAll('.widget')).map((w, idx) => ({ id: w.dataset.id, order: idx }));
    try { await api('/api/layout', { method: 'POST', body: JSON.stringify(layout) }); } catch {}
  });
}

// Billing
async function loadBilling() {
  const storeSel = document.getElementById('filter-store');
  const statusSel = document.getElementById('filter-status');
  const min = document.getElementById('filter-min').value;
  const max = document.getElementById('filter-max').value;
  const start = document.getElementById('filter-start').value;
  const end = document.getElementById('filter-end').value;
  const params = new URLSearchParams();
  if (storeSel.value) params.append('storeId', storeSel.value);
  if (statusSel.value) params.append('status', statusSel.value);
  if (min) params.append('minValue', min);
  if (max) params.append('maxValue', max);
  if (start) params.append('startDate', start);
  if (end) params.append('endDate', end);
  const invoices = await api('/api/billing?' + params.toString());
  state.invoices = invoices;
  const stores = [...new Set(invoices.map(i => i.storeId))];
  storeSel.innerHTML = '<option value="">Loja</option>' + stores.map(s => `<option value="${s}">${s}</option>`).join('');
  renderBillingTable(invoices);
  renderBillingChart(invoices);
  document.getElementById('apply-filters').onclick = loadBilling;
  document.getElementById('export-csv').onclick = () => {
    window.open('/api/billing/report.csv', '_blank');
  };
  document.getElementById('export-pdf').onclick = async () => {
    const html = await api('/api/billing/report.html');
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };
  document.getElementById('create-invoice').onclick = async () => {
    if (!state.user || state.user.role !== 'admin') return;
    const storeId = document.getElementById('new-invoice-store').value;
    const amount = Number(document.getElementById('new-invoice-amount').value);
    const date = document.getElementById('new-invoice-date').value;
    const status = document.getElementById('new-invoice-status').value;
    if (!storeId || !amount || !date) return;
    try {
      await api('/api/billing', { method: 'POST', body: JSON.stringify({ storeId, amount, date, status }) });
      await loadBilling();
    } catch {}
  };
  document.getElementById('firebase-save').onclick = async () => {
    if (!fb.db) return;
    const batch = fb.db.batch();
    state.invoices.forEach(i => {
      const ref = fb.db.collection('invoices').doc(String(i.id));
      batch.set(ref, i, { merge: true });
    });
    await batch.commit();
    alert('Faturas salvas no Firebase');
  };
  document.getElementById('firebase-load').onclick = async () => {
    if (!fb.db) return;
    const snap = await fb.db.collection('invoices').get();
    const invoices = [];
    snap.forEach(doc => invoices.push(doc.data()));
    renderBillingTable(invoices);
    renderBillingChart(invoices);
  };
}

function renderBillingTable(invoices) {
  const t = document.getElementById('billing-table');
  const header = '<tr><th>Loja</th><th>Fatura</th><th>Valor</th><th>Data</th><th>Status</th></tr>';
  const rows = invoices.map(i => `<tr><td>${i.storeId}</td><td>${i.id}</td><td>${i.amount}</td><td>${i.date}</td><td>${i.status}</td></tr>`).join('');
  t.innerHTML = header + rows;
}

function renderBillingChart(invoices) {
  const ctx = document.getElementById('billing-chart');
  const byStore = {};
  invoices.forEach(i => { byStore[i.storeId] = (byStore[i.storeId] || 0) + Number(i.amount); });
  const labels = Object.keys(byStore);
  const data = Object.values(byStore);
  if (ctx._chart) ctx._chart.destroy();
  ctx._chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Valor por Loja', data, backgroundColor: '#22c55e' }] },
    options: { plugins: { legend: { display: false } } }
  });
}

// Processes
async function loadProcesses() {
  const procs = await api('/api/processes');
  state.processes = procs;
  const t = document.getElementById('processes-table');
  const header = '<tr><th>Processo</th><th>Status</th><th>Responsável</th><th>Prazo</th></tr>';
  const rows = procs.map(p => {
    const daysLeft = Math.ceil((new Date(p.deadline) - new Date()) / (24*60*60*1000));
    const dueClass = daysLeft <= 2 ? 'style="color:#f59e0b"' : '';
    return `<tr><td>${p.name||p.id}</td><td>${p.status}</td><td>${p.owner}</td><td ${dueClass}>${p.deadline}</td></tr>`;
  }).join('');
  t.innerHTML = header + rows;
  document.getElementById('create-proc').onclick = async () => {
    const name = document.getElementById('new-proc-name').value;
    const status = document.getElementById('new-proc-status').value;
    const owner = document.getElementById('new-proc-owner').value;
    const deadline = document.getElementById('new-proc-deadline').value;
    if (!name || !owner || !deadline) return;
    try {
      await api('/api/processes', { method: 'POST', body: JSON.stringify({ name, status, owner, deadline }) });
      await loadProcesses();
    } catch {}
  };
}

// Calendar
async function loadCalendar() {
  const events = await api('/api/events');
  state.events = events;
  const el = document.getElementById('calendar');
  if (el._fc) { el._fc.destroy(); }
  const expanded = [];
  const now = new Date();
  const horizon = new Date(now.getTime() + 90*24*60*60*1000);
  events.forEach(e => {
    if (e.recurring && e.recurring.freq === 'weekly') {
      let cur = new Date(e.start);
      const end = e.end ? new Date(e.end) : null;
      while (cur <= horizon) {
        expanded.push({ id: e.id + '-' + cur.toISOString().slice(0,10), title: e.title, start: cur.toISOString(), end: end ? new Date(cur.getTime() + (new Date(e.end) - new Date(e.start))).toISOString() : null });
        cur = new Date(cur.getTime() + 7*24*60*60*1000);
      }
    } else {
      expanded.push({ id: e.id, title: e.title, start: e.start, end: e.end });
    }
  });
  const calendar = new FullCalendar.Calendar(el, {
    initialView: 'dayGridMonth',
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' },
    events: expanded
  });
  calendar.render();
  el._fc = calendar;
  document.getElementById('create-event').onclick = async () => {
    const title = document.getElementById('new-ev-title').value;
    const start = document.getElementById('new-ev-start').value;
    const end = document.getElementById('new-ev-end').value;
    const recurring = document.getElementById('new-ev-recurring').checked;
    if (!title || !start) return;
    const payload = { title, start, end };
    if (recurring) payload.recurring = { freq: 'weekly' };
    try { await api('/api/events', { method: 'POST', body: JSON.stringify(payload) }); await loadCalendar(); } catch {}
  };
  scheduleEventReminders(events);
}

function scheduleEventReminders(events) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
  const soon = events.filter(e => {
    const start = new Date(e.start);
    const now = new Date();
    const diff = start - now;
    return diff > 0 && diff < 24*60*60*1000;
  });
  soon.forEach(e => {
    const ms = Math.max(0, new Date(e.start) - new Date() - 10*60*1000);
    setTimeout(() => {
      if (Notification.permission === 'granted') new Notification('Lembrete de evento', { body: e.title });
    }, ms);
  });
}

// Cameras
async function loadCameras() {
  const cams = await api('/api/cameras');
  state.cameras = cams;
  const grid = document.getElementById('camera-grid');
  grid.innerHTML = '';
  const layoutSel = document.getElementById('camera-layout');
  const max = Number(layoutSel.value || 4);
  cams.slice(0, max).forEach(cam => {
    const div = document.createElement('div');
    div.className = 'camera-item';
    const vid = document.createElement(cam.url ? 'video' : 'img');
    if (cam.url) {
      vid.src = cam.url;
      vid.autoplay = true;
      vid.muted = true;
      vid.playsInline = true;
    } else {
      vid.src = 'https://picsum.photos/400/200?random=' + cam.id;
    }
    const controls = document.createElement('div');
    controls.className = 'camera-controls';
    const zoomIn = document.createElement('button'); zoomIn.textContent = '+';
    const zoomOut = document.createElement('button'); zoomOut.textContent = '-';
    const snap = document.createElement('button'); snap.textContent = 'Snap';
    let scale = 1;
    zoomIn.onclick = () => { scale += 0.1; vid.style.transform = `scale(${scale})`; vid.style.transformOrigin = 'center'; };
    zoomOut.onclick = () => { scale = Math.max(1, scale - 0.1); vid.style.transform = `scale(${scale})`; };
    snap.onclick = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 200;
      const ctx = canvas.getContext('2d');
      try { ctx.drawImage(vid, 0, 0, 400, 200); } catch {}
      const data = canvas.toDataURL('image/png');
      try { await api(`/api/cameras/${cam.id}/snapshot`, { method: 'POST', body: JSON.stringify({ imageData: data }) }); } catch {}
    };
    controls.append(zoomIn, zoomOut, snap);
    div.append(vid, controls);
    grid.append(div);
  });
  layoutSel.onchange = loadCameras;
}

// Vehicles
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

async function loadVehicles() {
  const mapEl = document.getElementById('map');
  const routes = await api('/api/vehicles/routes');
  if (mapEl._map) mapEl._map.remove();
  const map = L.map(mapEl).setView([-15.7939, -47.8828], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  routes.forEach(r => {
    const latlngs = r.points || [];
    if (latlngs.length) {
      const line = L.polyline(latlngs, { color: 'lime' }).addTo(map);
      const dist = latlngs.slice(1).reduce((s, p, i) => s + haversine(latlngs[i].lat, latlngs[i].lng, p.lat, p.lng), 0);
      line.bindPopup(`Rota ${r.id}<br>Distância: ${(dist/1000).toFixed(2)} km`);
      map.fitBounds(line.getBounds(), { padding: [20,20] });
    }
  });
  mapEl._map = map;
  document.getElementById('simulate-route').onclick = async () => {
    const points = [
      { lat: -23.5505, lng: -46.6333 },
      { lat: -22.9068, lng: -43.1729 },
      { lat: -19.9167, lng: -43.9345 }
    ];
    await api('/api/vehicles/routes', { method: 'POST', body: JSON.stringify({ vehicleId: 'veh-1', date: new Date().toISOString(), points }) });
    const seg1 = haversine(points[0].lat, points[0].lng, points[1].lat, points[1].lng);
    const seg2 = haversine(points[1].lat, points[1].lng, points[2].lat, points[2].lng);
    if (seg1 > 50000 || seg2 > 50000) alert('Alerta: desvio de rota detectado');
    await loadVehicles();
  };
}

document.addEventListener('DOMContentLoaded', () => {
  initAuthUI();
});
