import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { sysinfo, formatBytes } from "./lib/sysinfo.js";
import { listProcesses, killProcess, validatePid, isProtected } from "./lib/processes.js";
import { boost, scanJunk, cleanCategory, setMode, resetAll, getState, setState } from "./lib/optimizer.js";
import { getSystemInfo, getDrives, getStartupItems, getServices, getBattery, getNetworkInterfaces } from "./lib/system.js";
import { VERSION, SERVICE_NAME } from "./lib/version.js";
import { DEFAULT_PORT, PORT_RANGE, ensureDirs, IS_WIN, LOG_FILE, INSTANCE_FILE } from "./lib/config.js";
import { getSettings, setSetting, resetSettings } from "./lib/settings.js";
import { getHistory, addHistory, clearHistory } from "./lib/history.js";
import { launchAppWindow, writeInstance, clearInstance, readInstance } from "./lib/desktop.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const IS_SEA = (() => {
  try { return require("node:sea").isSea(); } catch { return false; }
})();

function readAsset(rel) {
  if (IS_SEA) {
    try { return require("node:sea").getAsset("public/" + rel); } catch { return null; }
  }
  try { return fs.readFileSync(path.join(PUBLIC_DIR, rel)); } catch { return null; }
}

const AUTH_TOKEN = crypto.randomBytes(24).toString("hex");
let activePort = DEFAULT_PORT;
let server = null;
let shutdownTimer = null;
let lastPing = Date.now();
let windowChild = null;
let mutexBusy = false;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function safeConsole(method, ...args) {
  try { if (process.stdout) console[method](...args); } catch {}
}

function logFile(msg) {
  try {
    ensureDirs();
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, "utf8");
  } catch {}
}

process.on("uncaughtException", (e) => {
  logFile("uncaughtException: " + (e?.stack || e));
  safeConsole("error", "uncaughtException:", e?.message);
});
process.on("unhandledRejection", (e) => {
  logFile("unhandledRejection: " + (e?.stack || e));
  safeConsole("error", "unhandledRejection:", e?.message);
});
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

function sendJSON(res, status, data, extraHeaders) {
  const body = JSON.stringify(data);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Length": Buffer.byteLength(body),
  };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  res.writeHead(status, headers);
  res.end(body);
}

function sendStatic(res, data, ext) {
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  res.end(data);
}

function checkHost(req) {
  const host = req.headers.host || "";
  if (!host) return false;
  const h = host.split(":")[0].toLowerCase();
  return h === "127.0.0.1" || h === "localhost";
}

function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const h = u.hostname.toLowerCase();
    return h === "127.0.0.1" || h === "localhost";
  } catch { return false; }
}

function checkAuth(req) {
  const token = req.headers["x-juicy-token"];
  if (!token || typeof token !== "string") return false;
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(AUTH_TOKEN);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

function rejectForbidden(res) {
  return sendJSON(res, 403, { ok: false, error: "Akses ditolak." });
}

function rejectUnauth(res) {
  return sendJSON(res, 403, { ok: false, error: "Token tidak valid." });
}

function rejectBusy(res) {
  return sendJSON(res, 409, { ok: false, error: "Sedang ada proses lain berjalan." });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

function scheduleShutdown(delay = 3000) {
  if (shutdownTimer) clearTimeout(shutdownTimer);
  shutdownTimer = setTimeout(() => {
    gracefulShutdown("window-closed");
  }, delay);
}

function cancelShutdown() {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
  lastPing = Date.now();
}

function gracefulShutdown(reason) {
  logFile("shutdown: " + reason);
  try { clearInstance(); } catch {}
  try {
    if (windowChild && !windowChild.killed) {
      try { windowChild.kill(); } catch {}
    }
  } catch {}
  if (server) {
    server.close(() => {
      safeConsole("log", "Server ditutup.");
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 1500);
  } else {
    process.exit(0);
  }
}

const requestHandler = async (req, res) => {
  if (!checkHost(req)) return rejectForbidden(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": `http://127.0.0.1:${activePort}`,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,X-Juicy-Token",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${activePort}`);
  const p = url.pathname;

  try {
    if (p === "/api/ping" && req.method === "GET") {
      cancelShutdown();
      return sendJSON(res, 200, { ok: true, t: Date.now() });
    }

    if (p === "/api/bye" && req.method === "POST") {
      scheduleShutdown(3000);
      return sendJSON(res, 200, { ok: true });
    }

    if (p === "/api/health" && req.method === "GET") {
      return sendJSON(res, 200, { ok: true, service: SERVICE_NAME, version: VERSION, os: process.platform, arch: process.arch, node: process.version, time: Date.now(), port: activePort, admin: isAdmin() });
    }

    if (p === "/api/metrics" && req.method === "GET") {
      const m = await sysinfo();
      return sendJSON(res, 200, m);
    }

    if (p === "/api/state" && req.method === "GET") {
      return sendJSON(res, 200, { ...getState(), settings: getSettings(), version: VERSION, isAdmin: isAdmin() });
    }

    if (p === "/api/history" && req.method === "GET") {
      return sendJSON(res, 200, { history: getHistory() });
    }

    if (p === "/api/history/clear" && req.method === "POST") {
      if (!checkAuth(req) || !checkOrigin(req)) return rejectUnauth(res);
      clearHistory();
      return sendJSON(res, 200, { ok: true });
    }

    if (p === "/api/processes" && req.method === "GET") {
      const list = await listProcesses();
      return sendJSON(res, 200, { processes: list });
    }

    if (p === "/api/processes/kill" && req.method === "POST") {
      if (!checkAuth(req) || !checkOrigin(req)) return rejectUnauth(res);
      if (mutexBusy) return rejectBusy(res);
      const body = await readBody(req);
      mutexBusy = true;
      try {
        const result = await killProcess(body);
        if (result.ok) addHistory({ action: "Akhiri proses", detail: `${result.name || ""} (PID ${result.pid})`, type: "kill" });
        return sendJSON(res, 200, result);
      } finally { mutexBusy = false; }
    }

    if (p === "/api/junk/scan" && req.method === "POST") {
      if (!checkAuth(req) || !checkOrigin(req)) return rejectUnauth(res);
      if (mutexBusy) return rejectBusy(res);
      mutexBusy = true;
      try {
        const result = await scanJunk();
        return sendJSON(res, 200, result);
      } finally { mutexBusy = false; }
    }

    if (p === "/api/junk/clean" && req.method === "POST") {
      if (!checkAuth(req) || !checkOrigin(req)) return rejectUnauth(res);
      if (mutexBusy) return rejectBusy(res);
      const body = await readBody(req);
      mutexBusy = true;
      try {
        const result = await cleanCategory(body.categories || []);
        addHistory({ action: "Bersihkan sampah", detail: result.detail, freed: result.freedBytes > 0 ? formatBytes(result.freedBytes) : undefined, type: "clean" });
        return sendJSON(res, 200, result);
      } finally { mutexBusy = false; }
    }

    if (p === "/api/boost" && req.method === "POST") {
      if (!checkAuth(req) || !checkOrigin(req)) return rejectUnauth(res);
      if (mutexBusy) return rejectBusy(res);
      mutexBusy = true;
      try {
        const result = await boost();
        addHistory({ action: "Boost", detail: result.detail, freed: result.freedBytes > 0 ? formatBytes(result.freedBytes) : undefined, type: "boost" });
        return sendJSON(res, 200, result);
      } finally { mutexBusy = false; }
    }

    if (p === "/api/mode" && req.method === "POST") {
      if (!checkAuth(req) || !checkOrigin(req)) return rejectUnauth(res);
      const body = await readBody(req);
      const result = await setMode(body.mode);
      if (result.ok) addHistory({ action: "Ganti mode daya", detail: result.label, type: "mode" });
      return sendJSON(res, 200, result);
    }

    if (p === "/api/reset" && req.method === "POST") {
      if (!checkAuth(req) || !checkOrigin(req)) return rejectUnauth(res);
      const result = await resetAll();
      addHistory({ action: "Reset ke default", detail: result.message, type: "reset" });
      return sendJSON(res, 200, result);
    }

    if (p === "/api/settings" && req.method === "GET") {
      return sendJSON(res, 200, { settings: getSettings() });
    }

    if (p === "/api/settings" && req.method === "POST") {
      if (!checkAuth(req) || !checkOrigin(req)) return rejectUnauth(res);
      const body = await readBody(req);
      for (const [k, v] of Object.entries(body)) {
        setSetting(k, v);
      }
      return sendJSON(res, 200, { ok: true, settings: getSettings() });
    }

    if (p === "/api/shutdown" && req.method === "POST") {
      if (!checkAuth(req) || !checkOrigin(req)) return rejectUnauth(res);
      sendJSON(res, 200, { ok: true });
      setTimeout(() => gracefulShutdown("user-request"), 200);
      return;
    }

    if (p === "/api/system" && req.method === "GET") {
      const result = await getSystemInfo();
      return sendJSON(res, 200, result);
    }

    if (p === "/api/drives" && req.method === "GET") {
      const result = await getDrives();
      return sendJSON(res, 200, { drives: result });
    }

    if (p === "/api/startup" && req.method === "GET") {
      const result = await getStartupItems();
      return sendJSON(res, 200, { items: result });
    }

    if (p === "/api/services" && req.method === "GET") {
      const result = await getServices();
      return sendJSON(res, 200, { services: result });
    }

    if (p === "/api/battery" && req.method === "GET") {
      const result = await getBattery();
      return sendJSON(res, 200, result);
    }

    if (p === "/api/network" && req.method === "GET") {
      const result = await getNetworkInterfaces();
      return sendJSON(res, 200, { interfaces: result });
    }

    if (req.method === "GET") {
      let urlPath = p;
      if (urlPath === "/") urlPath = "/index.html";
      const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
      const ext = path.extname(safe).toLowerCase();
      const data = readAsset(safe.replace(/^\//, ""));
      if (!data) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      if (safe === "/index.html" || safe.endsWith("index.html")) {
        let html = data.toString("utf8");
        const tokenMeta = `<meta name="juicy-token" content="${AUTH_TOKEN}" /><meta name="juicy-port" content="${activePort}" />`;
        html = html.replace("</head>", `  ${tokenMeta}\n</head>`);
        html = html.replace(/(href|src)="(style\.css|app\.js|favicon\.ico|manifest\.webmanifest|icon-[^"]+\.png|logo\.png)"/g, '$1="$2?XTransformPort=' + activePort + '"');
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
          "Content-Security-Policy": CSP,
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        });
        res.end(html);
        return;
      }
      return sendStatic(res, data, ext);
    }

    return sendJSON(res, 404, { error: "Tidak ditemukan." });
  } catch (e) {
    logFile("error: " + (e?.stack || e));
    return sendJSON(res, 500, { ok: false, error: "Kesalahan internal." });
  }
};

function isAdmin() {
  if (!IS_WIN) {
    try { return os.userInfo().uid === 0; } catch { return false; }
  }
  return false;
}

async function tryStartServer(port) {
  return new Promise((resolve) => {
    const s = http.createServer(requestHandler);
    s.on("error", (e) => {
      if (e.code === "EADDRINUSE") resolve(null);
      else resolve(null);
    });
    s.listen(port, "127.0.0.1", () => {
      resolve(s);
    });
  });
}

async function findPort() {
  const inst = readInstance();
  if (inst && inst.port) {
    try {
      const r = await fetch(`http://127.0.0.1:${inst.port}/api/health`);
      const j = await r.json();
      if (j.service === SERVICE_NAME) return { port: inst.port, already: true };
    } catch {}
  }
  for (const port of PORT_RANGE) {
    const s = await tryStartServer(port);
    if (s) return { port, server: s, already: false };
  }
  return null;
}

async function main() {
  ensureDirs();
  const result = await findPort();
  if (!result) {
    safeConsole("error", "Tidak ada port tersedia.");
    process.exit(1);
  }
  activePort = result.port;
  if (result.already) {
    safeConsole("log", "Instance sudah jalan di port " + activePort + ". Membuka jendela.");
    const r = launchAppWindow(`http://127.0.0.1:${activePort}/`);
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  server = result.server;
  writeInstance(activePort);

  setInterval(() => {
    if (Date.now() - lastPing > 120000 && !mutexBusy) {
      gracefulShutdown("heartbeat-timeout");
    }
  }, 30000);

  safeConsole("log", "");
  safeConsole("log", "  Juicy Booster v" + VERSION);
  safeConsole("log", "  ─────────────────────────────────────");
  safeConsole("log", `  Server   : http://127.0.0.1:${activePort} (loopback)`);
  safeConsole("log", `  OS       : ${process.platform} (${process.arch})`);
  safeConsole("log", `  Node     : ${process.version}`);
  safeConsole("log", `  Token    : ${AUTH_TOKEN.slice(0, 8)}...`);
  safeConsole("log", "");

  if (!process.env.JUICY_NO_WINDOW && IS_WIN) {
    const r = launchAppWindow(`http://127.0.0.1:${activePort}/`, { width: 1040, height: 700, debug: process.env.JUICY_DEBUG === "1" });
    windowChild = r.child || null;
    if (r.child) {
      r.child.on("exit", () => {
        scheduleShutdown(3000);
      });
    }
  } else if (!IS_WIN && !process.env.JUICY_NO_OPEN) {
    const { exec } = await import("node:child_process");
    try { exec(`xdg-open http://127.0.0.1:${activePort}/`); } catch {}
  }
}

main().catch((e) => {
  logFile("fatal: " + (e?.stack || e));
  safeConsole("error", "Fatal:", e?.message);
  process.exit(1);
});
