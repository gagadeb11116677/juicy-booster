import os from "node:os";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { IS_WIN } from "./config.js";

const isMac = process.platform === "darwin";

function run(file, args, timeout = 6000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? "" : (stdout || "").trim());
    });
  });
}

const PROTECTED_PIDS_WIN = new Set([0, 4]);
const PROTECTED_NAMES = new Set([
  "system", "systemidleprocess", "registry", "smss", "csrss", "wininit", "services", "lsass",
  "svchost", "winlogon", "dwm", "fontdrvhost", "explorer", "sihost", "taskhostw", "ctfmon",
  "conhost", "msmpeng", "msmpengexe", "securityhealthservice", "securityhealthsystray", "spoolsv",
  "systemd", "systemd-journal", "systemd-logind", "systemd-udevd", "init", "kernel", "kthreadd",
  "dbus", "dbus-daemon", "getty", "agetty", "login", "sshd", "launchd", "windowserver",
  "loginwindow", "Finder", "Dock",
]);

function normalizeName(n) {
  return (n || "").toLowerCase().replace(/\.(exe|dll)$/, "");
}

function isProtected(pid, name) {
  if (IS_WIN && PROTECTED_PIDS_WIN.has(pid)) return true;
  if (!IS_WIN && !isMac && pid < 10) return true;
  if ((isMac || IS_WIN) && pid === 1) return true;
  return PROTECTED_NAMES.has(normalizeName(name));
}

export function validatePid(pid) {
  if (typeof pid !== "number" && typeof pid !== "string") return null;
  const s = String(pid).trim();
  if (!/^\d{1,8}$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 99999999) return null;
  return n;
}

export { isProtected };

let prevProcs = null;
let prevTime = null;

async function listWindows() {
  const out = await run("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process | Select-Object Id,ProcessName,Path,@{N='CPU';E={$_.TotalProcessorTime.TotalMilliseconds}},@{N='MemMB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json -Compress"], 8000);
  if (!out) return [];
  let arr;
  try {
    const j = JSON.parse(out);
    arr = Array.isArray(j) ? j : [j];
  } catch {
    return [];
  }
  const now = Date.now();
  const cores = os.cpus().length || 1;
  const result = arr.map((p) => ({
    pid: p.Id || 0,
    name: p.ProcessName || "unknown",
    path: p.Path || "",
    cpuMs: p.CPU || 0,
    memMB: p.MemMB || 0,
  })).filter((p) => p.pid > 0);

  let cpuPctMap = {};
  if (prevProcs && prevTime) {
    const dt = (now - prevTime) / 1000;
    for (const p of result) {
      const prev = prevProcs.get(p.pid);
      if (prev) {
        const dCpu = p.cpuMs - prev.cpuMs;
        if (dt > 0 && dCpu >= 0) {
          cpuPctMap[p.pid] = Math.min(100, (dCpu / (dt * 1000 * cores)) * 100);
        }
      }
    }
  }
  prevProcs = new Map(result.map((p) => [p.pid, { cpuMs: p.cpuMs }]));
  prevTime = now;

  return result
    .map((p) => ({
      pid: p.pid,
      name: p.name,
      path: p.path,
      cpu: Math.round((cpuPctMap[p.pid] || 0) * 10) / 10,
      memMB: p.memMB,
      memPct: 0,
      protected: isProtected(p.pid, p.name),
    }))
    .sort((a, b) => b.cpu - a.cpu || b.memMB - a.memMB)
    .slice(0, 50);
}

async function listLinux() {
  const out = await run("ps", ["-eo", "pid,pcpu,pmem,rss,comm", "--sort=-pcpu"], 4000);
  if (!out) return [];
  return out.split("\n").slice(1).map((line) => {
    const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!m) return null;
    const pid = parseInt(m[1], 10);
    const name = m[5].trim();
    return {
      pid,
      name,
      path: "",
      cpu: Math.round(parseFloat(m[2]) * 10) / 10,
      memMB: Math.round((parseInt(m[4], 10) / 1024) * 10) / 10,
      memPct: Math.round(parseFloat(m[3]) * 10) / 10,
      protected: isProtected(pid, name),
    };
  }).filter(Boolean).slice(0, 50);
}

async function listMac() {
  const out = await run("ps", ["-Ao", "pid,pcpu,pmem,rss,comm", "-r"], 4000);
  if (!out) return [];
  return out.split("\n").slice(1).map((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) return null;
    const pid = parseInt(parts[0], 10);
    const name = parts.slice(4).join(" ");
    return {
      pid,
      name,
      path: "",
      cpu: Math.round(parseFloat(parts[1]) * 10) / 10,
      memMB: Math.round((parseInt(parts[3], 10) / 1024) * 10) / 10,
      memPct: Math.round(parseFloat(parts[2]) * 10) / 10,
      protected: isProtected(pid, name),
    };
  }).filter(Boolean).slice(0, 50);
}

export async function listProcesses() {
  if (IS_WIN) return listWindows();
  if (isMac) return listMac();
  return listLinux();
}

function getProcessNameByPid(pid) {
  if (IS_WIN) return null;
  if (isMac) return null;
  try {
    return fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
  } catch {
    return "";
  }
}

export async function killProcess({ pid } = {}) {
  const validPid = validatePid(pid);
  if (!validPid) {
    return { ok: false, error: "PID tidak valid. Harus integer positif." };
  }
  const procName = getProcessNameByPid(validPid) || "";
  if (isProtected(validPid, procName)) {
    return { ok: false, error: `Proses ${procName || "#" + validPid} dilindungi sistem, tidak boleh dihentikan.`, protected: true };
  }
  if (IS_WIN) {
    return new Promise((resolve) => {
      execFile("taskkill", ["/PID", String(validPid), "/F", "/T"], { timeout: 5000, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, pid: validPid, error: "Gagal menghentikan (butuh admin?)" });
        } else {
          resolve({ ok: true, pid: validPid, name: procName, detail: "Dihentikan" });
        }
      });
    });
  }
  try {
    process.kill(validPid, "SIGTERM");
  } catch (e) {
    const msg = String(e?.message || e);
    if (/ESRCH/.test(msg)) return { ok: false, pid: validPid, error: "Proses tidak ditemukan." };
    if (/EPERM/.test(msg)) return { ok: false, pid: validPid, error: "Tidak ada izin (butuh admin/sudo)." };
    return { ok: false, pid: validPid, error: msg };
  }
  await new Promise((r) => setTimeout(r, 300));
  let stillAlive = false;
  try { process.kill(validPid, 0); stillAlive = true; } catch {}
  if (stillAlive) {
    try { process.kill(validPid, "SIGKILL"); } catch (e) {
      return { ok: false, pid: validPid, error: "Gagal SIGKILL: " + String(e?.message || e) };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ok: true, pid: validPid, name: procName, detail: "Dihentikan (SIGTERM" + (stillAlive ? " + SIGKILL" : "") + ")" };
}
