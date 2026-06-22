import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { apiCall } from '../api.mjs';
import { loadConfig, DEFAULT_RC_PATH } from '../config.mjs';
import { emit, note, fail } from '../output.mjs';
import { extractVersion, extractContentHash, computeContentHash, extractCodexBlock } from '../skill-template.mjs';
import { decideAction } from '../version-check.mjs';

const CC_SKILL_PATH = join(homedir(), '.claude', 'skills', 'router-sync', 'SKILL.md');
const CODEX_AGENTS_PATH = join(homedir(), '.codex', 'AGENTS.md');

export async function cmdDoctor(_argv, ctx) {
  const cfg = loadConfig(DEFAULT_RC_PATH);
  const checks = [];
  let connected = false;

  // Connectivity + login
  if (!cfg.key) {
    checks.push({ ok: false, label: 'Login', detail: 'Not logged in. Run: router init' });
  } else {
    let r;
    try {
      r = await apiCall({ method: 'GET', server: cfg.server, path: '/api/me', key: cfg.key, cliVersion: ctx.cliVersion });
    } catch (e) {
      checks.push({ ok: false, label: 'Server reachability', detail: `${cfg.server} (${e.message ?? 'network error'})` });
    }
    if (r) {
      if (!r.ok) {
        checks.push({ ok: false, label: 'Login', detail: `Server returned ${r.status}` });
      } else {
        connected = true;
        checks.push({ ok: true, label: 'Server reachability', detail: cfg.server });
        checks.push({ ok: true, label: 'Login', detail: `@${r.data.handle} (team: ${r.data.teamId})` });
        const action = decideAction(ctx.cliVersion, r.versionInfo);
        checks.push({
          ok: action.kind !== 'block',
          label: 'CLI version',
          detail: `${ctx.cliVersion} (latest: ${r.versionInfo.latest ?? '?'}, min: ${r.versionInfo.minSupported ?? '?'})${action.kind === 'soft' ? ' — upgrade recommended' : action.kind === 'block' ? ' — UPGRADE REQUIRED' : ''}`,
        });
      }
    }
  }

  // Server template version (so we can compare against local SKILL.md)
  let serverTpl = null;
  if (connected) {
    try {
      const r = await apiCall({ method: 'GET', server: cfg.server, path: '/api/skill-template', key: null, cliVersion: ctx.cliVersion });
      if (r.ok) serverTpl = r.data;
    } catch {}
  }

  // CC skill
  if (existsSync(CC_SKILL_PATH)) {
    const content = readFileSync(CC_SKILL_PATH, 'utf-8');
    const localVersion = extractVersion(content);
    const originalHash = extractContentHash(content);
    const localHash = computeContentHash(content);
    const modified = originalHash && originalHash !== localHash;
    const stale = serverTpl && localVersion !== serverTpl.version;
    checks.push({
      ok: !stale,
      label: 'Claude Code SKILL.md',
      detail: `${CC_SKILL_PATH}, v${localVersion ?? '?'}${serverTpl ? ` (latest: ${serverTpl.version})` : ''}${modified ? ' [user-modified]' : ''}`,
    });
  } else {
    checks.push({ ok: false, label: 'Claude Code SKILL.md', detail: 'not installed (run `router skill install --cc`)' });
  }

  // Codex marker
  if (existsSync(CODEX_AGENTS_PATH)) {
    const content = readFileSync(CODEX_AGENTS_PATH, 'utf-8');
    const block = extractCodexBlock(content);
    if (block) {
      const localVersion = extractVersion(block.inner);
      checks.push({ ok: true, label: 'Codex marker', detail: `present, v${localVersion ?? '?'}` });
    } else {
      checks.push({ ok: false, label: 'Codex marker', detail: 'AGENTS.md exists but no router-sync block' });
    }
  } else {
    checks.push({ ok: true, label: 'Codex marker', detail: 'not configured (skip if you don\'t use Codex)' });
  }

  for (const c of checks) {
    note(`${c.ok ? '✓' : '✗'} ${c.label}: ${c.detail}`);
  }
  emit('', { ok: true, checks });
}
