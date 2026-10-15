import fs from "node:fs";
import path from "node:path";
import { SETTINGS_FILE, ensureDirs } from "./config.js";

const DEFAULTS = {
  theme: "system",
  confirmBeforeDelete: true,
  startWithWindows: false,
  checkForUpdates: false,
  zoomLevel: 100,
};

let cache = null;

function load() {
  if (cache) return cache;
  ensureDirs();
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    cache = { ...DEFAULTS, ...parsed };
  } catch {
    try {
      const bak = SETTINGS_FILE + ".bak";
      if (fs.existsSync(bak)) {
        fs.copyFileSync(bak, SETTINGS_FILE + ".corrupt");
      }
    } catch {}
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(next) {
  cache = { ...DEFAULTS, ...next };
  ensureDirs();
  const tmp = SETTINGS_FILE + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf8");
    fs.renameSync(tmp, SETTINGS_FILE);
  } catch (e) {
    try {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(cache, null, 2), "utf8");
    } catch {}
  }
  return cache;
}

export function getSettings() {
  return load();
}

export function setSetting(key, value) {
  const cur = load();
  cur[key] = value;
  save(cur);
  return cur;
}

export function resetSettings() {
  cache = { ...DEFAULTS };
  save(cache);
  return cache;
}
