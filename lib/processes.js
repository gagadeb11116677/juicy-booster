// lib/processes.js — list & kill proses (background), OS-aware.
// Security: PID divalidasi sebagai integer positif. Kill via API/safe args,
// BUKAN rangkaian string ke shell. Daftar proses dilindungi diperkuat.

import os from "node:os";
import fs from "node:fs";
import { execSync, spawnSync } from "node:child_process";

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

function sh(cmd, timeout = 5000) {
  try {
    return execSync(cmd, {
      timeout,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

/** Jalankan command dengan array arg (aman dari injection). */
function runArgs(file, args, timeout = 6000) {
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

/** List top background processes sorted by CPU then memory. */
export async function listProcesses() {
  if (isWin) return listWindows();
  if (isMac) return listMac();
  return listLinux();
}

function listLinux() {
  const out = sh(
    `ps -eo pid,pcpu,pmem,rss,comm --sort=-pcpu 2>/dev/null | head -n 30`,
    4000
  );
  if (!out) return [];
  const lines = out.split("\n").slice(1);
  const procs = [];
  for (const line of lines) {
    const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    procs.push({
      pid: parseInt(m[1], 10),
      name: m[5].trim(),
      cpu: Math.round(parseFloat(m[2]) * 10) / 10,
      memMB: Math.round((parseInt(m[4], 10) / 1024) * 10) / 10,
      memPct: Math.round(parseFloat(m[3]) * 10) / 10,
      user: "",
      command: m[5].trim(),
    });
  }
  return procs;
}

function listMac() {
  const out = sh(`ps -Ao pid,pcpu,pmem,rss,comm -r | head -n 30`, 4000);
  if (!out) return [];
  const lines = out.split("\n").slice(1);
  const procs = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    procs.push({
      pid: parseInt(parts[0], 10),
      name: parts.slice(4).join(" "),
      cpu: Math.round(parseFloat(parts[1]) * 10) / 10,
      memMB: Math.round((parseInt(parts[3], 10) / 1024) * 10) / 10,
      memPct: Math.round(parseFloat(parts[2]) * 10) / 10,
      user: "",
      command: parts.slice(4).join(" "),
    });
  }
  return procs;
}

function listWindows() {
  const out = sh(
    `powershell -NoProfile -Command "Get-Process | Sort-Object CPU -Descending | Select-Object -First 30 Id,ProcessName,CPU,@{N='MemMB';E={[math]::Round($_.WorkingSet64/1MB,1)}},Path | ConvertTo-Csv -NoTypeInformation"`,
    6000
  );
  if (!out) return [];
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean).slice(1);
  const procs = [];
  for (const row of lines) {
    const cells = row.match(/"[^"]*"/g);
    if (!cells || cells.length < 4) continue;
    const clean = cells.map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"'));
    procs.push({
      pid: parseInt(clean[0], 10) || 0,
      name: clean[1] || "unknown",
      cpu: Math.round((parseFloat(clean[2]) || 0) * 10) / 10,
      memMB: parseFloat(clean[3]) || 0,
      memPct: 0,
      user: "",
      command: clean[4] || clean[1] || "",
    });
  }
  return procs;
}

/* ---------------- Protected processes ---------------- */
// PID kritis yang gak boleh di-kill (Windows).
const PROTECTED_PIDS_WIN = new Set([0, 4]); // System Idle Process, System

// Nama proses kritis (exact match, case-insensitive). Dipertegas: full word match.
const PROTECTED_NAMES = new Set([
  // Windows core
  "system",
  "systemidleprocess",
  "registry",
  "smss",
  "csrss",
  "wininit",
  "services",
  "lsass",
  "svchost",
  "winlogon",
  "dwm",
  "fontdrvhost",
  "explorer",
  "sihost",
  "taskhostw",
  "ctfmon",
  "conhost",
  // Windows security / defender
  "msmpeng",
  "msmpengexe",
  "securityhealthservice",
  "securityhealthsystray",
  "spoolsv",
  // Linux core
  "systemd",
  "systemd-journal",
  "systemd-logind",
  "systemd-udevd",
  "init",
  "kernel",
  "kthreadd",
  "dbus",
  "dbus-daemon",
  "getty",
  "agetty",
  "login",
  "sshd",
  // Mac core
  "launchd",
  "windowserver",
  "loginwindow",
  "Finder",
  "Dock",
]);

function isProtected(pid, name) {
  if (isWin && PROTECTED_PIDS_WIN.has(pid)) return true;
  // PID rendah di Unix = kernel threads, jangan sentuh
  if (!isWin && !isMac && pid < 10) return true;
  if (isMac && pid === 1) return true; // launchd
  if (isWin && pid === 1) return true;
  const n = (name || "").toLowerCase().replace(/\.(exe|dll)$/, "");
  return PROTECTED_NAMES.has(n);
}

/** Validasi PID: harus integer positif, masuk akal (1 - 99999999). */
function validatePid(pid) {
  if (typeof pid !== "number" && typeof pid !== "string") return null;
  const s = String(pid).trim();
  if (!/^\d{1,8}$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 99999999) return null;
  return n;
}

/** Cari nama proses dari PID (buat cek protected sebelum kill). */
function getProcessName(pid) {
  if (isWin) {
    const r = runArgs("powershell", [
      "-NoProfile", "-Command",
      `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName`,
    ], 3000);
    return r.stdout || "";
  }
  if (isMac) {
    const r = runArgs("ps", ["-p", String(pid), "-o", "comm="], 2000);
    return r.stdout || "";
  }
  // Linux: baca /proc/<pid>/comm (gak butuh shell sama sekali)
  try {
    return fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
  } catch {
    return "";
  }
}

/** Kill process by PID. Hanya PID yang divalidasi, gak ada name-based kill. */
export async function killProcess({ pid, name } = {}) {
  // Hanya terima PID. name diabaikan (gak aman untuk kill by name).
  const validPid = validatePid(pid);
  if (!validPid) {
    return {
      ok: false,
      error: "PID tidak valid. Harus integer positif.",
    };
  }

  // Ambil nama proses untuk cek protected (lebih akurat dari input user)
  const procName = getProcessName(validPid);
  if (isProtected(validPid, procName)) {
    return {
      ok: false,
      error: `Proses ${procName || "#" + validPid} dilindungi sistem, tidak boleh dihentikan.`,
      protected: true,
    };
  }

  // Kill via API aman (arg array, bukan string concat ke shell)
  if (isWin) {
    // taskkill dengan arg array
    const r = runArgs("taskkill", ["/PID", String(validPid), "/F", "/T"], 5000);
    const ok = r.status === 0;
    return {
      ok,
      pid: validPid,
      name: procName,
      detail: ok ? "Dihentikan" : (r.stderr || "Gagal menghentikan (butuh admin?)"),
    };
  }

  // Linux/Mac: coba SIGTERM dulu (graceful), lalu SIGKILL
  try {
    process.kill(validPid, "SIGTERM");
  } catch (e) {
    const msg = String(e?.message || e);
    if (/ESRCH/.test(msg)) {
      return { ok: false, pid: validPid, error: "Proses tidak ditemukan." };
    }
    if (/EPERM/.test(msg)) {
      return { ok: false, pid: validPid, error: "Tidak ada izin (butuh admin/sudo)." };
    }
    return { ok: false, pid: validPid, error: msg };
  }

  // Tunggu sebentar, cek apakah masih hidup
  await new Promise((r) => setTimeout(r, 300));
  let stillAlive = false;
  try {
    process.kill(validPid, 0); // signal 0 = cek keberadaan
    stillAlive = true;
  } catch {
    stillAlive = false;
  }

  if (stillAlive) {
    // Paksa SIGKILL
    try {
      process.kill(validPid, "SIGKILL");
    } catch (e) {
      return {
        ok: false,
        pid: validPid,
        error: "Gagal SIGKILL: " + String(e?.message || e),
      };
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return {
    ok: true,
    pid: validPid,
    name: procName,
    detail: "Dihentikan (SIGTERM" + (stillAlive ? " + SIGKILL" : "") + ")",
  };
}
