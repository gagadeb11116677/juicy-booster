import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const isWin = process.platform === "win32";

function appDataDir() {
  if (isWin) {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "JuicyBooster");
  }
  return path.join(os.homedir(), ".config", "juicy-booster");
}

function localDataDir() {
  if (isWin) {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "JuicyBooster");
  }
  return path.join(os.homedir(), ".local", "share", "juicy-booster");
}

export const APP_DATA = appDataDir();
export const LOCAL_DATA = localDataDir();
export const SETTINGS_FILE = path.join(APP_DATA, "settings.json");
export const HISTORY_FILE = path.join(APP_DATA, "history.json");
export const INSTANCE_FILE = path.join(LOCAL_DATA, "instance.json");
export const LOG_FILE = path.join(LOCAL_DATA, "juicy.log");
export const EDGE_PROFILE = path.join(LOCAL_DATA, "edge-profile");

export const DEFAULT_PORT = 3003;
export const PORT_RANGE = [3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010];

export function ensureDirs() {
  for (const d of [APP_DATA, LOCAL_DATA, EDGE_PROFILE]) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch {}
  }
}

export const IS_WIN = isWin;
