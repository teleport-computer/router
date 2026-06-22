const ONE_DAY_MS = 24 * 3600 * 1000;

export function decideSyncAction({ now, lastCheckAt, localHash, localVersion, serverVersion }) {
  if (now - lastCheckAt < ONE_DAY_MS) {
    return { kind: 'skip', reason: 'cache_valid' };
  }
  if (localVersion && serverVersion === localVersion) {
    return { kind: 'skip', reason: 'versions_match' };
  }
  return { kind: 'fetch' };
}

export function decideOverwriteAction({ originalShippedHash, currentLocalHash }) {
  // originalShippedHash = the hash that was shipped with the version currently installed
  // currentLocalHash = computed hash of file as it exists now
  // If they match, the user has not modified the file — safe to overwrite.
  if (originalShippedHash && currentLocalHash && originalShippedHash === currentLocalHash) {
    return { kind: 'safe_overwrite' };
  }
  if (!originalShippedHash || !currentLocalHash) {
    return { kind: 'safe_overwrite' }; // no signature info — assume safe
  }
  return { kind: 'user_modified' };
}

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { apiCall } from './api.mjs';
import { computeContentHash, extractVersion, extractContentHash, extractCodexBlock, wrapForCodex, MARKER_BEGIN_RE } from './skill-template.mjs';

const CC_SKILL_PATH = join(homedir(), '.claude', 'skills', 'router-sync', 'SKILL.md');
const CODEX_AGENTS_PATH = join(homedir(), '.codex', 'AGENTS.md');

/**
 * Best-effort background sync. Never throws.
 * Returns one of:
 *   'throttled'     — local 24h cache still valid; caller should NOT bump
 *                     last_skill_check_at, otherwise active CLI users
 *                     reset the timer on every command and never sync.
 *   'skipped'       — upstream check attempted but failed (server non-OK,
 *                     network error, parse error). Caller should NOT bump
 *                     either — allow retry on next invocation.
 *   'up-to-date'    — upstream check succeeded, local skill already current.
 *   'updated'       — upstream check succeeded, local skill rewritten.
 * The caller in bin/router.mjs uses these to decide whether to bump the
 * 24h throttle timestamp.
 */
export async function backgroundSyncSkill({ cfg, cliVersion, now = Date.now() }) {
  try {
    if (now - (cfg.last_skill_check_at ?? 0) < 24 * 3600 * 1000) return 'throttled';

    // Step 1 (cheap): get server template version. Use /api/skill-template directly
    // since /api/context requires auth + we want this to work even unlogged-in.
    const r = await apiCall({ method: 'GET', server: cfg.server, path: '/api/skill-template', key: null, cliVersion });
    if (!r.ok) return 'skipped';
    const template = r.data;

    // Step 2: check each target file
    const targets = [
      { path: CC_SKILL_PATH, kind: 'cc' },
      { path: CODEX_AGENTS_PATH, kind: 'codex' },
    ];
    let anyUpdated = false;
    for (const t of targets) {
      if (!existsSync(t.path)) continue;
      const current = readFileSync(t.path, 'utf-8');
      let blockContent;
      let inferReplace;
      if (t.kind === 'cc') {
        blockContent = current;
        inferReplace = (newInner) => newInner;
      } else {
        const block = extractCodexBlock(current);
        if (!block) continue;
        blockContent = block.inner;
        inferReplace = (newInner) => block.before + wrapForCodex(template.content, template.version, template.hash) + block.after;
      }
      const localVersion = extractVersion(blockContent);
      if (localVersion === template.version) continue;
      const originalHash = extractContentHash(blockContent);
      const localHash = computeContentHash(blockContent);
      if (originalHash && originalHash !== localHash) {
        // user-modified — do NOT silently overwrite
        continue;
      }
      const replacement = inferReplace(template.content);
      writeFileSync(t.path, replacement);
      anyUpdated = true;
    }
    return anyUpdated ? 'updated' : 'up-to-date';
  } catch {
    return 'skipped';
  }
}
