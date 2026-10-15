import { spawn, execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { IS_WIN, EDGE_PROFILE, INSTANCE_FILE } from "./config.js";

const EDGE_REGISTRY_KEY = "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe";
const EDGE_PATHS = [
  path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
];

function findEdge() {
  if (!IS_WIN) return null;
  for (const p of EDGE_PATHS) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  try {
    const out = execFileSync("reg", ["query", EDGE_REGISTRY_KEY, "/ve"], { encoding: "utf8", windowsHide: true, timeout: 2000 });
    const m = out.match(/REG_SZ\s+(.+)/);
    if (m) {
      const p = m[1].trim();
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return null;
}

function findChrome() {
  if (!IS_WIN) return null;
  const paths = [
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

export function launchAppWindow(url, opts = {}) {
  if (!IS_WIN) {
    spawn("xdg-open", [url], { detached: false, stdio: "ignore" }).on("error", () => {});
    return { mode: "default-browser" };
  }
  const edge = findEdge();
  const browser = edge || findChrome();
  const args = [
    "--app=" + url,
    "--user-data-dir=" + EDGE_PROFILE,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=msEdgeWelcomeFLX,msEdgeAskToCloseAllTabs",
    "--window-size=" + (opts.width || 1040) + "," + (opts.height || 700),
  ];
  if (edge) {
    args.push("--disable-background-mode");
  }
  if (opts.debug) {
    args.push("--auto-open-devtools-for-tabs");
  }
  if (browser) {
    const child = spawn(browser, args, { detached: false, stdio: "ignore", windowsHide: false });
    return { mode: edge ? "edge-app" : "chrome-app", child, browser };
  }
  spawn("cmd", ["/c", "start", "", url], { detached: false, stdio: "ignore", windowsHide: true }).on("error", () => {});
  return { mode: "default-browser" };
}

export function writeInstance(port) {
  try {
    fs.writeFileSync(INSTANCE_FILE, JSON.stringify({ pid: process.pid, port, at: Date.now() }, null, 2), "utf8");
  } catch {}
}

export function clearInstance() {
  try {
    fs.unlinkSync(INSTANCE_FILE);
  } catch {}
}

export function readInstance() {
  try {
    const raw = fs.readFileSync(INSTANCE_FILE, "utf8");
    const j = JSON.parse(raw);
    if (Date.now() - (j.at || 0) > 24 * 3600 * 1000) return null;
    return j;
  } catch {
    return null;
  }
}
