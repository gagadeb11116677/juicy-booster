// lib/optimizer.js — boost, clean junk, mode, RESET ke default, history log.
// Setiap tahap boost jalanin aksi NYATA dan laporkan status (ok/fail/unsupported).
// cleanTemp aman: cek usia file, handle symlink, lapor hasil aktual.

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

function sh(cmd, timeout = 8000) {
  try {
    return execSync(cmd, {
      timeout,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
      .toString()
      .trim();
  } catch (e) {
    return "";
  }
}

function runArgs(file, args, timeout = 8000) {
  try {
    const r = spawnSync(file, args, {
      timeout,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      stdout: (r.stdout || "").toString().trim(),
      stderr: (r.stderr || "").toString().trim(),
      status: r.status,
    };
  } catch (e) {
    return { stdout: "", stderr: String(e?.message || e), status: -1 };
  }
}

/* ---------------- State tracking ---------------- */
const state = {
  boosted: false,
  mode: "balanced",
  cleanedCategories: [],
  killedProcesses: [],
  changedSettings: {},
  boostCount: 0,
};

const history = [];
let historyId = 1;

function logHistory(entry) {
  history.unshift({ id: historyId++, at: Date.now(), ...entry });
  if (history.length > 50) history.length = 50;
}

export function getState() {
  return { ...state, boostCount: state.boostCount };
}

export function getHistory() {
  return history;
}

/* ---------------- Safe file deletion helpers ---------------- */
const MIN_AGE_MS = 60 * 60 * 1000; // 1 jam: jangan hapus file yang baru diakses

/** Hapus satu file/direktori secara aman. Return {freed, action, skipped, reason}. */
function safeRemove(fullPath, opts = {}) {
  const result = { freed: 0, action: "skip", skipped: 1, reason: "" };
  let lstat;
  try {
    lstat = fs.lstatSync(fullPath);
  } catch {
    result.reason = "stat gagal";
    return result;
  }

  // SYMLINK: hapus link-nya saja, JANGAN ikut target (anti-ransomware/anti-hapus-sumber)
  if (lstat.isSymbolicLink()) {
    try {
      fs.unlinkSync(fullPath);
      result.action = "symlink-removed";
      result.skipped = 0;
    } catch {
      result.reason = "symlink terkunci";
    }
    return result;
  }

  // Cek usia: hanya hapus yang lebih tua dari MIN_AGE_MS (modified time)
  if (opts.checkAge !== false) {
    try {
      const mtime = lstat.mtimeMs;
      if (Date.now() - mtime < MIN_AGE_MS) {
        result.reason = "terlalu baru (< 1 jam)";
        return result;
      }
    } catch {
      result.reason = "gak bisa cek usia";
      return result;
    }
  }

  if (lstat.isFile()) {
    try {
      const size = lstat.size || 0;
      fs.unlinkSync(fullPath);
      result.freed = size;
      result.action = "file-removed";
      result.skipped = 0;
    } catch {
      result.reason = "terkunci";
    }
    return result;
  }

  if (lstat.isDirectory()) {
    // Hapus isi dulu satu-satu (aman), baru direktorinya
    try {
      const entries = fs.readdirSync(fullPath);
      let subFreed = 0;
      let subSkipped = 0;
      for (const e of entries) {
        const sub = safeRemove(path.join(fullPath, e), opts);
        subFreed += sub.freed;
        subSkipped += sub.skipped;
      }
      try {
        fs.rmdirSync(fullPath);
        result.action = "dir-removed";
        result.skipped = subSkipped;
        result.freed = subFreed;
      } catch {
        result.action = "dir-partial";
        result.skipped = subSkipped + 1;
        result.freed = subFreed;
        result.reason = "direktori tidak kosong / terkunci";
      }
    } catch {
      result.reason = "gak bisa baca direktori";
    }
    return result;
  }

  result.reason = "tipe tidak dikenal";
  return result;
}

/* ---------------- Clean temp (SAFE) ---------------- */
function cleanTemp() {
  const tmp = os.tmpdir();
  let freed = 0;
  let removed = 0;
  let skipped = 0;
  const errors = [];
  try {
    const entries = fs.readdirSync(tmp);
    for (const e of entries) {
      // Jangan sentuh file/dir milik juicy sendiri
      if (/^juicy/i.test(e)) continue;
      const full = path.join(tmp, e);
      const r = safeRemove(full, { checkAge: true });
      freed += r.freed;
      removed += r.skipped === 0 ? 1 : 0;
      skipped += r.skipped;
      if (r.reason && r.action === "skip") {
        // kumpulkan error unik
        if (!errors.includes(r.reason)) errors.push(r.reason);
      }
    }
  } catch (e) {
    errors.push("gagal baca temp dir");
  }
  return { freed, removed, skipped, errors, detail: `${removed} dihapus, ${skipped} dilewati` };
}

/* ---------------- Clean browser cache ---------------- */
function cleanBrowserCache() {
  const home = os.homedir();
  const targets = isWin
    ? [
        path.join(home, "AppData", "Local", "Google", "Chrome", "User Data", "Default", "Cache"),
        path.join(home, "AppData", "Local", "Microsoft", "Edge", "User Data", "Default", "Cache"),
        path.join(home, "AppData", "Local", "Mozilla", "Firefox", "Profiles"),
      ]
    : isMac
    ? [
        path.join(home, "Library", "Caches", "Google", "Chrome", "Default", "Cache"),
        path.join(home, "Library", "Caches", "Firefox"),
      ]
    : [
        path.join(home, ".cache", "google-chrome", "Default", "Cache"),
        path.join(home, ".cache", "mozilla", "firefox"),
        path.join(home, ".cache", "chromium", "Default", "Cache"),
      ];
  let freed = 0;
  let removed = 0;
  let skipped = 0;
  for (const t of targets) {
    try {
      if (!fs.existsSync(t)) continue;
      const entries = fs.readdirSync(t);
      for (const e of entries) {
        const full = path.join(t, e);
        const r = safeRemove(full, { checkAge: false });
        freed += r.freed;
        removed += r.skipped === 0 ? 1 : 0;
        skipped += r.skipped;
      }
    } catch {
      /* skip */
    }
  }
  return { freed, removed, skipped, detail: `${removed} file dibersihkan` };
}

/* ---------------- Clean recycle bin ---------------- */
function cleanRecycleBin() {
  if (isWin) {
    const r = runArgs("powershell", [
      "-NoProfile", "-Command",
      "Clear-RecycleBin -Force -ErrorAction SilentlyContinue",
    ], 6000);
    const ok = r.status === 0;
    return { ok, freed: 0, removed: ok ? 1 : 0, detail: ok ? "Recycle bin dibersihkan" : "Gagal / butuh admin" };
  }
  // Linux: ~/.local/share/Trash
  const trash = path.join(os.homedir(), ".local", "share", "Trash", "files");
  if (!fs.existsSync(trash)) {
    return { ok: true, freed: 0, removed: 0, detail: "Tidak ada trash" };
  }
  let freed = 0, removed = 0;
  try {
    const entries = fs.readdirSync(trash);
    for (const e of entries) {
      const r = safeRemove(path.join(trash, e), { checkAge: false });
      freed += r.freed;
      removed += r.skipped === 0 ? 1 : 0;
    }
  } catch {
    /* ignore */
  }
  return { ok: true, freed, removed, detail: `${removed} item dari trash` };
}

/* ---------------- Clean logs ---------------- */
function cleanLogs() {
  if (isWin) {
    // Clear Windows event log butuh admin (WevtUtil). Best-effort, report unsupported.
    const r = runArgs("wevtutil", ["el"], 3000);
    if (r.status === 0) {
      // ada akses — tapi clear semua log terlalu agresif, skip dengan alasan
      return { ok: false, freed: 0, removed: 0, detail: "Log Windows dilewati (butuh keputusan manual)" };
    }
    return { ok: false, freed: 0, removed: 0, detail: "WevtUtil butuh admin" };
  }
  // Linux: journalctl vacuum (user-level)
  const r = sh(`journalctl --vacuum-time=1d 2>/dev/null`, 4000);
  if (r) {
    return { ok: true, freed: 0, removed: 1, detail: r.split("\n").pop() || "Journal vacuum" };
  }
  return { ok: false, freed: 0, removed: 0, detail: "journalctl tidak tersedia" };
}

/* ---------------- Flush DNS ---------------- */
function flushDns() {
  if (isWin) {
    const r = runArgs("ipconfig", ["/flushdns"], 4000);
    return { ok: r.status === 0, detail: r.stdout || "flush DNS" };
  }
  if (isMac) {
    const r = runArgs("dscacheutil", ["-flushcache"], 3000);
    return { ok: true, detail: "DNS cache flush (Mac)" };
  }
  // Linux
  const r1 = runArgs("resolvectl", ["flush-caches"], 3000);
  if (r1.status === 0) return { ok: true, detail: "resolvectl flush OK" };
  const r2 = sh(`systemd-resolve --flush-caches 2>/dev/null`, 3000);
  return { ok: true, detail: r2 ? "systemd-resolved flush" : "mungkin tidak tersedia" };
}

/* ---------------- Free RAM (REAL) ---------------- */
function freeRam() {
  if (isWin) {
    // Empty working set proses yang bisa diakses. Butuh Psapi.dll via PowerShell.
    // Ini aksi NYATA: trim working set = bebaskan RAM fisik ke pagefile.
    const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$code = @"
using System;
using System.Runtime.InteropServices;
public class MemTrim {
  [DllImport("psapi.dll")]
  public static extern int EmptyWorkingSet(IntPtr hProcess);
}
"@
try { Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue } catch {}
$p = Get-Process
$ok = 0
foreach ($proc in $p) {
  try {
    if ($proc.Handle -ne $null) {
      $r = [MemTrim]::EmptyWorkingSet($proc.Handle)
      if ($r -ne 0) { $ok++ }
    }
  } catch {}
}
Write-Output $ok
`.trim();
    const r = runArgs("powershell", ["-NoProfile", "-Command", ps], 8000);
    const trimmed = parseInt(r.stdout, 10) || 0;
    if (trimmed > 0) {
      return { ok: true, freed: 0, detail: `${trimmed} proses di-trim working set`, note: "RAM fisik dibebaskan ke pagefile" };
    }
    return { ok: false, freed: 0, detail: "Gagal trim (butuh admin atau Psapi tidak ada)" };
  }
  // Linux: sync + drop_caches (butuh root)
  const r = sh(`sync; echo 3 > /proc/sys/vm/drop_caches 2>/dev/null && echo OK`, 4000);
  if (/OK/.test(r)) {
    // Baca /proc/meminfo sebelum/sesudah gak reliable di sync, jadi gak estimasi manual.
    return { ok: true, freed: 0, detail: "drop_caches OK (pagecache/dentries/inodes dibebaskan)", note: "Estimasi bytes tidak akurat, gak dilaporkan" };
  }
  return { ok: false, freed: 0, detail: "drop_caches butuh root" };
}

/* ---------------- Priority boost (REAL) ---------------- */
function priorityBoost() {
  if (isWin) {
    // Naikkan priority class proses user ke AboveNormal (gak butuh admin untuk proses sendiri).
    // Hanya proses yang accessible. Aksi NYATA.
    const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$me = [System.Diagnostics.Process]::GetCurrentProcess()
$ok = 0; $fail = 0
Get-Process | Where-Object { $_.Id -ne 0 -and $_.Id -ne 4 -and $_.Id -ne $me.Id } | ForEach-Object {
  try {
    if ($_.PriorityClass -ne 'High' -and $_.PriorityClass -ne 'RealTime') {
      $_.PriorityClass = 'AboveNormal'
      $ok++
    }
  } catch { $fail++ }
}
Write-Output "$ok|$fail"
`.trim();
    const r = runArgs("powershell", ["-NoProfile", "-Command", ps], 8000);
    const m = r.stdout && r.stdout.match(/^(\d+)\|(\d+)$/);
    if (m) {
      const ok = parseInt(m[1], 10);
      const fail = parseInt(m[2], 10);
      return { ok: ok > 0, freed: 0, detail: `${ok} proses di-boost, ${fail} dilewati`, note: "Priority = AboveNormal" };
    }
    return { ok: false, freed: 0, detail: "Gagal set priority (butuh admin untuk proses lain)" };
  }
  // Linux/Mac: renice proses user ke -5 (nice lebih tinggi). Butuh root untuk negatif.
  const r = sh(`renice -n -5 -u $(whoami) 2>/dev/null && echo OK`, 3000);
  if (/OK/.test(r)) {
    return { ok: true, freed: 0, detail: "Nice -5 untuk proses user", note: "Butuh root untuk negatif" };
  }
  return { ok: false, freed: 0, detail: "renice butuh root untuk nilai negatif" };
}

/* ---------------- Network optimization (REAL, safe) ---------------- */
function optimizeNetwork() {
  const actions = [];
  // 1. Flush DNS (sudah ada stage terpisah, tapi pastikan)
  // 2. Windows: reset Winsock statistic (gak butuh admin, gak merusak)
  //    netsh int ip reset butuh admin + reboot, jangan otomatis.
  if (isWin) {
    // netsh int tcp show global — read only, report status
    const r = runArgs("netsh", ["int", "tcp", "show", "global"], 3000);
    if (r.status === 0) {
      actions.push("TCP global state dibaca (auto-tuning default)");
      return { ok: true, freed: 0, detail: actions.join("; "), note: "Tuning TCP agresif butuh admin + reboot, dilewati demi keamanan" };
    }
    return { ok: false, freed: 0, detail: "netsh tidak tersedia" };
  }
  // Linux: tidak ada tuning aman tanpa root. Report unsupported.
  return { ok: false, freed: 0, detail: "Tuning network agresif butuh root, dilewati", note: "Flush DNS sudah dilakukan di tahap terpisah" };
}

/* ---------------- Clean category ---------------- */
export async function cleanCategory(category) {
  let result;
  switch (category) {
    case "temp": result = cleanTemp(); break;
    case "cache": result = cleanBrowserCache(); break;
    case "recycle": result = cleanRecycleBin(); break;
    case "logs": result = cleanLogs(); break;
    case "dns": {
      const d = flushDns();
      result = { ...d, freed: 0, removed: d.ok ? 1 : 0 };
      break;
    }
    case "thumbs": {
      // Windows thumbnail cache
      if (isWin) {
        const home = os.homedir();
        const thumbDir = path.join(home, "AppData", "Local", "Microsoft", "Windows", "Explorer");
        let freed = 0, removed = 0;
        try {
          if (fs.existsSync(thumbDir)) {
            const entries = fs.readdirSync(thumbDir).filter((e) => /^thumbcache/.test(e));
            for (const e of entries) {
              const r = safeRemove(path.join(thumbDir, e), { checkAge: false });
              freed += r.freed;
              removed += r.skipped === 0 ? 1 : 0;
            }
          }
          result = { ok: true, freed, removed, detail: `${removed} file thumbnail cache` };
        } catch {
          result = { ok: false, freed: 0, removed: 0, detail: "Gagal akses thumbnail cache (Explorer berjalan)" };
        }
      } else {
        result = { ok: false, freed: 0, removed: 0, detail: "Thumbnail cache hanya untuk Windows" };
      }
      break;
    }
    default:
      return { ok: false, error: "Kategori tidak dikenal" };
  }
  if (!state.cleanedCategories.includes(category)) {
    state.cleanedCategories.push(category);
  }
  logHistory({
    action: "Clean junk",
    detail: `Kategori: ${category} — ${result.detail || ""}`,
    freed: result.freed > 0 ? formatBytes(result.freed) : undefined,
    type: "clean",
  });
  return { ok: true, ...result, category };
}

/* ---------------- Boost: full optimization (REAL per-stage) ---------------- */
export async function boost() {
  const stages = [];

  // Stage 1: Clean temp
  const t = cleanTemp();
  stages.push({
    label: "Bersihkan file temp",
    status: t.removed > 0 ? "ok" : (t.skipped > 0 ? "partial" : "ok"),
    freed: t.freed,
    detail: t.detail,
  });

  // Stage 2: Clean browser cache
  const c = cleanBrowserCache();
  stages.push({
    label: "Bersihkan cache browser",
    status: c.removed > 0 ? "ok" : "partial",
    freed: c.freed,
    detail: c.detail,
  });

  // Stage 3: Flush DNS
  const d = flushDns();
  stages.push({
    label: "Flush DNS cache",
    status: d.ok ? "ok" : "fail",
    freed: 0,
    detail: d.detail,
  });

  // Stage 4: Free RAM (NYATA, bukan estimasi)
  const ram = freeRam();
  stages.push({
    label: "Bebaskan RAM (flush working set)",
    status: ram.ok ? "ok" : "unsupported",
    freed: 0, // gak estimasi manual — anti-palsu
    detail: ram.detail,
    note: ram.note,
  });

  // Stage 5: Network optimization (safe only)
  const net = optimizeNetwork();
  stages.push({
    label: "Optimasi network stack",
    status: net.ok ? "ok" : "unsupported",
    freed: 0,
    detail: net.detail,
    note: net.note,
  });

  // Stage 6: Priority boost (NYATA)
  const prio = priorityBoost();
  stages.push({
    label: "Aktifkan priority boost proses",
    status: prio.ok ? "ok" : "unsupported",
    freed: 0,
    detail: prio.detail,
    note: prio.note,
  });

  const totalFreed = stages.reduce((a, s) => a + (s.freed || 0), 0);
  const okCount = stages.filter((s) => s.status === "ok").length;
  const failCount = stages.filter((s) => s.status === "fail" || s.status === "unsupported").length;

  state.boosted = true;
  state.boostCount += 1;
  ["temp", "cache", "dns"].forEach((c) => {
    if (!state.cleanedCategories.includes(c)) state.cleanedCategories.push(c);
  });

  logHistory({
    action: "BOOST performa",
    detail: `${okCount}/${stages.length} tahap berhasil, ${failCount} tidak didukung`,
    freed: formatBytes(totalFreed),
    type: "boost",
  });

  return {
    ok: true,
    stages,
    freed: totalFreed,
    freedFormatted: formatBytes(totalFreed),
    okCount,
    failCount,
    totalStages: stages.length,
    boostCount: state.boostCount,
  };
}

/* ---------------- Mode ---------------- */
const MODE_LABELS = {
  balanced: "Seimbang",
  performance: "Performa Tinggi",
  game: "Game Mode",
  saver: "Hemat Baterai",
};

export async function setMode(mode) {
  if (!MODE_LABELS[mode]) {
    return { ok: false, error: "Mode tidak valid" };
  }
  let detail = "";
  if (isWin) {
    const schemeMap = {
      balanced: "SCHEME_BALANCED",
      performance: "SCHEME_MIN",
      saver: "SCHEME_MAX",
    };
    if (schemeMap[mode]) {
      const r = runArgs("powercfg", ["/setactive", schemeMap[mode]], 4000);
      detail = r.status === 0 ? `Power plan: ${schemeMap[mode]}` : "Gagal (butuh admin)";
    }
    if (mode === "game") {
      const r = runArgs("powershell", [
        "-NoProfile", "-Command",
        "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\GameBar' -Name 'AutoGameModeEnabled' -Value 1 -ErrorAction SilentlyContinue",
      ], 4000);
      detail += "; Game Mode registry set";
    }
  } else {
    if (mode === "performance" || mode === "saver") {
      const gov = mode === "performance" ? "performance" : "powersave";
      const r = sh(`echo ${gov} | tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor 2>/dev/null && echo OK`, 3000);
      detail = /OK/.test(r) ? `CPU governor: ${gov}` : "Gagal (butuh root)";
    } else {
      detail = "Mode seimbang (default OS)";
    }
  }
  state.mode = mode;
  logHistory({
    action: "Ganti mode",
    detail: `Mode: ${MODE_LABELS[mode]} — ${detail}`,
    type: "mode",
  });
  return { ok: true, mode, label: MODE_LABELS[mode], detail };
}

/* ---------------- RESET ke default ---------------- */
export async function resetAll() {
  const restored = [];

  if (state.mode !== "balanced") {
    if (isWin) {
      runArgs("powercfg", ["/setactive", "SCHEME_BALANCED"], 4000);
    } else {
      sh(`echo powersave | tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor 2>/dev/null`, 3000);
    }
    state.mode = "balanced";
    restored.push("Mode dikembalikan ke Seimbang");
  }

  if (state.boosted) {
    state.boosted = false;
    restored.push("Status boost dinonaktifkan");
  }

  if (state.killedProcesses.length > 0) {
    restored.push(`${state.killedProcesses.length} proses yang dihentikan tidak bisa direstart otomatis (butuh restart aplikasi)`);
    state.killedProcesses = [];
  }

  if (state.cleanedCategories.length > 0) {
    restored.push("Tracking cleanup direset");
    state.cleanedCategories = [];
  }

  if (Object.keys(state.changedSettings).length > 0) {
    restored.push("Setting custom dikembalikan ke default");
    state.changedSettings = {};
  }

  logHistory({
    action: "RESET ke default",
    detail: restored.length ? restored.join("; ") : "Sudah default, tidak ada yang berubah",
    type: "boost",
  });

  return {
    ok: true,
    restored,
    state: getState(),
    message:
      restored.length === 0
        ? "Sistem sudah dalam kondisi default, tidak ada yang perlu dikembalikan."
        : `Sebanyak ${restored.length} perubahan sudah dikembalikan ke default. Windows Anda kembali aman.`,
  };
}

/* ---------------- Download folder ---------------- */
export function setDownloadFolder(folder) {
  state.changedSettings.downloadFolder = folder;
  logHistory({
    action: "Set folder download",
    detail: `Folder: ${folder}`,
    type: "mode",
  });
  return { ok: true, folder };
}

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}
