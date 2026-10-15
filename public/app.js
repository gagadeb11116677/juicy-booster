'use strict';

let PORT = 3003;
let TOKEN = '';
const metaToken = document.querySelector('meta[name="juicy-token"]');
const metaPort = document.querySelector('meta[name="juicy-port"]');
if (metaToken) TOKEN = metaToken.getAttribute('content');
if (metaPort) PORT = parseInt(metaPort.getAttribute('content'), 10) || 3003;

async function api(path, opts) {
  const sep = path.indexOf('?') >= 0 ? '&' : '?';
  const url = path + sep + 'XTransformPort=' + PORT;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (opts && opts.method === 'POST') headers['X-Juicy-Token'] = TOKEN;
    const res = await fetch(url, { headers, ...opts });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
      return { error: msg, _status: res.status };
    }
    return await res.json();
  } catch (e) {
    return { error: (e && e.message) || 'network error' };
  }
}

function fmtBytes(b) {
  if (!b || b <= 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1) + ' ' + sizes[i];
}
function fmtUptime(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h + 'j ' + m + 'm';
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function setBar(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = Math.max(0, Math.min(100, pct));
  el.style.width = v + '%';
  el.className = 'm-bar-fill' + (v >= 85 ? ' bad' : v >= 65 ? ' warn' : '');
}

const chartHistory = { cpu: [], ram: [] };
function drawChart(canvasId, data) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  ctx.clearRect(0, 0, w, h);
  if (data.length < 2) return;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('AccentColor').trim() || '#0066cc';
  const gray = getComputedStyle(document.documentElement).getPropertyValue('GrayText').trim() || '#888';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * w;
    const y = h - (data[i] / 100) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = accent + '22';
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
}

const state = { metrics: null, settings: null, isAdmin: false, selectedProc: null, junkScan: null };

async function pollMetrics() {
  const m = await api('/api/metrics');
  if (m.error || typeof m.score !== 'number') return;
  state.metrics = m;
  document.getElementById('m-cpu').textContent = m.cpu.percent.toFixed(1) + '%';
  setBar('bar-cpu', m.cpu.percent);
  document.getElementById('m-ram').textContent = m.ram.percent.toFixed(1) + '%';
  setBar('bar-ram', m.ram.percent);
  document.getElementById('m-disk').textContent = m.disk.percent.toFixed(1) + '%';
  setBar('bar-disk', m.disk.percent);
  if (m.gpu.percent != null && typeof m.gpu.percent === 'number') {
    document.getElementById('m-gpu').textContent = m.gpu.percent.toFixed(1) + '%';
  } else {
    document.getElementById('m-gpu').textContent = 'N/A';
  }
  document.getElementById('m-temp').textContent = m.cpu.temp != null ? m.cpu.temp + ' C' : 'N/A';
  document.getElementById('m-net').textContent = m.network.downMBps.toFixed(1) + ' MB/s';
  chartHistory.cpu.push(m.cpu.percent);
  chartHistory.ram.push(m.ram.percent);
  if (chartHistory.cpu.length > 60) chartHistory.cpu.shift();
  if (chartHistory.ram.length > 60) chartHistory.ram.shift();
  drawChart('chart-cpu', chartHistory.cpu);
  drawChart('chart-ram', chartHistory.ram);
  document.getElementById('sb-cpu').textContent = 'CPU ' + m.cpu.percent.toFixed(0) + '%';
  document.getElementById('sb-ram').textContent = 'RAM ' + fmtBytes(m.ram.used) + ' / ' + fmtBytes(m.ram.total);
  document.getElementById('sb-disk').textContent = 'Disk ' + fmtBytes(m.disk.free) + ' bebas';
}

function showPage(name) {
  document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  const nav = document.querySelector('.nav-item[data-page="' + name + '"]');
  const page = document.getElementById('page-' + name);
  if (nav) nav.classList.add('active');
  if (page) page.classList.add('active');
  if (name === 'proses') loadProcesses();
  else if (name === 'startup') loadStartup();
  else if (name === 'disk') loadDrives();
  else if (name === 'jaringan') loadNetwork();
  else if (name === 'kesehatan') loadBattery();
  else if (name === 'daya') loadPower();
  else if (name === 'pengaturan') loadSettings();
}

async function loadProcesses() {
  const body = document.getElementById('proc-body');
  const r = await api('/api/processes');
  if (r.error || !r.processes) { body.innerHTML = '<tr><td colspan="5" class="empty">Gagal memuat.</td></tr>'; return; }
  const search = (document.getElementById('proc-search').value || '').toLowerCase();
  const list = r.processes.filter(function (p) { return !search || p.name.toLowerCase().includes(search); });
  body.innerHTML = list.map(function (p) {
    return '<tr data-pid="' + p.pid + '"' + (p.protected ? ' class="disabled"' : '') + '>' +
      '<td>' + escapeHtml(p.name) + (p.protected ? ' <span class="tag">dilindungi</span>' : '') + '</td>' +
      '<td>' + p.pid + '</td>' +
      '<td>' + p.cpu.toFixed(1) + '%</td>' +
      '<td>' + p.memMB.toFixed(0) + ' MB</td>' +
      '<td>' + escapeHtml(p.path || '') + '</td></tr>';
  }).join('');
  body.querySelectorAll('tr').forEach(function (tr) {
    tr.addEventListener('click', function () {
      body.querySelectorAll('tr').forEach(function (t) { t.classList.remove('selected'); });
      tr.classList.add('selected');
      state.selectedProc = parseInt(tr.dataset.pid, 10);
      document.getElementById('btn-end-proc').disabled = false;
    });
  });
}

async function killSelectedProc() {
  if (!state.selectedProc) return;
  const ok = await showConfirm('Akhiri proses PID ' + state.selectedProc + '?');
  if (!ok) return;
  const r = await api('/api/processes/kill', { method: 'POST', body: JSON.stringify({ pid: state.selectedProc }) });
  if (r.ok) { loadProcesses(); loadTopProcs(); }
  else alert(r.error || 'Gagal');
}

async function loadTopProcs() {
  const body = document.getElementById('top-procs-body');
  const r = await api('/api/processes');
  if (r.error || !r.processes) return;
  body.innerHTML = r.processes.slice(0, 5).map(function (p) {
    return '<tr><td>' + escapeHtml(p.name) + '</td><td>' + p.pid + '</td><td>' + p.cpu.toFixed(1) + '%</td><td>' + p.memMB.toFixed(0) + ' MB</td></tr>';
  }).join('');
}

async function scanJunkUI() {
  const list = document.getElementById('junk-list');
  list.innerHTML = '<p class="empty">Memindai...</p>';
  const r = await api('/api/junk/scan', { method: 'POST' });
  if (r.error) { list.innerHTML = '<p class="empty">Gagal memindai.</p>'; return; }
  state.junkScan = r;
  list.innerHTML = r.categories.map(function (c) {
    return '<div class="junk-item">' +
      '<input type="checkbox" data-id="' + c.id + '" checked>' +
      '<div class="junk-info"><div class="junk-name">' + escapeHtml(c.label) + '</div>' +
      '<div class="junk-detail">' + c.count + ' file' + (c.note ? ' - ' + escapeHtml(c.note) : '') + '</div></div>' +
      '<span class="junk-size">' + fmtBytes(c.sizeBytes) + '</span></div>';
  }).join('');
  document.getElementById('btn-clean').disabled = false;
}

async function cleanJunkUI() {
  const ids = Array.from(document.querySelectorAll('.junk-item input:checked')).map(function (cb) { return cb.dataset.id; });
  if (!ids.length) return;
  const total = state.junkScan ? state.junkScan.categories.filter(function (c) { return ids.includes(c.id); }).reduce(function (a, c) { return a + c.sizeBytes; }, 0) : 0;
  const ok = await showConfirm('Bersihkan ' + ids.length + ' kategori (' + fmtBytes(total) + ')?');
  if (!ok) return;
  const r = await api('/api/junk/clean', { method: 'POST', body: JSON.stringify({ categories: ids }) });
  const result = document.getElementById('junk-result');
  if (r.ok) {
    result.innerHTML = '<div class="result-box">' + escapeHtml(r.detail) + ' / ' + fmtBytes(r.freedBytes) + ' dibebaskan</div>';
    scanJunkUI();
  } else {
    result.innerHTML = '<div class="result-box">Gagal: ' + escapeHtml(r.error || '') + '</div>';
  }
}

async function loadStartup() {
  const body = document.getElementById('startup-body');
  const r = await api('/api/startup');
  if (r.error || !r.items) { body.innerHTML = '<tr><td colspan="3" class="empty">Gagal memuat.</td></tr>'; return; }
  if (!r.items.length) { body.innerHTML = '<tr><td colspan="3" class="empty">Tidak ada item startup.</td></tr>'; return; }
  body.innerHTML = r.items.slice(0, 30).map(function (it) {
    return '<tr><td>' + escapeHtml(it.name) + '</td><td>' + escapeHtml(it.location) + '</td><td>' + escapeHtml(it.user) + '</td></tr>';
  }).join('');
}

async function loadDrives() {
  const list = document.getElementById('drives-list');
  const r = await api('/api/drives');
  if (r.error || !r.drives) { list.innerHTML = '<p class="empty">Gagal memuat.</p>'; return; }
  list.innerHTML = r.drives.map(function (dr) {
    const cls = dr.percent >= 85 ? 'bad' : dr.percent >= 65 ? 'warn' : '';
    return '<div class="drive-row"><div class="drive-id">' + escapeHtml(dr.id) + '</div>' +
      '<div class="drive-bar"><div class="drive-bar-fill ' + cls + '" style="width:' + dr.percent + '%"></div></div>' +
      '<div class="drive-info">' + dr.freeGB + ' GB bebas / ' + dr.totalGB + ' GB</div></div>';
  }).join('');
}

async function loadNetwork() {
  const list = document.getElementById('net-list');
  const r = await api('/api/network');
  if (r.error || !r.interfaces) { list.innerHTML = '<p class="empty">Gagal memuat.</p>'; return; }
  list.innerHTML = r.interfaces.map(function (i) {
    return '<div class="drive-row"><div class="drive-id">' + escapeHtml(i.name) + '</div>' +
      '<div class="drive-info">' + escapeHtml(i.address) + ' / ' + escapeHtml(i.mac) + '</div></div>';
  }).join('');
}

async function loadBattery() {
  const info = document.getElementById('battery-info');
  const r = await api('/api/battery');
  if (r.error) { info.innerHTML = '<p class="empty">Gagal.</p>'; return; }
  if (r.hasBattery) {
    info.innerHTML = '<div class="drive-row"><div class="drive-id">' + r.percent + '%</div><div class="drive-info">' + escapeHtml(r.status) + '</div></div>';
  } else {
    info.innerHTML = '<p class="empty">Tidak ada baterai.</p>';
  }
}

async function loadPower() {
  const list = document.getElementById('power-modes');
  list.innerHTML = '<div class="setting-row"><span class="setting-label">Seimbang</span><button class="btn" data-mode="balanced">Aktifkan</button></div>' +
    '<div class="setting-row"><span class="setting-label">Performa Tinggi</span><button class="btn" data-mode="performance">Aktifkan</button></div>' +
    '<div class="setting-row"><span class="setting-label">Game Mode</span><button class="btn" data-mode="game">Aktifkan</button></div>' +
    '<div class="setting-row"><span class="setting-label">Hemat Baterai</span><button class="btn" data-mode="saver">Aktifkan</button></div>';
  list.querySelectorAll('button[data-mode]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const r = await api('/api/mode', { method: 'POST', body: JSON.stringify({ mode: btn.dataset.mode }) });
      if (r.ok) alert('Mode: ' + r.label);
      else alert(r.error || 'Gagal');
    });
  });
}

async function loadSettings() {
  const r = await api('/api/settings');
  if (r.error || !r.settings) return;
  state.settings = r.settings;
  const list = document.getElementById('settings-list');
  list.innerHTML = '';
  const rows = [
    { key: 'theme', label: 'Tema', type: 'select', options: [['system', 'Sistem'], ['light', 'Terang'], ['dark', 'Gelap']] },
    { key: 'confirmBeforeDelete', label: 'Konfirmasi sebelum menghapus', type: 'checkbox' },
    { key: 'startWithWindows', label: 'Mulai bersama Windows', type: 'checkbox' },
    { key: 'checkForUpdates', label: 'Cek pembaruan saat dibuka', type: 'checkbox' },
  ];
  rows.forEach(function (row) {
    const div = document.createElement('div');
    div.className = 'setting-row';
    const label = document.createElement('span');
    label.className = 'setting-label';
    label.textContent = row.label;
    div.appendChild(label);
    if (row.type === 'checkbox') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!r.settings[row.key];
      cb.addEventListener('change', function () { setSetting(row.key, cb.checked); });
      div.appendChild(cb);
    } else if (row.type === 'select') {
      const sel = document.createElement('select');
      row.options.forEach(function (o) {
        const opt = document.createElement('option');
        opt.value = o[0]; opt.textContent = o[1];
        if (r.settings[row.key] === o[0]) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () { setSetting(row.key, sel.value); applyTheme(sel.value); });
      div.appendChild(sel);
    }
    list.appendChild(div);
  });
  const ver = document.getElementById('ver');
  if (ver && state.metrics) ver.textContent = state.metrics.version || '0.5.0';
}

async function setSetting(key, value) {
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ [key]: value }) });
}

function applyTheme(theme) {
  if (theme === 'light') document.documentElement.style.colorScheme = 'light';
  else if (theme === 'dark') document.documentElement.style.colorScheme = 'dark';
  else document.documentElement.style.colorScheme = 'light dark';
}

let confirmResolve = null;
function showConfirm(msg) {
  return new Promise(function (resolve) {
    const dialog = document.getElementById('confirm-dialog');
    document.getElementById('confirm-msg').textContent = msg;
    dialog.showModal();
    confirmResolve = resolve;
    dialog.addEventListener('close', function () {
      resolve(dialog.returnValue === 'ok');
    }, { once: true });
  });
}

async function flushDns() {
  const r = await api('/api/boost', { method: 'POST' });
  if (r.ok) alert('DNS di-flush.');
  else alert(r.error || 'Gagal');
}

async function pollState() {
  const s = await api('/api/state');
  if (s.error) return;
  state.isAdmin = s.isAdmin;
  if (!state.isAdmin) {
    document.getElementById('sb-admin').textContent = 'Tanpa admin: sebagian fitur terbatas';
  }
  if (s.version) {
    const v = document.getElementById('ver');
    if (v) v.textContent = s.version;
  }
}

function sendBye() {
  try { navigator.sendBeacon('/api/bye'); } catch (e) {}
}

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.nav-item').forEach(function (n) {
    n.addEventListener('click', function () { showPage(n.dataset.page); });
  });
  document.getElementById('btn-scan-junk').addEventListener('click', function () { showPage('pembersih'); scanJunkUI(); });
  document.getElementById('btn-flush-dns').addEventListener('click', flushDns);
  document.getElementById('btn-flush-dns2').addEventListener('click', flushDns);
  document.getElementById('btn-end-proc').addEventListener('click', killSelectedProc);
  document.getElementById('btn-scan').addEventListener('click', scanJunkUI);
  document.getElementById('btn-clean').addEventListener('click', cleanJunkUI);
  document.getElementById('proc-search').addEventListener('input', loadProcesses);
  document.getElementById('btn-copy-sys').addEventListener('click', async function () {
    const m = state.metrics;
    if (!m) return;
    const text = 'OS: ' + (m.os.name || '') + '\nCPU: ' + (m.hardware.cpuModel || '') + '\nRAM: ' + fmtBytes(m.hardware.totalMemory) + '\nDisk: ' + fmtBytes(m.disk.total) + '\nAdmin: ' + (state.isAdmin ? 'ya' : 'tidak') + '\nVersi: 0.5.0';
    try { await navigator.clipboard.writeText(text); alert('Disalin.'); } catch (e) { alert('Gagal salin.'); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'F5') { e.preventDefault(); pollMetrics(); loadTopProcs(); }
  });
  window.addEventListener('pagehide', sendBye);
  pollState();
  pollMetrics();
  loadTopProcs();
  setInterval(pollMetrics, 2000);
  setInterval(function () { api('/api/ping'); }, 5000);
});
