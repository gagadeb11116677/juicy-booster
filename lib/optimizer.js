import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { IS_WIN } from "./config.js";

function run(file, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ stdout: (stdout || "").trim(), stderr: (stderr || "").trim(), status: err ? -1 : 0 });
    });
  });
}

const MIN_AGE_MS = 60 * 60 * 1000;
const state = {
  boosted: false,
  mode: "balanced",
  cleanedCategories: [],
  killedProcesses: [],
  boostCount: 0,
};

export function getState() { return { ...state }; }
export function setState(s) { Object.assign(state, s); }

function safeRemove(fullPath, opts = {}) {
  const result = { freed: 0, action: "skip", skipped: 1, reason: "" };
  let lstat;
  try { lstat = fs.lstatSync(fullPath); } catch { result.reason = "stat gagal"; return result; }
  if (lstat.isSymbolicLink()) {
    try { fs.unlinkSync(fullPath); result.action = "symlink-removed"; result.skipped = 0; } catch { result.reason = "terkunci"; }
    return result;
  }
  if (opts.checkAge !== false) {
    try {
      if (Date.now() - lstat.mtimeMs < MIN_AGE_MS) { result.reason = "terlalu baru"; return result; }
    } catch { result.reason = "gak bisa cek usia"; return result; }
  }
  if (lstat.isFile()) {
    try {
      const size = lstat.size || 0;
      fs.unlinkSync(fullPath);
      result.freed = size; result.action = "file-removed"; result.skipped = 0;
    } catch { result.reason = "terkunci"; }
    return result;
  }
  if (lstat.isDirectory()) {
    try {
      const entries = fs.readdirSync(fullPath);
      let subFreed = 0, subSkipped = 0;
      for (const e of entries) {
        const sub = safeRemove(path.join(fullPath, e), opts);
        subFreed += sub.freed; subSkipped += sub.skipped;
      }
      try {
        fs.rmdirSync(fullPath);
        result.action = "dir-removed"; result.skipped = subSkipped; result.freed = subFreed;
      } catch {
        result.action = "dir-partial"; result.skipped = subSkipped + 1; result.freed = subFreed; result.reason = "tidak kosong";
      }
    } catch { result.reason = "gak bisa baca"; }
    return result;
  }
  result.reason = "tipe tidak dikenal";
  return result;
}

function dirSize(dir, opts = {}) {
  let total = 0, count = 0;
  try {
    const entries = fs.readdirSync(dir);
    for (const e of entries) {
      const full = path.join(dir, e);
      let lstat;
      try { lstat = fs.lstatSync(full); } catch { continue; }
      if (lstat.isSymbolicLink()) continue;
      if (lstat.isFile()) { total += lstat.size || 0; count++; }
      else if (lstat.isDirectory()) {
        const sub = dirSize(full, opts);
        total += sub.total; count += sub.count;
      }
    }
  } catch {}
  return { total, count };
}

function getJunkTargets() {
  const home = os.homedir();
  const local = IS_WIN ? (process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")) : home;
  const targets = [];
  targets.push({ id: "temp-user", label: "Temp pengguna", path: os.tmpdir(), safe: true });
  if (IS_WIN) {
    targets.push({ id: "cache-chrome", label: "Cache Chrome", path: path.join(local, "Google", "Chrome", "User Data"), safe: true, glob: ["Default", "Profile *"] });
    targets.push({ id: "cache-edge", label: "Cache Edge", path: path.join(local, "Microsoft", "Edge", "User Data"), safe: true, glob: ["Default", "Profile *"] });
    targets.push({ id: "thumbs", label: "Thumbnail cache", path: path.join(local, "Microsoft", "Windows", "Explorer"), safe: true, filter: /^thumbcache/ });
    targets.push({ id: "d3d", label: "Shader cache DirectX", path: path.join(local, "D3DSCache"), safe: true });
    targets.push({ id: "crash", label: "Crash dump", path: path.join(local, "CrashDumps"), safe: true });
  }
  targets.push({ id: "recycle", label: "Recycle Bin", path: "__recyclebin__", safe: true });
  return targets;
}

export async function scanJunk() {
  const targets = getJunkTargets();
  const results = [];
  for (const t of targets) {
    let size = 0, count = 0;
    if (t.path === "__recyclebin__") {
      results.push({ ...t, sizeBytes: 0, count: 0, note: "Dihitung saat pembersihan" });
      continue;
    }
    try {
      if (t.glob) {
        if (fs.existsSync(t.path)) {
          const profiles = fs.readdirSync(t.path).filter((n) => {
            return t.glob.some((g) => g.endsWith("*") ? n.startsWith(g.slice(0, -1)) : n === g);
          });
          for (const prof of profiles) {
            for (const cacheDir of ["Cache", "Code Cache", "GPUCache"]) {
              const p = path.join(t.path, prof, cacheDir);
              if (fs.existsSync(p) && !p.includes("JuicyBooster")) {
                const s = dirSize(p);
                size += s.total; count += s.count;
              }
            }
          }
        }
      } else if (t.filter) {
        if (fs.existsSync(t.path)) {
          const files = fs.readdirSync(t.path).filter((n) => t.filter.test(n));
          for (const f of files) {
            try {
              const stat = fs.lstatSync(path.join(t.path, f));
              if (stat.isFile()) { size += stat.size || 0; count++; }
            } catch {}
          }
        }
      } else {
        if (fs.existsSync(t.path) && !t.path.includes("JuicyBooster")) {
          const s = dirSize(t.path);
          size = s.total; count = s.count;
        }
      }
    } catch {}
    results.push({ ...t, sizeBytes: size, count });
  }
  return { categories: results, totalBytes: results.reduce((a, r) => a + r.sizeBytes, 0) };
}

export async function cleanCategory(categoryIds) {
  const scan = await scanJunk();
  const selected = scan.categories.filter((c) => categoryIds.includes(c.id));
  let freedBytes = 0, removed = 0, skipped = 0;
  const details = [];
  for (const cat of selected) {
    if (cat.id === "recycle") {
      if (IS_WIN) {
        const r = await run("powershell", ["-NoProfile", "-Command", "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"], 6000);
        details.push({ id: cat.id, ok: r.status === 0, detail: r.status === 0 ? "Recycle bin dibersihkan" : "Gagal" });
      } else {
        details.push({ id: cat.id, ok: false, detail: "Hanya Windows" });
      }
      continue;
    }
    if (!fs.existsSync(cat.path)) {
      details.push({ id: cat.id, ok: false, detail: "Tidak ada" });
      continue;
    }
    let catFreed = 0, catRemoved = 0, catSkipped = 0;
    try {
      if (cat.glob) {
        const profiles = fs.readdirSync(cat.path).filter((n) => {
          return cat.glob.some((g) => g.endsWith("*") ? n.startsWith(g.slice(0, -1)) : n === g);
        });
        for (const prof of profiles) {
          for (const cacheDir of ["Cache", "Code Cache", "GPUCache"]) {
            const p = path.join(cat.path, prof, cacheDir);
            if (fs.existsSync(p) && !p.includes("JuicyBooster")) {
              const entries = fs.readdirSync(p);
              for (const e of entries) {
                const r = safeRemove(path.join(p, e), { checkAge: false });
                catFreed += r.freed; catRemoved += r.skipped === 0 ? 1 : 0; catSkipped += r.skipped;
              }
            }
          }
        }
      } else if (cat.filter) {
        const files = fs.readdirSync(cat.path).filter((n) => cat.filter.test(n));
        for (const f of files) {
          const r = safeRemove(path.join(cat.path, f), { checkAge: false });
          catFreed += r.freed; catRemoved += r.skipped === 0 ? 1 : 0; catSkipped += r.skipped;
        }
      } else {
        const entries = fs.readdirSync(cat.path);
        for (const e of entries) {
          if (/^juicy/i.test(e)) continue;
          const r = safeRemove(path.join(cat.path, e), { checkAge: cat.id === "temp-user" });
          catFreed += r.freed; catRemoved += r.skipped === 0 ? 1 : 0; catSkipped += r.skipped;
        }
      }
      freedBytes += catFreed; removed += catRemoved; skipped += catSkipped;
      details.push({ id: cat.id, ok: true, freed: catFreed, removed: catRemoved, skipped: catSkipped, detail: `${catRemoved} dihapus, ${catSkipped} dilewati` });
    } catch (e) {
      details.push({ id: cat.id, ok: false, detail: "Gagal: " + (e?.message || "") });
    }
    if (!state.cleanedCategories.includes(cat.id)) state.cleanedCategories.push(cat.id);
  }
  return {
    ok: true,
    freedBytes,
    removed,
    skipped,
    details,
    detail: `${removed} file dihapus, ${skipped} dilewati`,
  };
}

export async function boost() {
  const scan = await scanJunk();
  const cleanable = scan.categories.filter((c) => c.sizeBytes > 0 || c.id === "recycle").map((c) => c.id);
  const clean = await cleanCategory(cleanable);
  let dnsOk = false;
  if (IS_WIN) {
    const r = await run("ipconfig", ["/flushdns"], 4000);
    dnsOk = r.status === 0;
  }
  state.boosted = true;
  state.boostCount += 1;
  const stages = [
    { label: "Bersihkan sampah", status: clean.removed > 0 ? "ok" : "partial", detail: clean.detail },
    { label: "Flush DNS", status: dnsOk ? "ok" : "unsupported", detail: dnsOk ? "OK" : "Gagal" },
  ];
  return {
    ok: true,
    stages,
    freedBytes: clean.freedBytes,
    detail: `Boost: ${clean.removed} file dibersihkan, ${dnsOk ? "DNS di-flush" : "DNS gagal"}`,
    boostCount: state.boostCount,
  };
}

const MODE_LABELS = { balanced: "Seimbang", performance: "Performa Tinggi", game: "Game Mode", saver: "Hemat Baterai" };

export async function setMode(mode) {
  if (!MODE_LABELS[mode]) return { ok: false, error: "Mode tidak valid" };
  let detail = "";
  if (IS_WIN) {
    const schemeMap = { balanced: "SCHEME_BALANCED", performance: "SCHEME_MIN", saver: "SCHEME_MAX" };
    if (schemeMap[mode]) {
      const r = await run("powercfg", ["/setactive", schemeMap[mode]], 4000);
      detail = r.status === 0 ? `Power plan: ${schemeMap[mode]}` : "Gagal (butuh admin)";
    }
    if (mode === "game") {
      await run("powershell", ["-NoProfile", "-Command", "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\GameBar' -Name 'AutoGameModeEnabled' -Value 1 -ErrorAction SilentlyContinue"], 4000);
      detail += "; Game Mode aktif";
    }
  } else {
    detail = "Mode seimbang (default OS)";
  }
  state.mode = mode;
  return { ok: true, mode, label: MODE_LABELS[mode], detail };
}

export async function resetAll() {
  const restored = [];
  if (state.mode !== "balanced") {
    if (IS_WIN) await run("powercfg", ["/setactive", "SCHEME_BALANCED"], 4000);
    state.mode = "balanced";
    restored.push("Mode dikembalikan ke Seimbang");
  }
  if (state.boosted) { state.boosted = false; restored.push("Status boost dinonaktifkan"); }
  if (state.cleanedCategories.length > 0) { restored.push("Tracking cleanup direset"); state.cleanedCategories = []; }
  return {
    ok: true,
    restored,
    message: restored.length === 0 ? "Sistem sudah default." : `${restored.length} perubahan dikembalikan.`,
  };
}

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}
