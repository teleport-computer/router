import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const DEFAULT_RC_PATH = join(homedir(), '.routerrc');
export const DEFAULT_SERVER = 'https://router.feedling.app';

export function getDefaults() {
  return { key: null, server: DEFAULT_SERVER, last_skill_check_at: 0 };
}

export function loadConfig(path = DEFAULT_RC_PATH) {
  const def = getDefaults();
  let raw = {};
  if (existsSync(path)) {
    try { raw = JSON.parse(readFileSync(path, 'utf-8')); } catch {}
  }
  const merged = { ...def, ...raw };
  // Env var beats file (handy for testing against staging without editing rc).
  // The bin dispatcher also writes to ROUTER_SERVER from --server flag, so this
  // single lookup handles both paths.
  if (process.env.ROUTER_SERVER) merged.server = process.env.ROUTER_SERVER;
  return merged;
}

export function saveConfig(path, cfg) {
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
}
