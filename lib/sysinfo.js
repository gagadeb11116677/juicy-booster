// lib/sysinfo.js — baca metrik sistem real, zero-dependency, OS-aware.
// Windows: pake PowerShell/wmic. Linux/Mac: pake /proc & os module.
// Fallback aman kalo command gagal.

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

/** Run shell command safely, return trimmed stdout or "". */
function sh(cmd, timeout = 4000) {
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

/* ---------------- CPU ---------------- */
// Cross-platform via os.cpus() times delta
let prevCpu = null;
function getCpuUsage() {
  const cpus = os.cpus();
  if (!cpus.length) return 0;
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  if (prevCpu) {
    const dIdle = idle - prevCpu.idle;
    const dTotal = total - prevCpu.total;
    prevCpu = { idle, total };
    if (dTotal <= 0) return 0;
    return Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100));
  }
  prevCpu = { idle, total };
  return 0;
}

function getCpuModel() {
  try {
    return os.cpus()[0]?.model || "Unknown CPU";
  } catch {
    return "Unknown CPU";
  }
}

function getCpuCores() {
  return os.cpus().length;
}

/* ---------------- CPU Temperature ---------------- */
function getCpuTemp() {
  if (isWin) {
    // wmic biasanya butuh admin & sering kosong, best-effort
    const out = sh(
      `wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature /value`,
      3000
    );
    const m = out.match(/CurrentTemperature=(\d+)/i);
    if (m) {
      // nilai dalam tenth of Kelvin
      return Math.round((parseInt(m[1], 10) / 10) - 273.15);
    }
    return null;
  }
  if (isMac) {
    const out = sh("sudo powermetrics --samplers smc -i1 -n1 2>/dev/null | grep -i 'CPU die temp'", 3000);
    const m = out.match(/([\d.]+)\s*C/i);
    if (m) return Math.round(parseFloat(m[1]));
    return null;
  }
  // Linux: baca thermal_zone
  try {
    const zones = fs.readdirSync("/sys/class/thermal").filter((f) =>
      f.startsWith("thermal_zone")
    );
    for (const z of zones) {
      const p = `/sys/class/thermal/${z}/temp`;
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf8").trim();
        const milli = parseInt(raw, 10);
        if (!isNaN(milli)) return Math.round(milli / 1000);
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/* ---------------- RAM ---------------- */
function getRam() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    total,
    free,
    used,
    percent: total > 0 ? (used / total) * 100 : 0,
  };
}

/* ---------------- Disk ---------------- */
function getDisk() {
  try {
    const root = isWin ? "C:\\" : "/";
    const stat = fs.statfsSync(root);
    const bsize = stat.bsize;
    const total = stat.blocks * bsize;
    const free = stat.bfree * bsize;
    const used = total - free;
    return {
      total,
      free,
      used,
      percent: total > 0 ? (used / total) * 100 : 0,
      root,
    };
  } catch {
    return { total: 0, free: 0, used: 0, percent: 0, root: "/" };
  }
}

/* ---------------- GPU ---------------- */
let gpuCache = { name: null, at: 0 };
function getGpu() {
  // 1. nvidia-smi (Windows + Linux kalo ada GPU Nvidia) — sumber real
  const out = sh(
    `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits`,
    3000
  );
  if (out) {
    const parts = out.split(",").map((s) => s.trim());
    if (parts.length >= 4) {
      return {
        name: parts[0] || "NVIDIA GPU",
        available: true,
        percent: parseFloat(parts[1]) || 0,
        memUsedMB: parseFloat(parts[2]) || 0,
        memTotalMB: parseFloat(parts[3]) || 0,
        temp: parts[4] ? parseInt(parts[4], 10) : null,
        source: "nvidia-smi",
      };
    }
  }

  // 2. AMD GPU (Windows): rocm-smi kalo ada
  const amd = sh(`rocm-smi --showuse --showmeminfo vram --json`, 3000);
  if (amd) {
    try {
      const j = JSON.parse(amd);
      const card = Object.keys(j)[0];
      if (card) {
        const v = j[card];
        return {
          name: "AMD GPU",
          available: true,
          percent: parseFloat(v["GPU use (%)"]) || 0,
          memUsedMB: Math.round((parseInt(v["VRAM Total Used Memory (B)"], 10) || 0) / 1048576),
          memTotalMB: Math.round((parseInt(v["VRAM Total Memory (B)"], 10) || 0) / 1048576),
          temp: null,
          source: "rocm-smi",
        };
      }
    } catch {
      /* ignore parse error */
    }
  }

  // 3. Cuma bisa ambil NAMA GPU, utilization gak tersedia tanpa driver API proprietary.
  //    Return percent: null biar frontend tampilin N/A (bukan angka palsu).
  let name = null;
  if (isWin) {
    const now = Date.now();
    if (!gpuCache.name || now - gpuCache.at > 60000) {
      const raw = sh(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController).Name"`,
        4000
      );
      name = raw || null;
      gpuCache = { name, at: now };
    } else {
      name = gpuCache.name;
    }
  } else if (!isMac) {
    // Linux: baca dari /sys/class/drm cuma dapet nama, bukan utilization real-time
    try {
      const cards = fs.readdirSync("/sys/class/drm").filter((c) =>
        /^card\d+$/.test(c)
      );
      if (cards.length > 0) {
        name = "GPU " + cards[0];
      }
    } catch {
      /* ignore */
    }
  } else {
    // Mac
    const raw = sh(`system_profiler SPDisplaysDataType 2>/dev/null | grep -m1 'Chipset'`, 3000);
    const m = raw && raw.match(/Chipset Model:\s*(.+)/);
    name = m ? m[1].trim() : "Apple GPU";
  }

  return {
    name: name || "GPU",
    available: false,
    percent: null,
    memUsedMB: 0,
    memTotalMB: 0,
    temp: null,
    source: null,
    note: "Utilisasi GPU butuh nvidia-smi/rocm-smi. Tanpa itu, tampil N/A.",
  };
}

/* ---------------- Network ---------------- */
let prevNet = null;
function getNetwork() {
  if (isWin) {
    // Get-Counter network interface
    const out = sh(
      `powershell -NoProfile -Command "Get-Counter '\\\\Network Interface(*)\\\\Bytes Total/sec' | Select-Object -ExpandProperty CounterSamples | Select-Object -First 1 -ExpandProperty CookedValue"`,
      3000
    );
    const bytesPerSec = parseFloat(out) || 0;
    return {
      downMBps: Math.round((bytesPerSec / 1048576) * 100) / 100,
      upMBps: 0,
    };
  }
  if (isMac) {
    return { downMBps: 0, upMBps: 0 };
  }
  // Linux: /proc/net/dev delta
  try {
    const raw = fs.readFileSync("/proc/net/dev", "utf8");
    let rx = 0;
    let tx = 0;
    for (const line of raw.split("\n").slice(2)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const iface = parts[0].replace(":", "");
      if (iface === "lo") continue; // skip loopback
      rx += parseInt(parts[1], 10) || 0;
      tx += parseInt(parts[9], 10) || 0;
    }
    const now = Date.now();
    if (prevNet) {
      const dt = (now - prevNet.t) / 1000;
      const drx = (rx - prevNet.rx) / dt;
      const dtx = (tx - prevNet.tx) / dt;
      prevNet = { rx, tx, t: now };
      return {
        downMBps: Math.max(0, Math.round((drx / 1048576) * 100) / 100),
        upMBps: Math.max(0, Math.round((dtx / 1048576) * 100) / 100),
      };
    }
    prevNet = { rx, tx, t: now };
    return { downMBps: 0, upMBps: 0 };
  } catch {
    return { downMBps: 0, upMBps: 0 };
  }
}

/* ---------------- Uptime ---------------- */
function getUptime() {
  return Math.floor(os.uptime());
}

/* ---------------- OS Info ---------------- */
function getOsInfo() {
  let name = "Unknown";
  let version = "";
  if (isWin) {
    const out = sh(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Caption"`,
      3000
    );
    name = out || "Windows";
    const v = sh(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Version"`,
      3000
    );
    version = v || os.release();
  } else if (isMac) {
    name = "macOS";
    version = sh("sw_vers -productVersion", 2000) || os.release();
  } else {
    // coba baca /etc/os-release
    try {
      const raw = fs.readFileSync("/etc/os-release", "utf8");
      const getName = raw.match(/^PRETTY_NAME="(.+)"/m);
      name = getName ? getName[1] : "Linux";
    } catch {
      name = "Linux";
    }
    version = os.release();
  }
  return {
    platform: process.platform,
    name,
    version,
    hostname: os.hostname(),
    arch: process.arch,
  };
}

/* ---------------- Aggregated metrics ---------------- */
/* ---------------- Swap Memory ---------------- */
function getSwap() {
  try {
    const total = (os.totalmem() > 0 ? Math.round(os.totalmem() * 0.5) : 0);
    // Linux baca /proc/meminfo SwapTotal/SwapFree
    if (!isWin && !isMac) {
      try {
        const raw = fs.readFileSync("/proc/meminfo", "utf8");
        const st = raw.match(/SwapTotal:\s+(\d+)/);
        const sf = raw.match(/SwapFree:\s+(\d+)/);
        if (st && sf) {
          const t = parseInt(st[1], 10) * 1024;
          const f = parseInt(sf[1], 10) * 1024;
          return {
            total: t,
            free: f,
            used: t - f,
            percent: t > 0 ? ((t - f) / t) * 100 : 0,
          };
        }
      } catch {
        /* ignore */
      }
    }
    return { total: 0, free: 0, used: 0, percent: 0 };
  } catch {
    return { total: 0, free: 0, used: 0, percent: 0 };
  }
}

/* ---------------- Load Average ---------------- */
function getLoadAvg() {
  try {
    const la = os.loadavg();
    return {
      "1m": Math.round(la[0] * 100) / 100,
      "5m": Math.round(la[1] * 100) / 100,
      "15m": Math.round(la[2] * 100) / 100,
    };
  } catch {
    return { "1m": 0, "5m": 0, "15m": 0 };
  }
}

export async function sysinfo() {
  const cpu = getCpuUsage();
  const cpuModel = getCpuModel();
  const cpuCores = getCpuCores();
  const cpuTemp = getCpuTemp();
  const ram = getRam();
  const swap = getSwap();
  const disk = getDisk();
  const gpu = getGpu();
  const net = getNetwork();
  const uptime = getUptime();
  const osInfo = getOsInfo();
  const loadAvg = getLoadAvg();

  // Performance score 0-100 (higher = healthier)
  const load =
    cpu * 0.32 + ram.percent * 0.34 + disk.percent * 0.14 + gpu.percent * 0.2;
  const score = Math.round(Math.max(0, Math.min(100, 100 - load * 0.82)));

  return {
    timestamp: Date.now(),
    os: osInfo,
    cpu: {
      percent: Math.round(cpu * 10) / 10,
      model: cpuModel,
      cores: cpuCores,
      temp: cpuTemp,
    },
    ram: {
      ...ram,
      percent: Math.round(ram.percent * 10) / 10,
    },
    swap: {
      ...swap,
      percent: Math.round(swap.percent * 10) / 10,
    },
    disk: {
      ...disk,
      percent: Math.round(disk.percent * 10) / 10,
    },
    gpu,
    network: net,
    uptime,
    loadAvg,
    score,
  };
}

export function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}
