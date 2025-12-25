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
    if (event === 'processes:update') loadProcesses();
    if (event === 'processes:history') {
      loadProcesses();
      onProcessHistoryUpdate(payload);
    }
    if (event === 'events:update' || event === 'events:delete') loadCalendar();
    if (event === 'cameras:update') loadCameras();
    if (event === 'vehicles:routes') loadVehicles();
    if (event === 'layout:update') applyLayout(payload);
    if (event === 'ga:realtime') renderGoogleRealtime(payload);
    if (event === 'googleads:update') renderGoogleAds(payload);
    if (event === 'googleads:alert') renderGoogleAdsAlerts(payload);
  };
  ws.onclose = () => {
    console.log('WS desconectado. Reconectando em 5s...');
    setTimeout(connectWS, 5000);
  };
  ws.onerror = (err) => {
    console.error('Erro no WS:', err);
    ws.close();
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
  const gbtn = document.getElementById('google-login-btn');
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
  if (gbtn) {
    gbtn.onclick = async () => {
      try {
        const origin = location.origin;
        const { url } = await api('/api/auth/google/url?origin=' + encodeURIComponent(origin));
        const win = window.open(url, '_blank', 'width=600,height=700');
        function handler(ev) {
          const data = ev && ev.data ? ev.data : {};
          if (data && data.type === 'google-login' && data.token) {
            window.removeEventListener('message', handler);
            setAuth(data.token, null);
            api('/api/me').then(({ user }) => {
              state.user = user;
              userInfo.textContent = `${user.name} (${user.role})`;
              loginView.classList.add('hidden');
              app.classList.remove('hidden');
              bootApp();
              try { if (win) win.close(); } catch {}
            }).catch(() => { localStorage.removeItem('token'); });
          }
        }
        window.addEventListener('message', handler);
      } catch {
        error.textContent = 'Falha login Google';
      }
    };
  }
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
  if (!document.getElementById('panels')) {
    await Promise.all([loadBilling(), loadProcesses(), loadCalendar(), loadCameras(), loadVehicles()]);
  }
  const btnCreateInvoice = document.getElementById('create-invoice');
  if (btnCreateInvoice && state.user && state.user.role !== 'admin') {
    btnCreateInvoice.disabled = true;
    btnCreateInvoice.title = 'Apenas administradores';
  }
  initSidebar();
  initQuickAccess();
  await initFirebase();
  await loadGoogle();
  await loadGoogleAds();
  initTopbarSearch();
  initRefresh();
  const firstPanel = document.getElementById('panel-processes');
  if (firstPanel) showPanel('processes');
  initSessionTimeout();
}

function initTabs() {
  for (const btn of document.querySelectorAll('.tabs button')) {
    btn.onclick = () => {
      const id = btn.dataset.tab;
      showOnlyWidget(id);
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
  const panelsRoot = document.getElementById('panels');
  if (panelsRoot) {
    items.forEach(btn => {
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      btn.onclick = () => { showPanel(btn.dataset.target); };
      btn.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showPanel(btn.dataset.target); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const dir = e.key === 'ArrowDown' ? 1 : -1;
          const idx = items.indexOf(btn);
          const next = items[(idx + dir + items.length) % items.length];
          next.focus();
        }
      };
    });
  } else {
    items.forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.target;
        showOnlyWidget(id);
      };
    });
  }
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

function initQuickAccess() {
  const qp = document.getElementById('quick-processes');
  if (qp) qp.onclick = (e) => {
    e.preventDefault();
    const panelsRoot = document.getElementById('panels');
    if (panelsRoot) showPanel('processes');
    else showOnlyWidget('processes');
  };
}
function refreshAll() {
  const ops = [
    loadStores().catch(()=>{}),
    loadLayout().catch(()=>{}),
    loadBilling().catch(()=>{}),
    loadProcesses().then(()=>renderProcList()).catch(()=>{}),
    loadCalendar().catch(()=>{}),
    loadCameras().catch(()=>{}),
    loadVehicles().catch(()=>{}),
    loadGoogle().catch(()=>{}),
    loadGoogleAds().catch(()=>{})
  ];
  return Promise.all(ops);
}
function initRefresh() {
  const btn = document.getElementById('refresh-btn');
  const last = document.getElementById('last-update');
  const clock = document.getElementById('realtime-clock');
  
  // 2. Relógio em tempo real
  const updateClock = () => {
    if (clock) {
      clock.textContent = new Date().toLocaleTimeString('pt-BR');
    }
  };
  setInterval(updateClock, 1000);
  updateClock();

  if (!btn) return;
  const setNow = () => { if (last) last.textContent = new Date().toLocaleString('pt-BR'); };
  
  // Atualização manual
  btn.onclick = async () => {
    const prev = btn.textContent;
    btn.textContent = 'Atualizando...';
    btn.disabled = true;
    try { await refreshAll(); setNow(); } finally { btn.textContent = prev; btn.disabled = false; }
  };
  
  setNow();
  
  // 1. Atualização constante do sistema (Polling 60s)
  setInterval(async () => { 
    // Indicador visual discreto durante atualização automática (Azul Claro)
    if (clock) clock.style.color = '#60A5FA'; 
    try {
      await refreshAll();
      setNow();
    } catch (e) {
      console.error('Erro na atualização automática:', e);
    } finally {
      if (clock) clock.style.color = ''; // Restaura cor original
    }
  }, 60 * 1000);
}
function initTopbarSearch() {
  const inp = document.getElementById('google-search-input');
  const btn = document.getElementById('google-search-btn');
  const run = () => {
    const q = inp ? (inp.value || '').trim() : '';
    const url = q
      ? 'https://www.google.com/search?q=' + encodeURIComponent(q) + '&hl=pt-BR'
      : 'https://www.google.com/?hl=pt-BR';
    const win = window.open(url, '_blank', 'width=1024,height=768,noopener,noreferrer');
    try { if (win) win.focus(); } catch {}
  };
  if (btn) btn.onclick = run;
  if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') run(); };
}
function showOnlyWidget(id) {
  const widgets = Array.from(document.querySelectorAll('.widget'));
  widgets.forEach(w => {
    const show = w.dataset.id === id;
    if (show) {
      w.classList.remove('hidden');
      w.style.display = '';
    } else {
      w.classList.add('hidden');
      w.style.display = 'none';
    }
  });
  const items = Array.from(document.querySelectorAll('.sidebar-item'));
  items.forEach(i => i.classList.toggle('active', i.dataset.target === id));
  const tabs = Array.from(document.querySelectorAll('.tabs button'));
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === id));
}

function showPanel(id) {
  const panels = Array.from(document.querySelectorAll('.content-panels .panel'));
  const target = document.getElementById('panel-' + id);
  panels.forEach(p => {
    if (p === target) p.classList.add('active');
    else p.classList.remove('active');
  });
  const items = Array.from(document.querySelectorAll('.sidebar-item'));
  items.forEach(i => {
    const isActive = i.dataset.target === id;
    i.classList.toggle('active', isActive);
    i.setAttribute('aria-selected', String(isActive));
  });
  if (id === 'processes') {
    buildProcessesPanel();
    loadProcesses().then(()=>renderProcList()).catch(()=>{});
  }
  if (id === 'calendar') {
    buildCalendarPanel();
    refreshGoogleCalendarStatus().then(connected => {
      if (connected) loadGoogleCalendarEvents().catch(()=>{});
    }).catch(()=>{});
  }
  if (id === 'cameras') {
    ensureCam1AutoAuth();
    buildCamerasPanel();
    loadCameras().catch(()=>{});
  }
  if (id === 'trash') {
    buildTrashPanel();
    renderTrashList();
  }
  if (id !== 'processes') setFullProcessesMode(false);
}

function buildProcessesPanel() {
  const panel = document.getElementById('panel-processes');
  if (!panel || panel.dataset.init === '1') return;
  const wrap = document.createElement('div');
  wrap.className = 'pje-layout pje-processes';
  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('label');
  label.textContent = 'novo Processo';
  const add = document.createElement('button');
  add.id = 'proc-add';
  add.className = 'add-btn';
  add.setAttribute('aria-label', 'Adicionar processo');
  add.textContent = '+';
  const search = document.createElement('input');
  search.id = 'proc-search';
  search.type = 'text';
  search.placeholder = 'Pesquisar por nome, CPF/CNPJ, endereço ou data de audiência';
  search.className = 'search-input';
  const searchCount = document.createElement('span');
  searchCount.id = 'proc-search-count';
  searchCount.className = 'search-count';
  const fullBtn = document.createElement('button');
  fullBtn.id = 'proc-full';
  fullBtn.className = 'add-btn';
  fullBtn.textContent = 'Tela inteira';
  field.append(label, add, search, searchCount, fullBtn);
  const listContainer = document.createElement('div');
  listContainer.id = 'proc-dynamic-container';
  listContainer.className = 'proc-dynamic';
  wrap.append(field, listContainer);
  panel.appendChild(wrap);
  panel.dataset.init = '1';
  search.oninput = () => {
    renderProcList();
    applyPageSearchHighlight(search.value || '');
  };
  fullBtn.onclick = () => {
    const on = !document.body.classList.contains('full-processes');
    setFullProcessesMode(on);
  };
}
function buildTrashPanel() {
  const panel = document.getElementById('panel-trash');
  if (!panel || panel.dataset.init === '1') return;
  const wrap = document.createElement('div');
  wrap.className = 'pje-layout';
  const actions = document.createElement('div');
  actions.className = 'actions';
  const label = document.createElement('span');
  label.textContent = 'Lixeira';
  const restore = document.createElement('button');
  restore.id = 'trash-restore-selected';
  restore.className = 'add-btn';
  restore.textContent = 'Restaurar selecionados';
  const clear = document.createElement('button');
  clear.id = 'trash-clear';
  clear.className = 'del-btn';
  clear.textContent = 'Limpar lixeira';
  const count = document.createElement('span');
  count.id = 'trash-count';
  count.className = 'trash-count';
  const status = document.createElement('span');
  status.id = 'trash-status';
  status.className = 'trash-status';
  actions.append(label, restore, clear, count, status);
  const container = document.createElement('div');
  container.id = 'proc-trash-container';
  container.className = 'proc-dynamic';
  wrap.append(actions, container);
  panel.appendChild(wrap);
  panel.dataset.init = '1';
  restore.onclick = () => restoreTrashSelected();
  clear.onclick = () => clearTrash();
  renderTrashList();
}
function initDrag() {
  const dash = document.getElementById('dashboard');
  if (!dash) return;
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
  const monthSel = document.getElementById('billing-month');
  const yearSel = document.getElementById('billing-year');
  const storeSel = document.getElementById('billing-store');
  const applyBtn = document.getElementById('billing-apply');
  const ordersEl = document.getElementById('metric-orders');
  const cmvEl = document.getElementById('metric-cmv');
  const grossEl = document.getElementById('metric-gross');
  const opexEl = document.getElementById('metric-opex');
  const resultEl = document.getElementById('metric-result');
  const breakevenEl = document.getElementById('metric-breakeven');
  const targetEl = document.getElementById('metric-target');
  if (!monthSel || !yearSel || !storeSel || !applyBtn || !ordersEl || !cmvEl || !grossEl || !opexEl || !resultEl || !breakevenEl || !targetEl) return;
  const params = new URLSearchParams();
  const invoices = await api('/api/billing?' + params.toString());
  state.invoices = invoices;
  const stores = [...new Set(invoices.map(i => i.storeId))];
  storeSel.innerHTML = '<option value="">Todas</option>' + stores.map(s => `<option value="${s}">${s}</option>`).join('');
  applyBtn.onclick = async () => { await loadBilling(); };
  const m = Number(monthSel.value);
  const y = Number(yearSel.value);
  const s = storeSel.value;
  const filtered = invoices.filter(i => {
    const d = new Date(i.date);
    const matchesMonth = !m || d.getMonth() + 1 === m;
    const matchesYear = !y || d.getFullYear() === y;
    const matchesStore = !s || i.storeId === s;
    return matchesMonth && matchesYear && matchesStore;
  });
  const revenue = filtered.reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const cmvRate = 0.69;
  const opexRate = 0.15;
  const cmv = revenue * cmvRate;
  const gross = revenue - cmv;
  const opex = revenue * opexRate;
  const result = gross - opex;
  const breakeven = opex / (1 - cmvRate);
  const target = revenue * 1.1;
  const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  ordersEl.textContent = fmt.format(revenue);
  cmvEl.textContent = fmt.format(cmv);
  grossEl.textContent = fmt.format(gross);
  opexEl.textContent = fmt.format(opex);
  resultEl.textContent = fmt.format(result);
  breakevenEl.textContent = fmt.format(breakeven);
  targetEl.textContent = fmt.format(target);
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

let lastRenderedProcs = '';

// Processes
async function loadProcesses() {
  const procs = await api('/api/processes').catch(()=>[]);
  state.processes = Array.isArray(procs) ? procs : [];
  const local = getProcTabs();
  const next = local.slice();
  const byId = new Map(next.map((e, i) => [e.id, { i, e }]));
  for (const p of state.processes) {
    const curr = byId.get(p.id);
    const merged = {
      id: p.id,
      autor: (p.autor || (curr?.e.autor || '')),
      link: (p.link || (curr?.e.link || '')),
      status: (p.status === 'ENCERRADO') ? 'ENCERRADO' : 'EM ANDAMENTO',
      audienciaDate: (p.audienciaDate || (curr?.e.audienciaDate || '')),
      audienciaTime: (p.audienciaTime || (curr?.e.audienciaTime || ''))
    };
    if (curr) next[curr.i] = merged;
    else next.push(merged);
  }
  if (next.length && JSON.stringify(next) !== JSON.stringify(local)) {
    setProcTabs(next);
  }
  
  // Smart Cache: Só renderiza se houver mudanças nos dados
  const currentDataStr = JSON.stringify({ p: state.processes, t: next });
  if (currentDataStr !== lastRenderedProcs) {
    // Evita re-renderizar se o usuário estiver editando (para não perder o foco/texto)
    if (document.querySelector('.inline-editor')) {
      console.log('Renderização ignorada: usuário editando');
      return;
    }

    lastRenderedProcs = currentDataStr;
    renderProcList();
  }
  
  const numView = document.getElementById('pje-numero-processo-view');
  const link = document.getElementById('pje-open-jus');
  const params = new URLSearchParams(location.search);
  const saved = localStorage.getItem('proc_numero') || '';
  const v = params.get('processo') || saved || '';
  if (numView) numView.textContent = v || '—';
  if (link) {
    if (v) {
      link.href = 'https://www.jusbrasil.com.br/processos/?q=' + encodeURIComponent(v);
      link.classList.remove('disabled');
    } else {
      link.href = '#';
      link.classList.add('disabled');
    }
  }
  const addBtn = document.getElementById('proc-add');
  const container = document.getElementById('proc-dynamic-container');
  if (addBtn && container) {
    addBtn.onclick = () => createNewProcessTab();
    const field = document.querySelector('.pje-layout.pje-processes .field');
    if (field) {
      field.onclick = (e) => {
        const isButton = e.target && (e.target.id === 'proc-add' || e.target.closest && e.target.closest('#proc-add'));
        if (!isButton) createNewProcessTab();
      };
    }
    if (!window._procTabsRestored) {
      restoreProcessTabs();
      window._procTabsRestored = true;
    }
  }
}

function getProcTabs() {
  try { return JSON.parse(localStorage.getItem('proc_tabs') || '[]'); } catch { return []; }
}
function setProcTabs(list) {
  localStorage.setItem('proc_tabs', JSON.stringify(list));
}
function createProcNav(id, label) {
  const tabs = document.querySelector('.tabs');
  const tabBtn = document.createElement('button');
  tabBtn.dataset.tab = id;
  tabBtn.id = 'proc-tab-' + id;
  tabBtn.textContent = label;
  tabBtn.onclick = () => showOnlyWidget(id);
  if (tabs) tabs.appendChild(tabBtn);
}
function validUrl(u) {
  return /^https?:\/\/.+/i.test(u || '');
}
function createProcWidget(entry) {
  const dash = document.getElementById('dashboard');
  const exists = document.querySelector(`.widget[data-id="${entry.id}"]`);
  if (exists) return exists;
  entry.status = entry.status === 'ENCERRADO' ? 'ENCERRADO' : 'EM ANDAMENTO';
  const w = document.createElement('div');
  w.className = 'widget';
  w.dataset.id = entry.id;
  w.setAttribute('draggable', 'true');
  const head = document.createElement('div');
  head.className = 'widget-head';
  const title = document.createElement('span');
  title.textContent = 'Processo';
  head.appendChild(title);
  const body = document.createElement('div');
  body.className = 'widget-body';
  const fields = document.createElement('div');
  fields.className = 'pje-layout';
  const left = document.createElement('div');
  left.className = 'pje-filters';
  const f1 = document.createElement('div');
  f1.className = 'field';
  const l1 = document.createElement('label');
  l1.textContent = 'Autor';
  const autor = document.createElement('input');
  autor.id = 'proc-autor-' + entry.id;
  autor.placeholder = 'Nome do autor';
  autor.value = entry.autor || '';
  f1.append(l1, autor);
  const f2 = document.createElement('div');
  f2.className = 'field';
  const l2 = document.createElement('label');
  l2.textContent = 'Link de acompanhamento';
  const linkInp = document.createElement('input');
  linkInp.id = 'proc-link-' + entry.id;
  linkInp.placeholder = 'URL válida';
  linkInp.value = entry.link || '';
  f2.append(l2, linkInp);
  const actionsRow = document.createElement('div');
  actionsRow.className = 'actions-row';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Salvar';
  const statusContainer = document.createElement('div');
  statusContainer.className = 'actions-row';
  const statusLabel = document.createElement('span');
  statusLabel.className = 'proc-status';
  statusLabel.dataset.id = entry.id;
  statusLabel.textContent = entry.status;
  statusLabel.classList.toggle('active', entry.status === 'EM ANDAMENTO');
  statusLabel.classList.toggle('closed', entry.status === 'ENCERRADO');
  const statusBtn = document.createElement('button');
  statusBtn.textContent = 'Status: ' + entry.status;
  statusBtn.className = 'add-btn';
  statusBtn.dataset.statusId = entry.id;
  const statusMenu = document.createElement('div');
  statusMenu.className = 'proc-status-menu hidden';
  const optOpen = document.createElement('button');
  optOpen.type = 'button';
  optOpen.className = 'menu-item';
  optOpen.dataset.status = 'EM ANDAMENTO';
  optOpen.textContent = 'EM ANDAMENTO';
  const optClosed = document.createElement('button');
  optClosed.type = 'button';
  optClosed.className = 'menu-item';
  optClosed.dataset.status = 'ENCERRADO';
  optClosed.textContent = 'ENCERRADO';
  optOpen.onclick = () => { setProcessStatus(entry.id, 'EM ANDAMENTO'); statusMenu.classList.add('hidden'); };
  optClosed.onclick = () => { setProcessStatus(entry.id, 'ENCERRADO'); statusMenu.classList.add('hidden'); };
  statusMenu.append(optOpen, optClosed);
  statusBtn.onclick = () => {
    statusMenu.classList.toggle('hidden');
    if (!statusMenu.classList.contains('hidden')) {
      const onDocClick = (e) => {
        if (!statusMenu.contains(e.target) && e.target !== statusBtn) {
          statusMenu.classList.add('hidden');
          document.removeEventListener('click', onDocClick);
        }
      };
      setTimeout(() => { document.addEventListener('click', onDocClick); }, 0);
    }
  };
  const status = document.createElement('div');
  status.className = 'status-msg';
  actionsRow.append(saveBtn);
  statusContainer.append(statusLabel, statusBtn, statusMenu);
  left.append(f1, f2, actionsRow, statusContainer, status);
  const right = document.createElement('div');
  const open = document.createElement('a');
  open.textContent = 'Abrir link';
  open.className = 'jus-link';
  open.target = '_blank';
  right.append(open);
  const openScreenBtn = document.createElement('button');
  openScreenBtn.textContent = 'Abrir';
  openScreenBtn.className = 'add-btn';
  right.append(openScreenBtn);
  fields.append(left, right);
  body.appendChild(fields);
  w.append(head, body);
  if (dash) dash.appendChild(w);
  const setStatus = (ok, msg) => {
    status.textContent = msg || '';
    status.classList.toggle('status-ok', !!ok);
    status.classList.toggle('status-err', !ok);
  };
  const updateOpen = () => {
    const u = linkInp.value.trim();
    if (validUrl(u)) {
      open.href = u;
      open.classList.remove('disabled');
    } else {
      open.href = '#';
      open.classList.add('disabled');
    }
  };
  updateOpen();
  
  const saveProcess = () => {
    const u = linkInp.value.trim();
    const a = autor.value.trim();
    if (u && !validUrl(u)) {
      setStatus(false, 'URL inválida');
      return;
    }
    const list = getProcTabs();
    const idx = list.findIndex(x => x.id === entry.id);
    const next = { id: entry.id, autor: a, link: u, status: entry.status === 'ENCERRADO' ? 'ENCERRADO' : 'EM ANDAMENTO' };
    if (idx >= 0) list[idx] = next;
    else list.push(next);
    setProcTabs(list);
    api('/api/processes/' + encodeURIComponent(entry.id), { method: 'PUT', body: JSON.stringify({ autor: a, link: u, status: next.status }) }).catch(()=>{});
    const side = document.getElementById('proc-side-' + entry.id);
    const tab = document.getElementById('proc-tab-' + entry.id);
    const label = a ? 'Processo: ' + a : 'Processo';
    if (side) side.textContent = label;
    if (tab) tab.textContent = label;
    setStatus(true, 'Salvo automaticamente');
    renderProcessMonitor(entry.id);
    renderProcList();
  };

  let debounceTimer;
  const onInput = () => {
    setStatus(false, 'Salvando...');
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(saveProcess, 1000);
  };

  linkInp.oninput = () => {
    updateOpen();
    onInput();
  };
  autor.oninput = onInput;

  saveBtn.onclick = saveProcess;
  saveBtn.style.display = 'none'; // Hide manual save button since we have auto-save

  openScreenBtn.onclick = () => { openProcessScreen(entry.id); };
  return w;
}
function createNewProcessTab() {
  const id = 'proc-' + Date.now();
  const entry = { id, autor: '', link: '', status: 'EM ANDAMENTO' };
  createProcNav(id, 'Processo');
  createProcWidget(entry);
  const list = getProcTabs();
  list.push(entry);
  setProcTabs(list);
  showOnlyWidget(id);
}
function restoreProcessTabs() {
  cleanupProcessSidebar();
  const list = getProcTabs();
  list.forEach(entry => {
    createProcNav(entry.id, entry.autor ? 'Processo: ' + entry.autor : 'Processo');
    createProcWidget(entry);
  });
  renderProcList();
}

function cleanupProcessSidebar() {
  const items = Array.from(document.querySelectorAll('.sidebar .sidebar-item'));
  items.forEach(btn => {
    const id = btn.dataset.target || '';
    if (id.startsWith('proc-') || btn.id.startsWith('proc-side-')) {
      btn.remove();
    }
  });
}
async function renderProcessMonitor(id) {
  const procs = await api('/api/processes').catch(()=>[]);
  const proc = Array.isArray(procs) ? procs.find(p => p.id === id) : null;
  const summaryEl = document.getElementById('proc-summary-' + id);
  const table = document.getElementById('proc-hist-' + id);
  const lastEl = document.getElementById('proc-lastupd-' + id);
  if (!summaryEl || !table) return;
  const history = (proc && Array.isArray(proc.history)) ? proc.history : [];
  const last = history.slice(-1)[0] || null;
  summaryEl.textContent = last && last.summary ? last.summary : 'Sem atualizações';
  if (lastEl) {
    const d = last && last.date ? new Date(last.date) : null;
    lastEl.textContent = d ? ('Atualizado: ' + d.toLocaleString('pt-BR')) : '';
  }
  const rows = history.slice().reverse().map(h => {
    const d = h.date ? new Date(h.date).toLocaleString('pt-BR') : '';
    const movs = Array.isArray(h.movements) ? h.movements.map(m => {
      const md = m.date || '';
      const mt = m.text || '';
      return `${md} - ${mt}`;
    }).join('<br>') : (h.message || h.summary || '');
    return `<tr><td>${d}</td><td>${movs}</td></tr>`;
  }).join('');
  table.innerHTML = '<tr><th>Data/Hora</th><th>Movimentações</th></tr>' + rows;
}

function onProcessHistoryUpdate(payload) {
  const id = payload && payload.processId ? payload.processId : null;
  const entry = payload && payload.entry ? payload.entry : null;
  if (id) renderProcessMonitor(id);
  if (entry && Notification && Notification.permission === 'granted') {
    try { new Notification('Nova movimentação', { body: (entry.summary || 'Atualização de processo') }); } catch {}
  }
  if (entry && Notification && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function renderProcList() {
  const container = document.getElementById('proc-dynamic-container');
  if (!container) return;
  const qEl = document.getElementById('proc-search');
  const q = qEl ? (qEl.value || '').trim() : '';
  const listAll = getProcTabs().slice();
  const list = q ? listAll.filter(e => matchesProcEntry(e, q)) : listAll;
  const selected = getSelectedProc();
  list.sort((a, b) => {
    const na = (a.autor || '').toLowerCase();
    const nb = (b.autor || '').toLowerCase();
    return na.localeCompare(nb);
  });
  const html = list.map(entry => {
    const name = entry.autor ? entry.autor : 'Processo';
    const link = entry.link && /^https?:\/\//i.test(entry.link) ? entry.link : null;
    const openBtn = link ? `<a href="${link}" target="_blank" class="add-btn">Abrir</a>` : `<span class="add-btn disabled">Abrir</span>`;
    const status = entry.status === 'ENCERRADO' ? 'ENCERRADO' : 'EM ANDAMENTO';
    const statusClass = status === 'EM ANDAMENTO' ? 'active' : 'closed';
    const statusBtn = `<button class="status-btn ${statusClass}" data-id="${entry.id}" aria-label="Status">${status}</button>`;
    const statusMenu = `<div class="status-menu hidden" data-id="${entry.id}"><button type="button" class="menu-item" data-status="EM ANDAMENTO">EM ANDAMENTO</button><button type="button" class="menu-item" data-status="ENCERRADO">ENCERRADO</button></div>`;
    const marked = selected.includes(entry.id) ? 'marked' : '';
    const markBox = `<button class="mark-box ${marked}" data-id="${entry.id}" aria-label="Marcar processo"></button>`;
    const dateInp = `<input type="date" class="aud-date" data-id="${entry.id}" value="${entry.audienciaDate || ''}">`;
    const timeInp = `<input type="time" class="aud-time" data-id="${entry.id}" value="${entry.audienciaTime || ''}" step="60">`;
    const delBtn = `<button class="del-btn" data-id="${entry.id}" aria-label="Excluir processo">Excluir</button>`;
    const scanNow = `<button class="add-btn" data-scan="${entry.id}" aria-label="Verificar agora">Verificar agora</button>`;
    const editBtn = `<button class="add-btn" data-edit="${entry.id}" aria-label="Editar processo">Editar</button>`;
    return `<li data-id="${entry.id}">${markBox}<span>${name}</span> ${dateInp} ${timeInp} ${statusBtn} ${openBtn} ${scanNow} ${editBtn} ${delBtn} ${statusMenu}</li>`;
  }).join('');
  container.innerHTML = `<ul class="proc-list">${html}</ul>`;
  const sc = document.getElementById('proc-search-count');
  if (sc) sc.textContent = q ? String(list.length) + ' resultado(s)' : '';
  const listEl = container.querySelector('.proc-list');
  if (listEl && !listEl._statusHandlers) {
    listEl.onclick = (e) => {
      const box = e.target.closest('.mark-box');
      if (box) {
        const id = box.dataset.id;
        const cur = getSelectedProc();
        const idx = cur.indexOf(id);
        if (idx >= 0) cur.splice(idx, 1);
        else cur.push(id);
        setSelectedProc(cur);
        box.classList.toggle('marked', cur.includes(id));
        return;
      }
      const del = e.target.closest('.del-btn');
      if (del) {
        const id = del.dataset.id;
        deleteProcessTab(id);
        return;
      }
      const scanBtn = e.target.closest('[data-scan]');
      if (scanBtn) {
        const id = scanBtn.dataset.scan;
        api(`/api/processes/${id}/scan`, { method: 'POST', body: JSON.stringify({}) }).then(() => {
          onProcessHistoryUpdate({ processId: id, entry: null });
        }).catch(()=>{});
        return;
      }
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) {
        const id = editBtn.dataset.edit;
        const li = editBtn.closest('li');
        if (!li) return;
        let editor = li.querySelector('.inline-editor');
        if (editor) { editor.remove(); }
        const list = getProcTabs();
        const entry = list.find(x => x.id === id) || { id, autor: '', link: '' };
        editor = document.createElement('div');
        editor.className = 'inline-editor';
        const nameInp = document.createElement('input');
        nameInp.type = 'text';
        nameInp.placeholder = 'Nome do processo';
        nameInp.value = entry.autor || '';
        const linkInp = document.createElement('input');
        linkInp.type = 'text';
        linkInp.placeholder = 'Endereço (URL) do processo';
        linkInp.value = entry.link || '';
        const openA = document.createElement('a');
        openA.textContent = 'Abrir';
        openA.className = 'add-btn';
        openA.target = '_blank';
        const updateOpen = () => {
          const u = linkInp.value.trim();
          if (u && /^https?:\/\//i.test(u)) {
            openA.href = u;
            openA.classList.remove('disabled');
          } else {
            openA.href = '#';
            openA.classList.add('disabled');
          }
        };
        updateOpen();
        linkInp.oninput = updateOpen;
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Salvar';
        saveBtn.className = 'add-btn';
        saveBtn.style.display = 'none'; // Auto-save enabled
        
        const statusSpan = document.createElement('span');
        statusSpan.className = 'status-msg';
        statusSpan.style.marginLeft = '10px';
        statusSpan.style.fontSize = '0.8rem';

        const performSave = () => {
          const a = nameInp.value.trim();
          const u = linkInp.value.trim();
          const idx = list.findIndex(x => x.id === id);
          const next = { id, autor: a, link: u, status: entry.status === 'ENCERRADO' ? 'ENCERRADO' : 'EM ANDAMENTO' };
          if (idx >= 0) list[idx] = next;
          else list.push(next);
          setProcTabs(list);
          statusSpan.textContent = 'Salvando...';
          statusSpan.style.color = '#fbbf24';
          api('/api/processes/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ autor: a, link: u, status: next.status }) })
            .then(() => {
              statusSpan.textContent = 'Salvo';
              statusSpan.style.color = '#22c55e';
              setTimeout(() => { statusSpan.textContent = ''; }, 2000);
            })
            .catch(() => {
              statusSpan.textContent = 'Erro ao salvar';
              statusSpan.style.color = '#ef4444';
            });
          // Update list UI partially if needed, but full render would close editor
          // So we just keep editor open
        };

        let deb;
        const onEditInput = () => {
          statusSpan.textContent = 'Digitando...';
          statusSpan.style.color = '#9ca3af';
          clearTimeout(deb);
          deb = setTimeout(performSave, 500);
        };

        nameInp.oninput = onEditInput;
        linkInp.oninput = () => {
          updateOpen();
          onEditInput();
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Fechar'; // Changed from Cancelar since it saves automatically
        cancelBtn.className = 'add-btn';
        
        saveBtn.onclick = () => { performSave(); renderProcList(); }; // Manual save triggers render
        cancelBtn.onclick = () => { renderProcList(); }; // Just close/re-render

        editor.append(nameInp, linkInp, openA, saveBtn, cancelBtn, statusSpan);
        li.append(editor);
        return;
      }
      const btn = e.target.closest('.status-btn');
      if (btn) {
        const id = btn.dataset.id;
        const li = btn.closest('li');
        const menu = li ? li.querySelector('.status-menu[data-id="'+id+'"]') : null;
        if (menu) {
          menu.classList.toggle('hidden');
          if (!menu.classList.contains('hidden')) {
            const onDocClick = (ev) => {
              if (!menu.contains(ev.target) && ev.target !== btn) {
                menu.classList.add('hidden');
                document.removeEventListener('click', onDocClick);
              }
            };
            setTimeout(() => { document.addEventListener('click', onDocClick); }, 0);
          }
        }
        return;
      }
      const item = e.target.closest('.status-menu .menu-item');
      if (item) {
        const s = item.dataset.status;
        const id = item.closest('.status-menu')?.dataset.id;
        if (id) setProcessStatus(id, s);
        const m = item.closest('.status-menu');
        if (m) m.classList.add('hidden');
      }
    };
    listEl.onchange = (e) => {
      const dt = e.target.closest('.aud-date');
      if (dt) {
        const id = dt.dataset.id;
        const v = dt.value;
        const list = getProcTabs();
        const idx = list.findIndex(x => x.id === id);
        if (idx >= 0) {
          list[idx].audienciaDate = v;
          setProcTabs(list);
          api('/api/processes/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ audienciaDate: v }) }).catch(()=>{});
        }
      }
      const tm = e.target.closest('.aud-time');
      if (tm) {
        const id = tm.dataset.id;
        const v = tm.value;
        const list = getProcTabs();
        const idx = list.findIndex(x => x.id === id);
        if (idx >= 0) {
          list[idx].audienciaTime = v;
          setProcTabs(list);
          api('/api/processes/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ audienciaTime: v }) }).catch(()=>{});
        }
      }
    };
    listEl._statusHandlers = true;
  }
  renderTrashList();
}

function setFullProcessesMode(on) {
  if (on) {
    document.body.classList.add('full-processes');
  } else {
    document.body.classList.remove('full-processes');
  }
  const btn = document.getElementById('proc-full');
  if (btn) btn.textContent = document.body.classList.contains('full-processes') ? 'Sair da tela inteira' : 'Tela inteira';
}
function normalizeText(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function matchesProcEntry(entry, q) {
  const n = normalizeText(q);
  const digits = q.replace(/\D+/g, '');
  const fields = [
    entry.autor || '',
    entry.link || '',
    entry.status || '',
    entry.audienciaDate || '',
    entry.audienciaTime || ''
  ];
  for (const f of fields) {
    const fn = normalizeText(f);
    if (n && fn.includes(n)) return true;
    if (digits && digits.length >= 6) {
      const fd = String(f).replace(/\D+/g, '');
      if (fd.includes(digits)) return true;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(q) || /^\d{4}-\d{2}-\d{2}$/.test(q)) {
      const iso = /^\d{2}\/\d{2}\/\d{4}$/.test(q) ? q.split('/').reverse().join('-') : q;
      if ((entry.audienciaDate || '').startsWith(iso)) return true;
    }
  }
  return false;
}
function applyPageSearchHighlight(q) {
  const root = document.querySelector('.panel.active');
  if (!root) return;
  root.querySelectorAll('mark.search-hit').forEach(m => {
    const p = m.parentNode;
    if (!p) return;
    p.replaceChild(document.createTextNode(m.textContent || ''), m);
    p.normalize();
  });
  const v = (q || '').trim();
  if (!v || v.length < 2) return;
  const rx = new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const blacklist = ['SCRIPT','STYLE','INPUT','TEXTAREA','SELECT','BUTTON'];
  const nodes = Array.from(root.querySelectorAll('*')).filter(el => !blacklist.includes(el.tagName));
  for (const el of nodes) {
    if (!el.childNodes || !el.childNodes.length) continue;
    const parts = [];
    let changed = false;
    el.childNodes.forEach(node => {
      if (node.nodeType === 3) {
        const txt = node.nodeValue || '';
        if (rx.test(txt)) {
          const html = txt.replace(rx, m => `<mark class="search-hit">${m}</mark>`);
          parts.push(html);
          changed = true;
        } else {
          parts.push(txt);
        }
      } else {
        parts.push(node.outerHTML || '');
      }
    });
    if (changed) el.innerHTML = parts.join('');
  }
}

function getTrashList() {
  try { return JSON.parse(localStorage.getItem('proc_trash') || '[]'); } catch { return []; }
}
function setTrashList(list) {
  localStorage.setItem('proc_trash', JSON.stringify(list || []));
}
function getSelectedTrash() {
  try { return JSON.parse(localStorage.getItem('proc_trash_selected') || '[]'); } catch { return []; }
}
function setSelectedTrash(list) {
  localStorage.setItem('proc_trash_selected', JSON.stringify(list || []));
}
function renderTrashList() {
  const container = document.getElementById('proc-trash-container');
  if (!container) return;
  const list = getTrashList().slice();
  list.sort((a, b) => {
    const na = (a.autor || '').toLowerCase();
    const nb = (b.autor || '').toLowerCase();
    return na.localeCompare(nb);
  });
  const selected = getSelectedTrash();
  const html = list.map(entry => {
    const name = entry.autor ? entry.autor : 'Processo';
    const link = entry.link && /^https?:\/\//i.test(entry.link) ? entry.link : null;
    const openBtn = link ? `<a href="${link}" target="_blank" class="add-btn">Abrir</a>` : `<span class="add-btn disabled">Abrir</span>`;
    const marked = selected.includes(entry.id) ? 'marked' : '';
    const markBox = `<button class="mark-box ${marked}" data-id="${entry.id}" aria-label="Marcar para restaurar"></button>`;
    const date = entry.audienciaDate || '';
    const time = entry.audienciaTime || '';
    const restoreBtn = `<button class="add-btn" data-restore="${entry.id}" aria-label="Restaurar">Restaurar</button>`;
    return `<li data-id="${entry.id}">${markBox}<span>${name}</span> <span class="trash-date">${date}${time ? (' ' + time) : ''}</span> ${openBtn} ${restoreBtn}</li>`;
  }).join('');
  container.innerHTML = `<ul class="trash-list">${html}</ul>`;
  const countEl = document.getElementById('trash-count');
  if (countEl) countEl.textContent = list.length ? String(list.length) + ' item(ns)' : '';
  const listEl = container.querySelector('.trash-list');
  if (listEl && !listEl._handlers) {
    listEl.onclick = (e) => {
      const box = e.target.closest('.mark-box');
      if (box) {
        const id = box.dataset.id;
        const cur = getSelectedTrash();
        const idx = cur.indexOf(id);
        if (idx >= 0) cur.splice(idx, 1);
        else cur.push(id);
        setSelectedTrash(cur);
        box.classList.toggle('marked', cur.includes(id));
        return;
      }
      const restore = e.target.closest('[data-restore]');
      if (restore) {
        const id = restore.dataset.restore;
        restoreTrashItem(id);
        return;
      }
    };
    listEl._handlers = true;
  }
}
function restoreTrashSelected() {
  const sel = getSelectedTrash().slice();
  sel.forEach(id => restoreTrashItem(id));
  setSelectedTrash([]);
  renderTrashList();
  renderProcList();
}
function restoreTrashItem(id) {
  const trash = getTrashList();
  const idx = trash.findIndex(e => e.id === id);
  if (idx < 0) return;
  const entry = trash[idx];
  trash.splice(idx, 1);
  setTrashList(trash);
  const list = getProcTabs();
  if (!list.find(e => e.id === id)) {
    list.push(entry);
    setProcTabs(list);
    createProcNav(entry.id, entry.autor ? 'Processo: ' + entry.autor : 'Processo');
    createProcWidget(entry);
  }
  renderProcList();
}
function clearTrash() {
  const sel = getSelectedTrash();
  if (!sel.length) {
    const st = document.getElementById('trash-status');
    if (st) st.textContent = 'Marque os itens que deseja excluir definitivamente';
    else alert('Marque os itens que deseja excluir definitivamente');
    return;
  }
  const ok = window.confirm('Excluir definitivamente ' + sel.length + ' item(ns) da lixeira?');
  if (!ok) return;
  const trash = getTrashList().filter(e => !sel.includes(e.id));
  setTrashList(trash);
  setSelectedTrash([]);
  renderTrashList();
}

function toggleProcessStatus(id) {
  const list = getProcTabs();
  const idx = list.findIndex(e => e.id === id);
  if (idx < 0) return;
  const cur = list[idx].status === 'ENCERRADO' ? 'EM ANDAMENTO' : 'ENCERRADO';
  list[idx].status = cur;
  setProcTabs(list);
  api('/api/processes/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ status: cur }) }).catch(()=>{});
  const label = document.querySelector(`.proc-status[data-id="${id}"]`);
  if (label) {
    label.textContent = cur;
    label.classList.toggle('active', cur === 'EM ANDAMENTO');
    label.classList.toggle('closed', cur === 'ENCERRADO');
  }
  renderProcList();
}

function setProcessStatus(id, status) {
  const allowed = ['EM ANDAMENTO', 'ENCERRADO'];
  const next = allowed.includes(status) ? status : 'EM ANDAMENTO';
  const list = getProcTabs();
  const idx = list.findIndex(e => e.id === id);
  if (idx < 0) return;
  list[idx].status = next;
  setProcTabs(list);
  api('/api/processes/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ status: next }) }).catch(()=>{});
  const label = document.querySelector(`.proc-status[data-id="${id}"]`);
  if (label) {
    label.textContent = next;
    label.classList.toggle('active', next === 'EM ANDAMENTO');
    label.classList.toggle('closed', next === 'ENCERRADO');
  }
  const btn = document.querySelector(`.add-btn[data-status-id="${id}"]`);
  if (btn) btn.textContent = 'Status: ' + next;
  const listBtn = document.querySelector(`.status-btn[data-id="${id}"]`);
  if (listBtn) {
    listBtn.textContent = next;
    listBtn.classList.toggle('active', next === 'EM ANDAMENTO');
    listBtn.classList.toggle('closed', next === 'ENCERRADO');
  }
  renderProcList();
}

function getSelectedProc() {
  try { return JSON.parse(localStorage.getItem('proc_selected') || '[]'); } catch { return []; }
}
function setSelectedProc(list) {
  localStorage.setItem('proc_selected', JSON.stringify(list));
}
function deleteProcessTab(id) {
  let list = getProcTabs();
  const entry = list.find(e => e.id === id);
  list = list.filter(e => e.id !== id);
  setProcTabs(list);
  const navBtn = document.getElementById('proc-tab-' + id);
  if (navBtn) navBtn.remove();
  const widget = document.querySelector(`.widget[data-id="${id}"]`);
  if (widget) widget.remove();
  const sel = getSelectedProc().filter(x => x !== id);
  setSelectedProc(sel);
  if (entry) {
    const trash = getTrashList();
    trash.push(entry);
    setTrashList(trash);
  }
  renderProcList();
  renderTrashList();
}
function openProcessScreen(id) {
  const appContent = document.querySelector('.content');
  const dash = document.getElementById('dashboard');
  let screen = document.getElementById('proc-screen');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'proc-screen';
    screen.className = 'proc-screen';
    const head = document.createElement('div');
    head.className = 'proc-screen-head';
    const title = document.createElement('h2');
    title.id = 'proc-screen-title';
    const back = document.createElement('button');
    back.textContent = 'Voltar';
    back.className = 'add-btn';
    back.onclick = () => {
      screen.remove();
      if (dash) dash.style.display = '';
    };
    head.append(title, back);
    screen.append(head);
    if (appContent) appContent.appendChild(screen);
  }
  if (dash) dash.style.display = 'none';
  updateProcessScreen(id);
}

async function updateProcessScreen(id) {
  const title = document.getElementById('proc-screen-title');
  const procs = await api('/api/processes').catch(()=>[]);
  const tabs = getProcTabs();
  const local = tabs.find(t => t.id === id);
  const proc = Array.isArray(procs) ? procs.find(p => p.id === id) : null;
  if (title) title.textContent = (local && local.autor) ? ('Processo: ' + local.autor) : 'Processo';
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

function buildCalendarPanel() {
  const panel = document.getElementById('panel-calendar');
  if (!panel || panel.dataset.init === '1') return;
  const head = document.createElement('div');
  head.className = 'actions';
  const status = document.createElement('span');
  status.id = 'gcal-status';
  status.className = 'gcal-status';
  const connect = document.createElement('button');
  connect.id = 'gcal-connect';
  connect.className = 'add-btn';
  connect.textContent = 'Conectar Google Agenda';
  const refresh = document.createElement('button');
  refresh.id = 'gcal-refresh';
  refresh.className = 'add-btn';
  refresh.textContent = 'Atualizar';
  const toki = document.createElement('button');
  toki.id = 'toki-add';
  toki.className = 'add-btn';
  toki.textContent = 'Adicionar ao Toki';
  head.append(connect, refresh, toki, status);
  const list = document.createElement('div');
  list.id = 'gcal-events';
  list.className = 'gcal-list';
  panel.append(head, list);
  panel.dataset.init = '1';
  connect.onclick = () => startGoogleCalendarConnect();
  refresh.onclick = () => loadGoogleCalendarEvents().catch(()=>{});
  toki.onclick = async () => {
    try {
      const { url } = await api('/api/events/ics-url');
      if (navigator.clipboard && url) { try { await navigator.clipboard.writeText(url); } catch {} }
      if (url) window.open(url.replace(/^http:/,'webcal:'), '_blank');
      const statusEl = document.getElementById('gcal-status');
      if (statusEl) statusEl.textContent = 'Link do Toki copiado';
    } catch {
      const statusEl = document.getElementById('gcal-status');
      if (statusEl) statusEl.textContent = 'Erro ao gerar link para Toki';
    }
  };
}

async function refreshGoogleCalendarStatus() {
  try {
    const st = await api('/api/google-calendar/status');
    const statusEl = document.getElementById('gcal-status');
    const connect = document.getElementById('gcal-connect');
    const refresh = document.getElementById('gcal-refresh');
    const connected = !!(st && st.connected);
    if (statusEl) statusEl.textContent = connected ? 'Conectado' : 'Não conectado';
    if (connect) connect.disabled = connected;
    if (refresh) refresh.disabled = !connected;
    return connected;
  } catch {
    const statusEl = document.getElementById('gcal-status');
    if (statusEl) statusEl.textContent = 'Erro ao verificar status';
    return false;
  }
}

async function startGoogleCalendarConnect() {
  try {
    const origin = location.origin;
    const { url } = await api('/api/google-calendar/oauth/url?origin=' + encodeURIComponent(origin));
    const win = window.open(url, '_blank', 'width=600,height=700');
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      const connected = await refreshGoogleCalendarStatus();
      const closed = !win || win.closed;
      if (connected || closed || tries > 120) {
        clearInterval(timer);
        if (connected) loadGoogleCalendarEvents().catch(()=>{});
      }
    }, 1200);
  } catch (e) {
    const statusEl = document.getElementById('gcal-status');
    if (statusEl) statusEl.textContent = 'Erro ao iniciar OAuth';
  }
}

async function loadGoogleCalendarEvents() {
  const list = document.getElementById('gcal-events');
  if (!list) return;
  list.textContent = 'Carregando...';
  try {
    const json = await api('/api/google-calendar/events');
    const items = (json && Array.isArray(json.items)) ? json.items : [];
    renderGoogleCalendarEvents(items);
  } catch (e) {
    list.textContent = 'Erro ao carregar eventos';
  }
}

function renderGoogleCalendarEvents(items) {
  const list = document.getElementById('gcal-events');
  if (!list) return;
  if (!items.length) { list.textContent = 'Sem eventos'; return; }
  const fmtDateTime = (v) => {
    if (!v) return '';
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
    const d = new Date(v);
    return isDateOnly ? d.toLocaleDateString('pt-BR') : d.toLocaleString('pt-BR');
  };
  const html = items.map(i => {
    const start = fmtDateTime(i.start);
    const end = fmtDateTime(i.end);
    const when = end ? `${start} — ${end}` : start;
    const loc = i.location ? ` • ${i.location}` : '';
    return `<div class="gcal-item"><div class="gcal-title">${i.summary || '(sem título)'}</div><div class="gcal-when">${when}${loc}</div></div>`;
  }).join('');
  list.innerHTML = html;
}

// Cameras Panel
function buildCamerasPanel() {
  const panel = document.getElementById('panel-cameras');
  if (!panel || panel.dataset.init === '1') return;
  const head = document.createElement('div');
  head.className = 'actions';
  const layoutSel = document.createElement('select');
  layoutSel.id = 'camera-layout';
  [3, 2, 1].forEach(n => {
    const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `${n} câmera(s)`;
    layoutSel.appendChild(opt);
  });
  const refresh = document.createElement('button');
  refresh.className = 'add-btn';
  refresh.textContent = 'Atualizar';
  refresh.onclick = () => loadCameras();
  head.append(layoutSel, refresh);
  const grid = document.createElement('div');
  grid.id = 'camera-grid';
  grid.className = 'camera-grid';
  panel.append(head, grid);
  panel.dataset.init = '1';
}

function getCameraNames() {
  try { return JSON.parse(localStorage.getItem('camera_names') || '{}'); } catch { return {}; }
}
function setCameraNames(map) {
  localStorage.setItem('camera_names', JSON.stringify(map || {}));
}
function getCameraLinkOverride() {
  try { return JSON.parse(localStorage.getItem('camera_links') || '{}'); } catch { return {}; }
}
function setCameraLinkOverride(map) {
  localStorage.setItem('camera_links', JSON.stringify(map || {}));
}
function validCamLink(u) {
  return /^(https?:\/\/|rtsp:\/\/|\/).+/i.test(u || '');
}
function ensureCam1AutoAuth() {
  try {
    api('/api/cameras/autoconfig/cam1').then(() => {
      const base = (localStorage.getItem('cam1_base') || 'http://192.168.1.37').trim();
      const snap = '/api/cameras/cam1/snapshot' + (base ? ('?base=' + encodeURIComponent(base)) : '');
      const map = getCameraLinkOverride();
      if (snap) {
        map['cam-1'] = snap;
        setCameraLinkOverride(map);
      }
      const names = getCameraNames();
      names['cam-1'] = names['cam-1'] || 'Câmera 1';
      setCameraNames(names);
    }).catch(()=>{});
  } catch {}
}

// Cameras
async function loadCameras() {
  const cams = await api('/api/cameras');
  state.cameras = cams;
  const grid = document.getElementById('camera-grid');
  grid.innerHTML = '';
  const layoutSel = document.getElementById('camera-layout');
  const max = Number(layoutSel ? layoutSel.value : 3) || 3;
  const names = getCameraNames();
  const links = getCameraLinkOverride();
  cams.slice(0, max).forEach(cam => {
    const div = document.createElement('div');
    div.className = 'camera-item';
    const header = document.createElement('div');
    header.className = 'camera-head';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.placeholder = 'Nome da câmera';
    nameInp.value = names[cam.id] || cam.name || '';
    nameInp.oninput = () => {
      const map = getCameraNames();
      map[cam.id] = nameInp.value;
      setCameraNames(map);
    };
    const maximize = document.createElement('button'); maximize.textContent = 'Max';
    const close = document.createElement('button'); close.textContent = 'Fechar';
    maximize.onclick = () => { div.classList.add('max'); };
    close.onclick = () => { div.classList.remove('max'); };
    header.append(nameInp, maximize, close);
    const link = links[cam.id] || cam.url || '';
    const valid = validCamLink(link);
    const err = document.createElement('div');
    err.className = 'camera-error';
    if (!valid) err.textContent = 'Link inválido ou ausente';
    const media = document.createElement(valid && /^https?:\/\//i.test(link) ? 'video' : 'img');
    if (media.tagName.toLowerCase() === 'video') {
      media.src = link;
      media.autoplay = true;
      media.muted = true;
      media.playsInline = true;
      media.controls = true;
    } else {
      media.src = valid ? (link + (link.includes('?') ? '&' : '?') + 'ts=' + Date.now()) : ('https://picsum.photos/400/200?random=' + cam.id);
    }
    const controls = document.createElement('div');
    controls.className = 'camera-controls';
    const zoomIn = document.createElement('button'); zoomIn.textContent = '+';
    const zoomOut = document.createElement('button'); zoomOut.textContent = '-';
    const snap = document.createElement('button'); snap.textContent = 'Snap';
    const setLink = document.createElement('input'); setLink.type = 'text'; setLink.placeholder = 'URL (http/rtsp)'; setLink.value = link;
    setLink.onchange = () => {
      const v = setLink.value.trim();
      if (!validCamLink(v)) { err.textContent = 'URL inválida'; return; }
      const map = getCameraLinkOverride(); map[cam.id] = v; setCameraLinkOverride(map);
      if (media.tagName.toLowerCase() === 'video') {
        media.src = v;
        media.play().catch(()=>{});
      } else {
        media.src = v + (v.includes('?') ? '&' : '?') + 'ts=' + Date.now();
      }
      err.textContent = '';
    };
    let scale = 1;
    zoomIn.onclick = () => { scale += 0.1; media.style.transform = `scale(${scale})`; media.style.transformOrigin = 'center'; };
    zoomOut.onclick = () => { scale = Math.max(1, scale - 0.1); media.style.transform = `scale(${scale})`; };
    snap.onclick = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 200;
      const ctx = canvas.getContext('2d');
      try { ctx.drawImage(media, 0, 0, 400, 200); } catch {}
      const data = canvas.toDataURL('image/png');
      try { await api(`/api/cameras/${cam.id}/snapshot`, { method: 'POST', body: JSON.stringify({ imageData: data }) }); } catch {}
    };
    controls.append(zoomIn, zoomOut, snap, setLink);
    div.append(header, media, err, controls);
    grid.append(div);
    if (media.tagName.toLowerCase() === 'img' && valid) {
      let timer = setInterval(() => {
        const v = getCameraLinkOverride()[cam.id] || link;
        if (validCamLink(v)) media.src = v + (v.includes('?') ? '&' : '?') + 'ts=' + Date.now();
      }, 2000);
      div._timer = timer;
    }
  });
  layoutSel.onchange = loadCameras;
}

// Session timeout after 30 minutes of inactivity
function initSessionTimeout() {
  let last = Date.now();
  const logoutBtn = document.getElementById('logout-btn');
  const update = () => { last = Date.now(); };
  ['click','keydown','mousemove','scroll','touchstart'].forEach(ev => {
    document.addEventListener(ev, update, { passive: true });
  });
  setInterval(() => {
    if (Date.now() - last > 30*60*1000) {
      if (logoutBtn) logoutBtn.click();
    }
  }, 60000);
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

function renderCNJTable(items) {
  const t = document.getElementById('cnj-table');
  if (!t) return;
  const header = '<tr><th>Número</th><th>Tribunal</th><th>Classe</th><th>Órgão Julgador</th><th>Grau</th><th>Ajuizamento</th></tr>';
  const rows = items.map(i => {
    const numero = i.numeroProcesso || '';
    const trib = i.tribunal || '';
    const classe = i.classe && i.classe.nome ? i.classe.nome : '';
    const orgao = i.orgaoJulgador && i.orgaoJulgador.nome ? i.orgaoJulgador.nome : '';
    const grau = i.grau || '';
    const aju = i.dataAjuizamento ? new Date(i.dataAjuizamento).toLocaleDateString('pt-BR') : '';
    return `<tr><td>${numero}</td><td>${trib}</td><td>${classe}</td><td>${orgao}</td><td>${grau}</td><td>${aju}</td></tr>`;
  }).join('');
  t.innerHTML = header + rows;
}

function renderPjeResults(items) {
  const t = document.getElementById('pje-results-table');
  if (!t) return;
  const header = '<tr><th>Ações</th><th>Processo</th><th>Características</th><th>Órgão julgador</th><th>Autuado em</th><th>Classe judicial</th><th>Polo ativo</th><th>Polo passivo</th><th>Localização</th><th>Última moviment.</th></tr>';
  const rows = items.map(i => {
    const num = i.numeroProcesso || '';
    const orgao = i.orgaoJulgador && i.orgaoJulgador.nome ? i.orgaoJulgador.nome : '';
    const aju = i.dataAjuizamento ? new Date(i.dataAjuizamento).toLocaleDateString('pt-BR') : '';
    const classe = i.classe && i.classe.nome ? i.classe.nome : '';
    const poloAtivo = (i.partes || []).filter(p => /AUTOR|ATIVO/i.test(p.tipoParte||'')).map(p => p.nome).join('; ');
    const poloPassivo = (i.partes || []).filter(p => /RÉU|PASSIVO/i.test(p.tipoParte||'')).map(p => p.nome).join('; ');
    const loc = i.tribunal || '';
    const lastMov = (i.movimentos || []).slice(-1)[0];
    const lastMovStr = lastMov ? (lastMov.movimento || lastMov.dataHora || '') : '';
    const jusUrl = `https://www.jusbrasil.com.br/processos/?q=${encodeURIComponent(num)}`;
    const actions = `<a href="${jusUrl}" target="_blank">Abrir Jusbrasil</a>`;
    return `<tr><td>${actions}</td><td>${num}</td><td>${classe}</td><td>${orgao}</td><td>${aju}</td><td>${classe}</td><td>${poloAtivo}</td><td>${poloPassivo}</td><td>${loc}</td><td>${lastMovStr}</td></tr>`;
  }).join('');
  t.innerHTML = header + rows;
}

function renderGoogleRealtime(json) {
  const actEl = document.getElementById('ga-active-users');
  const evEl = document.getElementById('ga-events');
  const pagesT = document.getElementById('ga-pages-table');
  const countriesT = document.getElementById('ga-countries-table');
  if (!actEl || !evEl || !pagesT || !countriesT) return;
  const metrics = {};
  const rows = json && json.rows ? json.rows : [];
  rows.forEach(r => {
    const dims = r.dimensionValues.map(v => v.value);
    const mets = r.metricValues.map(v => Number(v.value || 0));
    const pagePath = dims[2] || '';
    const country = dims[0] || '';
    const active = mets[0] || 0;
    const events = mets[1] || 0;
    metrics.activeUsers = (metrics.activeUsers || 0) + active;
    metrics.eventCount = (metrics.eventCount || 0) + events;
    if (pagePath) {
      metrics.pages = metrics.pages || {};
      metrics.pages[pagePath] = (metrics.pages[pagePath] || 0) + active;
    }
    if (country) {
      metrics.countries = metrics.countries || {};
      metrics.countries[country] = (metrics.countries[country] || 0) + active;
    }
  });
  actEl.textContent = String(metrics.activeUsers || 0);
  evEl.textContent = String(metrics.eventCount || 0);
  const pages = Object.entries(metrics.pages || {}).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const countries = Object.entries(metrics.countries || {}).sort((a,b)=>b[1]-a[1]).slice(0,10);
  pagesT.innerHTML = '<tr><th>Página</th><th>Usuários</th></tr>' + pages.map(([p,c])=>`<tr><td>${p}</td><td>${c}</td></tr>`).join('');
  countriesT.innerHTML = '<tr><th>País</th><th>Usuários</th></tr>' + countries.map(([p,c])=>`<tr><td>${p}</td><td>${c}</td></tr>`).join('');
}

function renderGoogleAds(entry) {
  const t = document.getElementById('gad-table');
  const lu = document.getElementById('gad-last-update');
  if (!t) return;
  const header = '<tr><th>Nome da Campanha</th><th>Status</th><th>Orçamento diário</th><th>Custo total</th><th>Impressões</th><th>Cliques</th><th>CTR</th><th>CPC</th><th>Conversões</th><th>Custo por conversão</th></tr>';
  const items = (entry && entry.items) ? entry.items : [];
  const rows = items.map(i => {
    return `<tr><td>${i.name}</td><td>${i.status}</td><td>${i.dailyBudget.toFixed(2)}</td><td>${i.cost.toFixed(2)}</td><td>${i.impressions}</td><td>${i.clicks}</td><td>${(i.ctr||0).toFixed(2)}%</td><td>${(i.cpc||0).toFixed(2)}</td><td>${i.conversions}</td><td>${(i.costPerConversion||0).toFixed(2)}</td></tr>`;
  }).join('');
  t.classList.add('gad-table');
  t.innerHTML = header + rows;
  if (lu) {
    const d = entry && entry.date ? new Date(entry.date) : new Date();
    lu.textContent = 'Atualizado: ' + d.toLocaleString('pt-BR');
  }
}

function renderGoogleAdsAlerts(payload) {
  const el = document.getElementById('gad-alerts');
  if (!el) return;
  const alerts = (payload && payload.alerts) ? payload.alerts : [];
  if (!alerts.length) { el.textContent = ''; return; }
  const lines = alerts.map(a => `${a.type} - ${a.name}: atual=${a.value.toFixed(2)} base=${a.baseline.toFixed(2)}`).join('\n');
  el.textContent = lines;
}

async function loadGoogleAds() {
  const t = document.getElementById('gad-table');
  const btn = document.getElementById('gad-refresh');
  const ybtn = document.getElementById('gad-yesterday');
  const exp = document.getElementById('gad-export');
  const alerts = document.getElementById('gad-alerts');
  const check = document.getElementById('gad-check');
  const connect = document.getElementById('gad-connect');
  if (!t) return;
  async function fetchDaily() {
    try {
      const json = await api('/api/google-ads/daily');
      renderGoogleAds(json);
    } catch (e) {
      t.innerHTML = '';
      if (alerts) {
        let msg = e && e.message ? e.message : String(e);
        try {
          const j = JSON.parse(msg);
          if (j && j.missing) msg = 'Configuração ausente: ' + j.missing.join(', ');
        } catch {}
        alerts.textContent = 'Erro ao carregar: ' + msg;
      }
    }
  }
  await fetchDaily();
  if (btn) btn.onclick = async () => {
    try {
      const entry = await api('/api/google-ads/realtime');
      renderGoogleAds(entry);
      if (!entry.items || !entry.items.length) {
        if (alerts) alerts.textContent = 'Sem dados hoje. Carregando ontem...';
        try {
          const y = await api('/api/google-ads/collect', { method: 'POST', body: JSON.stringify({ dateRange: 'YESTERDAY' }) });
          renderGoogleAds(y);
          if (alerts) alerts.textContent = 'Sem dados hoje. Exibindo dados de ontem.';
        } catch (e2) {
          if (alerts) alerts.textContent = 'Falha ao carregar ontem: ' + (e2.message || String(e2));
        }
      } else {
        if (alerts) alerts.textContent = '';
      }
    } catch (e) {
      if (alerts) {
        let msg = e && e.message ? e.message : String(e);
        try {
          const j = JSON.parse(msg);
          if (j && j.missing) msg = 'Configuração ausente: ' + j.missing.join(', ');
        } catch {}
        alerts.textContent = 'Erro ao atualizar: ' + msg;
      }
    }
  };
  if (ybtn) ybtn.onclick = async () => {
    try {
      const y = await api('/api/google-ads/collect', { method: 'POST', body: JSON.stringify({ dateRange: 'YESTERDAY' }) });
      renderGoogleAds(y);
      if (alerts) alerts.textContent = 'Exibindo dados de ontem.';
    } catch (e) {
      if (alerts) alerts.textContent = 'Falha ao carregar ontem: ' + (e.message || String(e));
    }
  };
  if (exp) exp.onclick = () => {};
  if (check) check.onclick = async () => {
    try {
      const st = await api('/api/google-ads/config/status');
      const lines = [];
      if (st.missing && st.missing.length) lines.push('Configuração ausente: ' + st.missing.join(', '));
      if (st.connection) {
        lines.push('Conexão: ' + (st.connection.ok ? 'OK' : 'Falha') + (st.connection.details ? (' - ' + st.connection.details) : ''));
        if (st.connection.error) lines.push('Erro: ' + st.connection.error);
      }
      alerts.textContent = lines.join('\n') || 'OK';
    } catch (e) {
      alerts.textContent = 'Erro ao checar: ' + (e.message || String(e));
    }
  };
  if (connect) connect.onclick = async () => {
    try {
      const origin = location.origin;
      const { url } = await api('/api/google-ads/oauth/url?origin=' + encodeURIComponent(origin));
      window.open(url, '_blank');
    } catch (e) {
      alerts.textContent = 'Erro ao iniciar OAuth: ' + (e.message || String(e));
    }
  };
}
async function loadGoogle() {
  const actEl = document.getElementById('ga-active-users');
  const evEl = document.getElementById('ga-events');
  const pagesT = document.getElementById('ga-pages-table');
  const countriesT = document.getElementById('ga-countries-table');
  const btn = document.getElementById('ga-refresh');
  const auto = document.getElementById('ga-auto');
  if (!actEl || !evEl || !pagesT || !countriesT) return;
  async function fetchRealtime() {
    try {
      const json = await api('/api/ga/realtime');
      renderGoogleRealtime(json);
    } catch {
      actEl.textContent = '0';
      evEl.textContent = '0';
      pagesT.innerHTML = '';
      countriesT.innerHTML = '';
    }
  }
  await fetchRealtime();
  if (btn) btn.onclick = fetchRealtime;
  let timer = null;
  function setAuto() {
    if (auto && auto.checked) {
      if (timer) clearInterval(timer);
      timer = setInterval(fetchRealtime, 60000);
    } else if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }
  if (auto) {
    auto.onchange = setAuto;
    setAuto();
  }
}
function normalizeDigestoItems(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.data)) return json.data;
  if (json && Array.isArray(json.items)) return json.items;
  if (json && Array.isArray(json.results)) return json.results;
  return [];
}

function renderDigestoTable(items) {
  const t = document.getElementById('digesto-table');
  if (!t) return;
  const header = '<tr><th>CNJ</th><th>Tribunal</th><th>OAB ID</th><th>Correlation</th><th>Classe</th><th>Status</th></tr>';
  const get = (o, keys) => {
    for (const k of keys) {
      if (o && o[k] != null) return o[k];
    }
    return '';
  };
  const rows = items.map(i => {
    const cnj = get(i, ['numero_cnj','cnj','numeroCNJ']);
    const trib = get(i, ['tribunal','orgao','jurisdicao']);
    const oabId = get(i, ['oab_id','oabId']);
    const corr = get(i, ['correlation_id','correlationId']);
    const classe = get(i, ['classe','classe_nome','classeNome']);
    const status = get(i, ['status','situacao']);
    return `<tr><td>${cnj}</td><td>${trib}</td><td>${oabId}</td><td>${corr}</td><td>${classe}</td><td>${status}</td></tr>`;
  }).join('');
  t.innerHTML = header + rows;
}

document.addEventListener('DOMContentLoaded', () => {
  initAuthUI();
});
