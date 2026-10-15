// index.js — Juicy Booster v0.4 server.
// HTTP server zero-dependency (cuma Node built-in). Serve API + static HTML/CSS/JS.
// Keamanan: bind 127.0.0.1, token auth untuk aksi destruktif, CORS same-origin.
// Jalan dengan: `node index.js` atau `bun run dev`

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { exec, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sysinfo, formatBytes } from "./lib/sysinfo.js";
import { listProcesses, killProcess } from "./lib/processes.js";
import {
  boost,
  cleanCategory,
  setMode,
  resetAll,
  getState,
  getHistory,
  setDownloadFolder,
} from "./lib/optimizer.js";
import {
  getSystemInfo,
  getDrives,
  getStartupItems,
  getServices,
  getBattery,
  getNetworkInterfaces,
} from "./lib/system.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3003;
const HOST = "127.0.0.1"; // bind loopback only — tidak expose ke jaringan
const PUBLIC_DIR = path.join(__dirname, "public");

// Token auth: di-generate tiap startup, di-inject ke HTML yang dilayani.
// Semua POST (aksi destruktif) butuh header X-Juicy-Token yang cocok.
// Mencegah app lokal lain / website untuk CSRF memanggil kill/boost.
const AUTH_TOKEN = crypto.randomBytes(24).toString("hex");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    // Tidak ada ACAO * — server cuma dilayani same-origin (localhost).
    // Cegah app/website lain memanggil API dari browser.
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/** Cek token untuk semua POST (aksi destruktif). */
function checkAuth(req) {
  const token = req.headers["x-juicy-token"];
  if (!token || typeof token !== "string") return false;
  // constant-time compare anti timing attack
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(AUTH_TOKEN);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Tolak POST tanpa token valid. */
function rejectUnauth(res) {
  return sendJSON(res, 403, { ok: false, error: "Unauthorized: token tidak valid." });
}

function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";
  // cegah path traversal
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    // Inject AUTH_TOKEN ke index.html (meta tag) supaya app.js bisa baca.
    if (urlPath === "/index.html" || urlPath.endsWith("index.html")) {
      let html = data.toString("utf8");
      const tokenMeta = `<meta name="juicy-token" content="${AUTH_TOKEN}" />`;
      html = html.replace("</head>", `  ${tokenMeta}\n</head>`);
      data = Buffer.from(html, "utf8");
    }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  // Tolak koneksi dari host selain 127.0.0.1 / ::1 (defense in depth, walau sudah bind loopback)
  const remote = req.socket.remoteAddress || "";
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1", ""].includes(remote)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden: external access blocked");
    return;
  }

  // CORS preflight — hanya same-origin, tidak ada wildcard
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": `http://127.0.0.1:${PORT}`,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,X-Juicy-Token",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    // ---------- API ----------
    if (p === "/api/health" && req.method === "GET") {
      return sendJSON(res, 200, {
        ok: true,
        service: "juicy-booster",
        version: "0.4.0",
        os: process.platform,
        arch: process.arch,
        node: process.version,
        time: Date.now(),
      });
    }

    if (p === "/api/metrics" && req.method === "GET") {
      const m = await sysinfo();
      return sendJSON(res, 200, m);
    }

    if (p === "/api/state" && req.method === "GET") {
      return sendJSON(res, 200, getState());
    }

    if (p === "/api/history" && req.method === "GET") {
      return sendJSON(res, 200, { history: getHistory() });
    }

    if (p === "/api/processes" && req.method === "GET") {
      const list = await listProcesses();
      return sendJSON(res, 200, { processes: list });
    }

    // Semua endpoint POST (aksi destruktif) butuh token auth.
    if (req.method === "POST" && !checkAuth(req)) {
      return rejectUnauth(res);
    }

    if (p === "/api/processes/kill" && req.method === "POST") {
      const body = await readBody(req);
      const result = await killProcess(body);
      return sendJSON(res, 200, result);
    }

    if (p === "/api/boost" && req.method === "POST") {
      const result = await boost();
      return sendJSON(res, 200, result);
    }

    if (p === "/api/clean" && req.method === "POST") {
      const body = await readBody(req);
      const result = await cleanCategory(body.category);
      return sendJSON(res, 200, result);
    }

    if (p === "/api/mode" && req.method === "POST") {
      const body = await readBody(req);
      const result = await setMode(body.mode);
      return sendJSON(res, 200, result);
    }

    if (p === "/api/reset" && req.method === "POST") {
      const result = await resetAll();
      return sendJSON(res, 200, result);
    }

    if (p === "/api/download-folder" && req.method === "POST") {
      const body = await readBody(req);
      const result = setDownloadFolder(body.folder);
      return sendJSON(res, 200, result);
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

    if (p === "/api/diagnostics" && req.method === "GET") {
      // Cek kemampuan tiap subsystem (anti-error: kalo ada yang gagal, tetep return info)
      const checks = {};
      // shell exec
      try {
        execSync("echo ok", { timeout: 2000, windowsHide: true });
        checks.shell = { ok: true };
      } catch (e) {
        checks.shell = { ok: false, error: String(e?.message || e) };
      }
      // admin (Windows: net session; Linux: id -u)
      try {
        if (process.platform === "win32") {
          execSync("net session", { timeout: 2000, windowsHide: true, stdio: "ignore" });
          checks.admin = { ok: true };
        } else {
          const uid = execSync("id -u", { timeout: 2000, encoding: "utf8" }).trim();
          checks.admin = { ok: uid === "0", uid };
        }
      } catch {
        checks.admin = { ok: false, note: "Run as Administrator for full features" };
      }
      // temp dir writable
      try {
        const t = os.tmpdir();
        fs.writeFileSync(path.join(t, "juicy_test.tmp"), "ok");
        fs.unlinkSync(path.join(t, "juicy_test.tmp"));
        checks.tempDir = { ok: true, path: t };
      } catch (e) {
        checks.tempDir = { ok: false, error: String(e?.message || e) };
      }
      return sendJSON(res, 200, {
        ok: true,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        pid: process.pid,
        cwd: process.cwd(),
        checks,
      });
    }

    // ---------- Static ----------
    if (req.method === "GET") {
      return serveStatic(req, res);
    }

    return sendJSON(res, 404, { error: "Not found" });
  } catch (e) {
    return sendJSON(res, 500, { error: e?.message || "Internal error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  Juicy Booster v0.4");
  console.log("  ─────────────────────────────────────");
  console.log(`  Server   : http://${HOST}:${PORT} (loopback only)`);
  console.log(`  OS       : ${process.platform} (${process.arch})`);
  console.log(`  Node     : ${process.version}`);
  console.log(`  PID      : ${process.pid}`);
  console.log(`  Token    : ${AUTH_TOKEN.slice(0, 8)}... (auth per session)`);
  console.log("");
  console.log("  Bind 127.0.0.1 — tidak expose ke jaringan.");
  console.log("  POST butuh token (anti CSRF dari app/website lain).");
  console.log("");

  // Auto-open browser (skip kalau env JUICY_NO_OPEN set, mis. di sandbox/dev)
  if (!process.env.JUICY_NO_OPEN) {
    const url = `http://localhost:${PORT}`;
    try {
      if (process.platform === "win32") {
        exec(`start "" "${url}"`);
      } else if (process.platform === "darwin") {
        exec(`open "${url}"`);
      } else {
        exec(`xdg-open "${url}"`);
      }
    } catch {
      /* ignore */
    }
  }
});

