import fs from "node:fs";
import { HISTORY_FILE, ensureDirs } from "./config.js";

const MAX_ENTRIES = 200;
let cache = null;
let nextId = 1;

function load() {
  if (cache) return cache;
  ensureDirs();
  try {
    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      cache = parsed;
      if (cache.length > 0) {
        nextId = Math.max(...cache.map((h) => h.id || 0)) + 1;
      }
    } else {
      cache = [];
    }
  } catch {
    cache = [];
  }
  return cache;
}

function persist() {
  ensureDirs();
  try {
    const tmp = HISTORY_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf8");
    fs.renameSync(tmp, HISTORY_FILE);
  } catch {}
}

export function getHistory() {
  return load().slice(0, MAX_ENTRIES);
}

export function addHistory(entry) {
  const list = load();
  list.unshift({ id: nextId++, at: Date.now(), ...entry });
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  persist();
  return list[0];
}

export function clearHistory() {
  cache = [];
  persist();
  return cache;
}
