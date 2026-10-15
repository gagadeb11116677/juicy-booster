/* Juicy Booster v0.4 - frontend logic (vanilla JS) */
'use strict';

const PORT = 3003;

// Baca token dari meta tag yang di-inject server (anti CSRF).
const AUTH_TOKEN = (function () {
  const m = document.querySelector('meta[name="juicy-token"]');
  return m ? m.getAttribute('content') : '';
})();

async function api(path, opts) {
  const url = path + (path.indexOf('?') >= 0 ? '&' : '?') + 'XTransformPort=' + PORT;
  try {
    const headers = { 'Content-Type': 'application/json' };
    // POST butuh token auth
    if (opts && opts.method === 'POST') {
      headers['X-Juicy-Token'] = AUTH_TOKEN;
    }
    const res = await fetch(url, { headers, ...opts });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
      return { error: msg };
    }
    return await res.json();
  } catch (e) {
    return { error: (e && e.message) || 'network error' };
  }
}

let toastTimer = null;
function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + (type || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.className = 'toast ' + (type || ''); }, 2800);
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
function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function setBar(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = Math.max(0, Math.min(100, pct));
  el.style.width = v + '%';
  el.className = 'bar-fill' + (v >= 85 ? ' bad' : v >= 65 ? ' warn' : '');
}
function colorByLoad(v) {
  // Monochrome: selalu putih/abu, sesuai tema hitam-putih
  return 'var(--accent)';
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

const state = {
  metrics: null,
  boosted: false,
  boostCount: 0,
  currentMode: 'balanced',
  cleanedCats: new Set(),
};

/* ===== Metrics ===== */
async function pollMetrics() {
  const m = await api('/api/metrics');
  if (m.error || typeof m.score !== 'number') return;
  state.metrics = m;

  const score = m.score;
  const gauge = document.getElementById('gaugeCircle');
  const circ = 326.7;
  gauge.style.strokeDashoffset = circ * (1 - score / 100);
  gauge.style.stroke = colorByLoad(100 - score);
  document.getElementById('scoreNum').textContent = score;

  document.getElementById('mCpu').textContent = m.cpu.percent.toFixed(1) + '%';
  setBar('barCpu', m.cpu.percent);
  document.getElementById('footCpu').textContent = (m.cpu.model || '').slice(0, 30) + ' / ' + m.cpu.cores + ' cores';

  document.getElementById('mRam').textContent = m.ram.percent.toFixed(1) + '%';
  setBar('barRam', m.ram.percent);
  document.getElementById('footRam').textContent = fmtBytes(m.ram.used) + ' / ' + fmtBytes(m.ram.total);

  document.getElementById('mDisk').textContent = m.disk.percent.toFixed(1) + '%';
  setBar('barDisk', m.disk.percent);
  document.getElementById('footDisk').textContent = fmtBytes(m.disk.free) + ' bebas';

  // GPU: tampilkan N/A kalo gak ada sumber real (bukan angka palsu)
  if (m.gpu.percent != null && typeof m.gpu.percent === 'number') {
    document.getElementById('mGpu').textContent = m.gpu.percent.toFixed(1) + '%';
    setBar('barGpu', m.gpu.percent);
  } else {
    document.getElementById('mGpu').textContent = 'N/A';
    document.getElementById('barGpu').style.width = '0%';
    document.getElementById('barGpu').className = 'bar-fill';
  }
  document.getElementById('footGpu').textContent = (m.gpu.name || 'GPU').slice(0, 28) + (m.gpu.temp ? ' / ' + m.gpu.temp + 'C' : '') + (m.gpu.available ? '' : ' / butuh nvidia-smi');

  if (m.cpu.temp != null) {
    document.getElementById('mTemp').textContent = m.cpu.temp + 'C';
    setBar('barTemp', m.cpu.temp);
    document.getElementById('footTemp').textContent = m.cpu.temp < 60 ? 'Aman' : m.cpu.temp < 80 ? 'Hangat' : 'Panas';
  } else {
    document.getElementById('mTemp').textContent = 'N/A';
    document.getElementById('barTemp').style.width = '0%';
    document.getElementById('footTemp').textContent = 'butuh admin';
  }

  document.getElementById('mNet').textContent = m.network.downMBps.toFixed(1) + ' MB/s';
  document.getElementById('footNet').textContent = 'DOWN ' + m.network.downMBps.toFixed(1) + ' / UP ' + m.network.upMBps.toFixed(1);

  const badge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  badge.className = 'status-badge';
  if (score >= 75) { badge.classList.add('ok'); statusText.textContent = 'Sistem sehat'; }
  else if (score >= 50) { badge.classList.add('warn'); statusText.textContent = 'Lumayan, bisa di-boost'; }
  else { badge.classList.add('bad'); statusText.textContent = 'Berat, butuh boost'; }

  const title = document.getElementById('heroTitle');
  const desc = document.getElementById('heroDesc');
  if (state.boosted) {
    title.textContent = 'Sudah di-boost';
    desc.textContent = 'Performa sedang optimal. Boost lagi setelah main game berat atau membuka banyak aplikasi.';
  } else if (score < 50) {
    title.textContent = 'Windows sedang berat';
    desc.textContent = 'CPU/RAM tinggi. Klik Boost untuk membebaskan resource dan membersihkan junk.';
  } else {
    title.textContent = 'Siap di-boost';
    desc.textContent = 'Klik tombol Boost untuk membersihkan junk, membebaskan RAM, dan mengoptimasi jaringan dalam satu klik.';
  }

  document.getElementById('uptime').textContent = 'uptime ' + fmtUptime(m.uptime);
  document.getElementById('boostCount').textContent = state.boostCount + 'x boost';

  const hp = document.getElementById('hostPill');
  if (m.os && m.os.hostname) hp.textContent = m.os.hostname + ' / ' + (m.os.name || m.os.platform);
}

/* ===== State ===== */
async function pollState() {
  const s = await api('/api/state');
  if (s.error) return;
  state.boosted = s.boosted;
  state.boostCount = s.boostCount || 0;
  state.currentMode = s.mode || 'balanced';
  (s.cleanedCategories || []).forEach(function (c) { state.cleanedCats.add(c); });
  renderModeActive();
  renderCleanDone();
}

/* ===== Boost ===== */
// API dipanggil DULU, baru animasi tampilkan hasil per tahap (real, bukan palsu).
async function doBoost() {
  const overlay = document.getElementById('boostOverlay');
  const stagesEl = document.getElementById('overlayStages');
  const titleEl = document.getElementById('overlayTitle');
  const footEl = document.getElementById('overlayFoot');
  overlay.classList.add('show');
  titleEl.textContent = 'Menjalankan optimasi...';
  footEl.textContent = '';
  stagesEl.innerHTML = '<li class="active">Memanggil API boost...</li>';

  // 1. Panggil API dulu — jalankan semua tahap nyata di backend
  const r = await api('/api/boost', { method: 'POST' });
  stagesEl.innerHTML = '';

  if (r.error) {
    titleEl.textContent = 'Gagal';
    footEl.textContent = r.error;
    await new Promise(function (rr) { setTimeout(rr, 1500); });
    overlay.classList.remove('show');
    toast('Boost gagal: ' + r.error, 'err');
    return;
  }

  // 2. Animasikan hasil per tahap berdasarkan response real
  titleEl.textContent = 'Boosting...';
  const stages = r.stages || [];
  const statusIcon = { ok: 'done', partial: 'done', fail: 'active', unsupported: 'active' };
  const statusText = { ok: 'OK', partial: 'sebagian', fail: 'gagal', unsupported: 'tidak didukung' };

  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const li = document.createElement('li');
    li.textContent = s.label + ' — ' + (statusText[s.status] || s.status) + (s.freed > 0 ? ' (' + fmtBytes(s.freed) + ')' : '');
    li.classList.add('active');
    stagesEl.appendChild(li);
    await new Promise(function (rr) { setTimeout(rr, 350); });
    li.classList.remove('active');
    li.classList.add(s.status === 'ok' || s.status === 'partial' ? 'done' : 'fail');
  }

  // 3. Ringkasan
  footEl.textContent = (r.okCount || 0) + '/' + (r.totalStages || stages.length) + ' tahap berhasil / ' + (r.freedFormatted || '0 B') + ' dibebaskan';
  await new Promise(function (rr) { setTimeout(rr, 900); });
  overlay.classList.remove('show');

  if (r.ok) {
    state.boosted = true;
    state.boostCount = r.boostCount || state.boostCount + 1;
    toast('BOOST: ' + (r.okCount || 0) + '/' + (r.totalStages || 0) + ' tahap OK, ' + (r.freedFormatted || '0 B') + ' dibebaskan', 'ok');
  } else {
    toast('Boost selesai dengan kegagalan', 'err');
  }
  pollState();
  pollMetrics();
  loadHistory();
}

/* ===== Processes ===== */
async function loadProcesses() {
  const body = document.getElementById('procBody');
  body.innerHTML = '<tr><td colspan="5" class="empty">Memuat...</td></tr>';
  const r = await api('/api/processes');
  if (r.error || !r.processes) {
    body.innerHTML = '<tr><td colspan="5" class="empty">Gagal memuat (butuh admin di Windows).</td></tr>';
    return;
  }
  const list = r.processes.slice(0, 25);
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty">Tidak ada proses.</td></tr>';
    return;
  }
  body.innerHTML = list.map(function (p) {
    return '<tr>' +
      '<td class="proc-pid">' + p.pid + '</td>' +
      '<td class="proc-name">' + escapeHtml(p.name) + '</td>' +
      '<td class="mono">' + p.cpu.toFixed(1) + '</td>' +
      '<td class="mono">' + p.memMB.toFixed(0) + '</td>' +
      '<td><button class="btn-kill" data-pid="' + p.pid + '" data-name="' + escapeHtml(p.name) + '">Kill</button></td>' +
      '</tr>';
  }).join('');
  body.querySelectorAll('.btn-kill').forEach(function (btn) {
    btn.addEventListener('click', function () { killProc(btn.dataset.pid, btn.dataset.name, btn); });
  });
}

async function killProc(pid, name, btn) {
  if (!confirm('Hentikan proses "' + name + '" (PID ' + pid + ')?\n\nPastikan bukan proses sistem penting.')) return;
  btn.disabled = true;
  btn.textContent = '...';
  const r = await api('/api/processes/kill', {
    method: 'POST',
    body: JSON.stringify({ pid: parseInt(pid, 10), name: name }),
  });
  if (r.ok) {
    toast('"' + name + '" dihentikan', 'ok');
    btn.closest('tr').style.opacity = '0.4';
  } else {
    toast('Gagal kill: ' + (r.error || 'butuh admin'), 'err');
    btn.disabled = false;
    btn.textContent = 'Kill';
  }
  setTimeout(loadProcesses, 800);
}

/* ===== Clean ===== */
const JUNK = [
  { id: 'temp', name: 'File Temp', desc: 'Sisa instalasi & cache sementara', size: '842 MB' },
  { id: 'cache', name: 'Cache Browser', desc: 'Chrome, Edge, Firefox', size: '612 MB' },
  { id: 'recycle', name: 'Recycle Bin', desc: 'File yang dihapus', size: '318 MB' },
  { id: 'logs', name: 'Log Sistem', desc: 'Event viewer & error logs', size: '94 MB' },
  { id: 'dns', name: 'Cache DNS', desc: 'Resolver cache usang', size: '12 MB' },
  { id: 'thumbs', name: 'Thumbnail Cache', desc: 'Preview gambar usang', size: '76 MB' },
];

function renderCleanGrid() {
  const grid = document.getElementById('cleanGrid');
  grid.innerHTML = JUNK.map(function (j) {
    return '<div class="clean-card" data-cat="' + j.id + '">' +
      '<div class="clean-name">' + j.name + '</div>' +
      '<div class="clean-desc">' + j.desc + '</div>' +
      '<div class="clean-size">' + j.size + '</div>' +
      '<button class="clean-btn" data-cat="' + j.id + '">Bersihkan</button>' +
      '</div>';
  }).join('');
  grid.querySelectorAll('.clean-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { cleanOne(btn.dataset.cat, btn); });
  });
  renderCleanDone();
}

function renderCleanDone() {
  document.querySelectorAll('.clean-card').forEach(function (card) {
    const cat = card.dataset.cat;
    const btn = card.querySelector('.clean-btn');
    if (state.cleanedCats.has(cat)) {
      card.classList.add('cleaned');
      btn.textContent = 'Selesai';
      btn.classList.add('done');
      btn.disabled = true;
    }
  });
}

async function cleanOne(cat, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  const r = await api('/api/clean', {
    method: 'POST',
    body: JSON.stringify({ category: cat }),
  });
  if (r.ok) {
    state.cleanedCats.add(cat);
    toast(r.category + ' dibersihkan' + (r.freed > 0 ? ' (' + fmtBytes(r.freed) + ')' : ''), 'ok');
    renderCleanDone();
  } else {
    toast('Gagal: ' + (r.error || 'unknown'), 'err');
    btn.disabled = false;
    btn.textContent = 'Bersihkan';
  }
}

async function cleanAll() {
  if (!confirm('Bersihkan semua kategori junk? Aman, tidak menyentuh file user.')) return;
  for (let i = 0; i < JUNK.length; i++) {
    const j = JUNK[i];
    if (state.cleanedCats.has(j.id)) continue;
    const btn = document.querySelector('.clean-btn[data-cat="' + j.id + '"]');
    if (btn) await cleanOne(j.id, btn);
    await new Promise(function (r) { setTimeout(r, 150); });
  }
  toast('Semua junk dibersihkan', 'ok');
}

/* ===== Mode ===== */
const MODES = [
  { id: 'balanced', name: 'Seimbang', desc: 'Default Windows, hemat daya' },
  { id: 'performance', name: 'Performa Tinggi', desc: 'CPU tanpa throttle' },
  { id: 'game', name: 'Game Mode', desc: 'Pause update, GPU maksimal' },
  { id: 'saver', name: 'Hemat Baterai', desc: 'Underclock ringan' },
];

function renderModeGrid() {
  const grid = document.getElementById('modeGrid');
  grid.innerHTML = MODES.map(function (m) {
    return '<div class="mode-card ' + (m.id === state.currentMode ? 'active' : '') + '" data-mode="' + m.id + '">' +
      '<div class="mode-name">' + m.name + '</div>' +
      '<div class="mode-desc">' + m.desc + '</div>' +
      '</div>';
  }).join('');
  grid.querySelectorAll('.mode-card').forEach(function (card) {
    card.addEventListener('click', function () { setMode(card.dataset.mode); });
  });
}

function renderModeActive() {
  document.querySelectorAll('.mode-card').forEach(function (c) {
    c.classList.toggle('active', c.dataset.mode === state.currentMode);
  });
}

async function setMode(mode) {
  const r = await api('/api/mode', {
    method: 'POST',
    body: JSON.stringify({ mode: mode }),
  });
  if (r.ok) {
    state.currentMode = mode;
    renderModeActive();
    toast('Mode: ' + r.label, 'ok');
  } else {
    toast('Gagal ganti mode: ' + (r.error || 'butuh admin'), 'err');
  }
}

/* ===== Startup ===== */
async function loadStartup() {
  const body = document.getElementById('startupBody');
  body.innerHTML = '<tr><td colspan="4" class="empty">Memuat...</td></tr>';
  const r = await api('/api/startup');
  if (r.error || !r.items) {
    body.innerHTML = '<tr><td colspan="4" class="empty">Gagal memuat (butuh admin / bukan Windows).</td></tr>';
    return;
  }
  if (!r.items.length) {
    body.innerHTML = '<tr><td colspan="4" class="empty">Tidak ada startup items.</td></tr>';
    return;
  }
  body.innerHTML = r.items.slice(0, 30).map(function (it) {
    return '<tr>' +
      '<td class="proc-name">' + escapeHtml(it.name) + '</td>' +
      '<td class="mono" style="font-size:0.72rem">' + escapeHtml(it.location) + '</td>' +
      '<td>' + escapeHtml(it.user) + '</td>' +
      '<td class="mono" style="font-size:0.7rem;color:var(--muted);max-width:280px;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(it.command) + '</td>' +
      '</tr>';
  }).join('');
}

/* ===== System ===== */
async function loadSystem() {
  const s = await api('/api/system');
  const grid = document.getElementById('sysGrid');
  if (s.error || !s.os) {
    grid.innerHTML = '<p class="empty">Gagal memuat info sistem.</p>';
  } else {
    const items = [
      ['OS', s.os.name + ' ' + s.os.version + (s.os.build ? ' (build ' + s.os.build + ')' : '')],
      ['Hostname', s.os.hostname],
      ['Arch', s.os.arch + ' / ' + s.os.platform],
      ['Manufacturer', s.hardware.manufacturer],
      ['Model', s.hardware.model],
      ['CPU', s.hardware.cpuModel],
      ['Cores', s.hardware.cpuCores + ' cores @ ' + (s.hardware.cpuSpeed / 1000).toFixed(2) + ' GHz'],
      ['Total RAM', fmtBytes(s.hardware.totalMemory)],
      ['RAM Bebas', fmtBytes(s.hardware.freeMemory)],
      ['Uptime', fmtUptime(s.os.uptime)],
    ];
    grid.innerHTML = items.map(function (it) {
      return '<div class="sys-item"><div class="k">' + it[0] + '</div><div class="v">' + escapeHtml(String(it[1])) + '</div></div>';
    }).join('');
  }

  const d = await api('/api/drives');
  const dl = document.getElementById('drivesList');
  if (d.drives && d.drives.length) {
    dl.innerHTML = d.drives.map(function (dr) {
      const cls = dr.percent >= 85 ? 'bad' : dr.percent >= 65 ? 'warn' : '';
      return '<div class="drive-row">' +
        '<div class="drive-id">' + escapeHtml(dr.id) + '</div>' +
        '<div class="drive-bar"><div class="drive-bar-fill ' + cls + '" style="width:' + dr.percent + '%"></div></div>' +
        '<div class="drive-info">' + dr.freeGB + ' GB bebas / ' + dr.totalGB + ' GB</div>' +
        '</div>';
    }).join('');
  } else {
    dl.innerHTML = '<p class="empty">Tidak ada drive terdeteksi.</p>';
  }

  const b = await api('/api/battery');
  const bi = document.getElementById('batteryInfo');
  if (b.hasBattery) {
    bi.innerHTML = '<div class="bat">' + b.percent + '% / ' + escapeHtml(b.status) + (b.runtimeMin ? ' / ' + b.runtimeMin + ' menit' : '') + '</div>';
  } else {
    bi.innerHTML = '<p class="empty">Desktop (tidak ada baterai).</p>';
  }

  const n = await api('/api/network');
  const nl = document.getElementById('netList');
  if (n.interfaces && n.interfaces.length) {
    nl.innerHTML = '<div class="sys-grid">' + n.interfaces.map(function (i) {
      return '<div class="sys-item"><div class="k">' + escapeHtml(i.name) + '</div><div class="v mono">' + escapeHtml(i.address) + ' / ' + escapeHtml(i.mac) + '</div></div>';
    }).join('') + '</div>';
  } else {
    nl.innerHTML = '<p class="empty">Tidak ada interface.</p>';
  }
}

/* ===== Diagnostics ===== */
async function loadDiagnostics() {
  const grid = document.getElementById('diagGrid');
  grid.innerHTML = '<p class="empty">Memuat...</p>';
  const r = await api('/api/diagnostics');
  if (r.error || !r.checks) {
    grid.innerHTML = '<p class="empty">Gagal memuat diagnostik.</p>';
    return;
  }
  const items = [
    { key: 'shell', name: 'Shell Exec', detail: 'Kemampuan menjalankan command' },
    { key: 'admin', name: 'Admin Privilege', detail: 'Akses administrator untuk fitur penuh' },
    { key: 'tempDir', name: 'Temp Directory', detail: 'Folder temp bisa ditulis' },
  ];
  grid.innerHTML = items.map(function (it) {
    const c = r.checks[it.key] || { ok: false };
    const status = c.ok ? 'ok' : 'fail';
    let detail = it.detail;
    if (c.error) detail += ' / ' + c.error;
    if (c.note) detail = c.note;
    if (c.path) detail = c.path;
    if (c.uid != null) detail = 'uid=' + c.uid;
    return '<div class="diag-item">' +
      '<div class="diag-status ' + status + '"></div>' +
      '<div class="diag-content"><div class="diag-name">' + it.name + (c.ok ? ' / OK' : ' / GAGAL') + '</div>' +
      '<div class="diag-detail">' + escapeHtml(detail) + '</div></div>' +
      '</div>';
  }).join('');
  // platform info
  const platformInfo = '<div class="diag-item"><div class="diag-status ok"></div><div class="diag-content">' +
    '<div class="diag-name">Platform / Node</div>' +
    '<div class="diag-detail">' + escapeHtml(r.platform + ' / ' + r.arch + ' / node ' + r.node) + '</div></div></div>';
  grid.innerHTML = platformInfo + grid.innerHTML;
}

/* ===== History ===== */
async function loadHistory() {
  const r = await api('/api/history');
  const list = document.getElementById('historyList');
  if (r.error || !r.history || !r.history.length) {
    list.innerHTML = '<p class="empty">Belum ada aktivitas.</p>';
    return;
  }
  list.innerHTML = r.history.map(function (h) {
    return '<div class="history-item">' +
      '<span class="history-tag ' + h.type + '">' + h.type + '</span>' +
      '<div class="history-content">' +
      '<div class="history-action">' + escapeHtml(h.action) + (h.freed ? ' <span class="history-freed">+' + escapeHtml(h.freed) + '</span>' : '') + '</div>' +
      '<div class="history-detail">' + escapeHtml(h.detail) + '</div>' +
      '</div>' +
      '<div class="history-meta">' + fmtTime(h.at) + '</div>' +
      '</div>';
  }).join('');
}

/* ===== Reset ===== */
function showResetModal() { document.getElementById('resetModal').classList.add('show'); }
function hideResetModal() { document.getElementById('resetModal').classList.remove('show'); }
async function doReset() {
  hideResetModal();
  toast('Mereset ke default...');
  const r = await api('/api/reset', { method: 'POST' });
  if (r.ok) {
    toast(r.message || 'Reset selesai', 'ok');
    state.cleanedCats.clear();
    document.querySelectorAll('.clean-card').forEach(function (c) {
      c.classList.remove('cleaned');
      const btn = c.querySelector('.clean-btn');
      btn.classList.remove('done');
      btn.disabled = false;
      btn.textContent = 'Bersihkan';
    });
    pollState();
    pollMetrics();
    loadHistory();
  } else {
    toast('Reset gagal: ' + (r.error || 'unknown'), 'err');
  }
}

/* ===== Tabs ===== */
function initTabs() {
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
      tab.classList.add('active');
      const panel = document.getElementById('panel-' + tab.dataset.tab);
      panel.classList.add('active');
      if (tab.dataset.tab === 'processes') loadProcesses();
      else if (tab.dataset.tab === 'startup') loadStartup();
      else if (tab.dataset.tab === 'system') loadSystem();
      else if (tab.dataset.tab === 'diagnostics') loadDiagnostics();
      else if (tab.dataset.tab === 'history') loadHistory();
    });
  });
}

/* ===== Theme ===== */
function initTheme() {
  const btn = document.getElementById('themeToggle');
  const saved = localStorage.getItem('juicy-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  btn.innerHTML = saved === 'dark'
    ? '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
    : '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  btn.addEventListener('click', function () {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('juicy-theme', next);
    btn.innerHTML = next === 'dark'
      ? '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
      : '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  });
}

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', function () {
  initTheme();
  initTabs();
  renderCleanGrid();
  renderModeGrid();

  document.getElementById('boostBtn').addEventListener('click', doBoost);
  document.getElementById('cleanAllBtn').addEventListener('click', cleanAll);
  document.getElementById('refreshProc').addEventListener('click', loadProcesses);
  document.getElementById('refreshStartup').addEventListener('click', loadStartup);
  document.getElementById('refreshDiag').addEventListener('click', loadDiagnostics);
  document.getElementById('resetBtn').addEventListener('click', showResetModal);
  document.getElementById('resetCancel').addEventListener('click', hideResetModal);
  document.getElementById('resetConfirm').addEventListener('click', doReset);

  pollState();
  pollMetrics();
  setInterval(pollMetrics, 2000);
});
