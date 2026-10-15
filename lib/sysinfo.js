import os from "node:os";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { IS_WIN } from "./config.js";

const isMac = process.platform === "darwin";

function run(file, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? "" : (stdout || "").trim());
    });
  });
}

const cache = new Map();
function cached(key, ttlMs, fn) {
  const entry = cache.get(key);
  const now = Date.now();
  if (entry && now - entry.at < ttlMs) return entry.value;
  const p = Promise.resolve(fn()).then((v) => {
    cache.set(key, { at: now, value: v });
    return v;
  });
  cache.set(key, { at: now, value: p });
  return p;
}

let prevCpu = null;
function getCpuUsage() {
  const cpus = os.cpus();
  if (!cpus.length) return 0;
  let idle = 0, total = 0;
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

const staticInfo = {};
async function getStaticInfo() {
  if (staticInfo.os) return staticInfo;
  let osName = "Unknown", osVersion = "", osBuild = "";
  if (IS_WIN) {
    const out = await run("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber | ConvertTo-Json -Compress)"]);
    try {
      const j = JSON.parse(out);
      osName = j.Caption || "Windows";
      osVersion = j.Version || os.release();
      osBuild = String(j.BuildNumber || "");
    } catch {}
  } else if (isMac) {
    osName = "macOS";
    osVersion = await run("sw_vers", ["-productVersion"]) || os.release();
    osBuild = await run("sw_vers", ["-buildVersion"]) || "";
  } else {
    try {
      const raw = fs.readFileSync("/etc/os-release", "utf8");
      const m = raw.match(/^PRETTY_NAME="(.+)"/m);
      osName = m ? m[1] : "Linux";
    } catch { osName = "Linux"; }
    osVersion = os.release();
  }
  let manufacturer = "", model = "";
  if (IS_WIN) {
    const out = await run("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model | ConvertTo-Json -Compress)"]);
    try {
      const j = JSON.parse(out);
      manufacturer = j.Manufacturer || "";
      model = j.Model || "";
    } catch {}
  } else if (isMac) {
    manufacturer = "Apple";
    model = await run("sysctl", ["-n", "hw.model"]) || "";
  }
  const cpus = os.cpus();
  staticInfo.os = { name: osName, version: osVersion, build: osBuild, platform: process.platform, arch: process.arch, hostname: os.hostname(), uptime: Math.floor(os.uptime()) };
  staticInfo.hardware = {
    manufacturer: manufacturer || (isMac ? "Apple" : "Generic"),
    model: model || "Generic",
    cpuModel: cpus[0]?.model || "Unknown",
    cpuCores: cpus.length,
    cpuSpeed: cpus[0]?.speed || 0,
    totalMemory: os.totalmem(),
  };
  return staticInfo;
}

async function getCpuTemp() {
  return cached("cpuTemp", 10000, async () => {
    if (IS_WIN) {
      const out = await run("powershell", ["-NoProfile", "-Command", "(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue).CurrentTemperature"]);
      const m = out.match(/(\d+)/);
      if (m) {
        const v = parseInt(m[1], 10);
        if (v > 0) return Math.round((v / 10) - 273.15);
      }
      return null;
    }
    if (isMac) return null;
    try {
      const zones = fs.readdirSync("/sys/class/thermal").filter((f) => f.startsWith("thermal_zone"));
      for (const z of zones) {
        const p = `/sys/class/thermal/${z}/temp`;
        if (fs.existsSync(p)) {
          const milli = parseInt(fs.readFileSync(p, "utf8").trim(), 10);
          if (!isNaN(milli)) return Math.round(milli / 1000);
        }
      }
    } catch {}
    return null;
  });
}

function getRam() {
  const total = os.totalmem();
  const free = os.freemem();
  return { total, free, used: total - free, percent: total > 0 ? ((total - free) / total) * 100 : 0 };
}

function getDisk() {
  try {
    const root = IS_WIN ? (process.env.SystemDrive || "C:") + "\\" : "/";
    const stat = fs.statfsSync(root);
    const total = stat.blocks * stat.bsize;
    const free = stat.bfree * stat.bsize;
    return { total, free, used: total - free, percent: total > 0 ? ((total - free) / total) * 100 : 0, root };
  } catch {
    return { total: 0, free: 0, used: 0, percent: 0, root: "/" };
  }
}

let gpuCache = { name: null, at: 0 };
async function getGpu() {
  return cached("gpu", 2000, async () => {
    const out = await run("nvidia-smi", ["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"], 3000);
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
    let name = null;
    if (IS_WIN) {
      const now = Date.now();
      if (!gpuCache.name || now - gpuCache.at > 60000) {
        const out2 = await run("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-CimInstance Win32_VideoController).Name"]);
        name = out2 || null;
        gpuCache = { name, at: now };
      } else {
        name = gpuCache.name;
      }
    } else if (!isMac) {
      try {
        const cards = fs.readdirSync("/sys/class/drm").filter((c) => /^card\d+$/.test(c));
        if (cards.length > 0) name = "GPU " + cards[0];
      } catch {}
    } else {
      const raw = await run("system_profiler", ["SPDisplaysDataType"]);
      const m = raw && raw.match(/Chipset Model:\s*(.+)/);
      name = m ? m[1].trim() : "Apple GPU";
    }
    return { name: name || "GPU", available: false, percent: null, memUsedMB: 0, memTotalMB: 0, temp: null, source: null };
  });
}

let prevNet = null;
function getNetwork() {
  if (IS_WIN) {
    return cached("net", 1500, async () => {
      const out = await run("powershell", ["-NoProfile", "-Command", "(Get-Counter '\\Network Interface(*)\\Bytes Total/sec' -ErrorAction SilentlyContinue).CounterSamples | Select-Object -First 1 -ExpandProperty CookedValue"], 3000);
      const bps = parseFloat(out) || 0;
      return { downMBps: Math.round((bps / 1048576) * 100) / 100, upMBps: 0 };
    });
  }
  if (isMac) return { downMBps: 0, upMBps: 0 };
  try {
    const raw = fs.readFileSync("/proc/net/dev", "utf8");
    let rx = 0, tx = 0;
    for (const line of raw.split("\n").slice(2)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const iface = parts[0].replace(":", "");
      if (iface === "lo") continue;
      rx += parseInt(parts[1], 10) || 0;
      tx += parseInt(parts[9], 10) || 0;
    }
    const now = Date.now();
    if (prevNet) {
      const dt = (now - prevNet.t) / 1000;
      const drx = (rx - prevNet.rx) / dt;
      const dtx = (tx - prevNet.tx) / dt;
      prevNet = { rx, tx, t: now };
      return { downMBps: Math.max(0, Math.round((drx / 1048576) * 100) / 100), upMBps: Math.max(0, Math.round((dtx / 1048576) * 100) / 100) };
    }
    prevNet = { rx, tx, t: now };
    return { downMBps: 0, upMBps: 0 };
  } catch {
    return { downMBps: 0, upMBps: 0 };
  }
}

export async function sysinfo() {
  const [staticI, temp, gpu] = await Promise.all([getStaticInfo(), getCpuTemp(), getGpu()]);
  const cpu = getCpuUsage();
  const ram = getRam();
  const disk = getDisk();
  const net = await getNetwork();
  const load = (cpu * 0.35) + (ram.percent * 0.4) + (disk.percent * 0.25);
  const score = Math.round(Math.max(0, Math.min(100, 100 - load * 0.85)));
  return {
    timestamp: Date.now(),
    os: staticI.os,
    hardware: staticI.hardware,
    cpu: { percent: Math.round(cpu * 10) / 10, model: staticI.hardware.cpuModel, cores: staticI.hardware.cpuCores, temp },
    ram: { ...ram, percent: Math.round(ram.percent * 10) / 10 },
    disk: { ...disk, percent: Math.round(disk.percent * 10) / 10 },
    gpu,
    network: net,
    uptime: Math.floor(os.uptime()),
    score,
    scoreFormula: "score = 100 - 0.85*(cpu*0.35 + ram*0.40 + disk*0.25)",
  };
}

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}
