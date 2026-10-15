
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

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

export async function getSystemInfo() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  let osName = "Unknown";
  let osVersion = "";
  let osBuild = "";

  if (isWin) {
    const caption = sh(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Caption"`,
      3000
    );
    osName = caption || "Windows";
    const ver = sh(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Version"`,
      3000
    );
    osVersion = ver || os.release();
    const build = sh(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).BuildNumber"`,
      3000
    );
    osBuild = build || "";
  } else if (isMac) {
    osName = "macOS";
    osVersion = sh("sw_vers -productVersion", 2000) || os.release();
    osBuild = sh("sw_vers -buildVersion", 2000) || "";
  } else {
    try {
      const raw = fs.readFileSync("/etc/os-release", "utf8");
      const m = raw.match(/^PRETTY_NAME="(.+)"/m);
      osName = m ? m[1] : "Linux";
    } catch {
      osName = "Linux";
    }
    osVersion = os.release();
  }

  let manufacturer = "";
  let model = "";
  if (isWin) {
    manufacturer = sh(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem).Manufacturer"`,
      3000
    );
    model = sh(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem).Model"`,
      3000
    );
  }

  return {
    os: {
      name: osName,
      version: osVersion,
      build: osBuild,
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      uptime: Math.floor(os.uptime()),
    },
    hardware: {
      manufacturer: manufacturer || (isMac ? "Apple" : "Generic"),
      model: model || (isMac ? sh("sysctl -n hw.model", 2000) : "Generic"),
      cpuModel: cpus[0]?.model || "Unknown",
      cpuCores: cpus.length,
      cpuSpeed: cpus[0]?.speed || 0,
      totalMemory: totalMem,
      freeMemory: freeMem,
      usedMemory: totalMem - freeMem,
    },
    network: {
      interfaces: Object.keys(os.networkInterfaces())
        .filter((n) => !n.toLowerCase().includes("loopback"))
        .slice(0, 4),
    },
  };
}

export async function getDrives() {
  if (isWin) {
    const out = sh(
      `powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,@{N='SizeGB';E={[math]::Round($_.Size/1GB,1)}},@{N='FreeGB';E={[math]::Round($_.FreeSpace/1GB,1)}},VolumeName | ConvertTo-Csv -NoTypeInformation"`,
      5000
    );
    if (!out) return [];
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean).slice(1);
    const drives = [];
    for (const row of lines) {
      const cells = row.match(/"[^"]*"/g);
      if (!cells || cells.length < 3) continue;
      const c = cells.map((x) => x.replace(/^"|"$/g, "").replace(/""/g, '"'));
      const total = parseFloat(c[1]) || 0;
      const free = parseFloat(c[2]) || 0;
      drives.push({
        id: c[0],
        label: c[3] || c[0],
        totalGB: total,
        freeGB: free,
        usedGB: Math.round((total - free) * 10) / 10,
        percent: total > 0 ? Math.round(((total - free) / total) * 1000) / 10 : 0,
      });
    }
    return drives;
  }
  if (isMac) {
    const out = sh(`df -h | grep -v 'map' | awk 'NR>1{print $1","$2","$4","$5}'`, 3000);
    if (!out) return [];
    return out.split("\n").slice(0, 8).map((line) => {
      const [id, size, avail, usedPct] = line.split(",");
      const totalGB = parseSizeToGB(size);
      const freeGB = parseSizeToGB(avail);
      return {
        id,
        label: id,
        totalGB,
        freeGB,
        usedGB: Math.round((totalGB - freeGB) * 10) / 10,
        percent: parseFloat(usedPct) || 0,
      };
    });
  }
  const out = sh(`df -h --output=source,size,avail,pcent,target 2>/dev/null | awk 'NR>1'`, 3000);
  if (!out) return [];
  return out
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 8)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) return null;
      const totalGB = parseSizeToGB(parts[1]);
      const freeGB = parseSizeToGB(parts[2]);
      const pct = parseFloat(parts[3]) || 0;
      return {
        id: parts[0],
        label: parts[4],
        totalGB,
        freeGB,
        usedGB: Math.round((totalGB - freeGB) * 10) / 10,
        percent: pct,
      };
    })
    .filter(Boolean);
}

function parseSizeToGB(s) {
  if (!s) return 0;
  const m = s.match(/^([\d.]+)([KMGT]?)i?B?$/i);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  const unit = (m[2] || "").toUpperCase();
  const mult = { K: 1 / 1048576, M: 1 / 1024, G: 1, T: 1024 }[unit] || 1;
  return Math.round(num * mult * 10) / 10;
}

export async function getStartupItems() {
  if (isWin) {
    const ps = `
$items = @()
# HKCU Run
try { (Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { $items += [PSCustomObject]@{ Name=$_.Name; Command=$_.Value; Location='HKCU Run'; User='Current' } } } catch {}
# HKLM Run
try { (Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { $items += [PSCustomObject]@{ Name=$_.Name; Command=$_.Value; Location='HKLM Run'; User='All Users' } } } catch {}
# Startup folder current user
$startupUser = [Environment]::GetFolderPath('Startup')
if (Test-Path $startupUser) { Get-ChildItem $startupUser -File | ForEach-Object { $items += [PSCustomObject]@{ Name=$_.BaseName; Command=$_.FullName; Location='Startup Folder'; User='Current' } } }
# Startup folder all users
$startupAll = "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
if (Test-Path $startupAll) { Get-ChildItem $startupAll -File | ForEach-Object { $items += [PSCustomObject]@{ Name=$_.BaseName; Command=$_.FullName; Location='Startup Folder'; User='All Users' } } }
$items | ConvertTo-Csv -NoTypeInformation
`.trim();
    const out = sh(`powershell -NoProfile -Command "${ps.replace(/"/g, '`"')}"`, 6000);
    if (!out) return [];
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean).slice(1);
    return lines.map((row) => {
      const cells = row.match(/"[^"]*"/g);
      if (!cells) return null;
      const c = cells.map((x) => x.replace(/^"|"$/g, "").replace(/""/g, '"'));
      return {
        name: c[0] || "",
        command: c[1] || "",
        location: c[2] || "",
        user: c[3] || "",
      };
    }).filter(Boolean);
  }
  const out = sh(`systemctl list-unit-files --type=service --state=enabled --no-pager --no-legend 2>/dev/null | awk '{print $1}' | head -n 30`, 3000);
  if (out) {
    return out.split("\n").filter(Boolean).map((name) => ({
      name,
      command: "",
      location: "systemd",
      user: "system",
    }));
  }
  return [];
}

export async function getServices() {
  if (isWin) {
    const out = sh(
      `powershell -NoProfile -Command "Get-Service | Where-Object {$_.Status -eq 'Running'} | Select-Object Name,DisplayName,Status,StartType | Sort-Object DisplayName | Select-Object -First 40 | ConvertTo-Csv -NoTypeInformation"`,
      6000
    );
    if (!out) return [];
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean).slice(1);
    return lines.map((row) => {
      const cells = row.match(/"[^"]*"/g);
      if (!cells) return null;
      const c = cells.map((x) => x.replace(/^"|"$/g, "").replace(/""/g, '"'));
      return {
        name: c[0] || "",
        displayName: c[1] || c[0] || "",
        status: c[2] || "",
        startType: c[3] || "",
      };
    }).filter(Boolean);
  }
  const out = sh(
    `systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | awk '{print $1","$4}' | head -n 30`,
    3000
  );
  if (!out) return [];
  return out.split("\n").filter(Boolean).map((line) => {
    const [name, status] = line.split(",");
    return {
      name: name || "",
      displayName: name || "",
      status: status || "running",
      startType: "",
    };
  });
}

export async function getBattery() {
  if (isWin) {
    const out = sh(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object EstimatedChargeRemaining,BatteryStatus,EstimatedRunTime | ConvertTo-Csv -NoTypeInformation"`,
      4000
    );
    if (out) {
      const lines = out.split("\n").map((l) => l.trim()).filter(Boolean).slice(1);
      if (lines.length > 0) {
        const cells = lines[0].match(/"[^"]*"/g);
        if (cells) {
          const c = cells.map((x) => x.replace(/^"|"$/g, "").replace(/""/g, '"'));
          const statusMap = {
            1: "Discharging",
            2: "AC Power",
            3: "Charging",
            4: "Low",
            5: "Critical",
          };
          return {
            hasBattery: true,
            percent: parseInt(c[0], 10) || 0,
            status: statusMap[parseInt(c[1], 10)] || "Unknown",
            runtimeMin: parseInt(c[2], 10) || 0,
          };
        }
      }
    }
    return { hasBattery: false };
  }
  if (isMac) {
    const out = sh(`pmset -g batt 2>/dev/null | grep -i 'InternalBattery'`, 3000);
    if (out) {
      const m = out.match(/(\d+)%.*?(charging|discharging|charged|AC Power)/i);
      if (m) {
        return {
          hasBattery: true,
          percent: parseInt(m[1], 10),
          status: m[2] || "Unknown",
          runtimeMin: 0,
        };
      }
    }
    return { hasBattery: false };
  }
  try {
    const dir = "/sys/class/power_supply";
    const entries = fs.readdirSync(dir);
    for (const e of entries) {
      const type = fs.readFileSync(`${dir}/${e}/type`, "utf8").trim();
      if (type !== "Battery") continue;
      const cap = parseInt(fs.readFileSync(`${dir}/${e}/capacity`, "utf8").trim(), 10);
      const stat = fs.readFileSync(`${dir}/${e}/status`, "utf8").trim();
      return {
        hasBattery: true,
        percent: cap,
        status: stat,
        runtimeMin: 0,
      };
    }
  } catch {
  }
  return { hasBattery: false };
}

export async function getNetworkInterfaces() {
  const ifaces = os.networkInterfaces();
  const result = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (name.toLowerCase().includes("loopback")) continue;
    const ipv4 = addrs?.find((a) => a.family === "IPv4" && !a.internal);
    if (ipv4) {
      result.push({
        name,
        address: ipv4.address,
        mac: ipv4.mac,
      });
    }
  }
  return result.slice(0, 6);
}
