import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { DEFAULT_RC_PATH } from '../config.mjs';
import { extractCodexBlock } from '../skill-template.mjs';
import { emit, note, isJsonMode } from '../output.mjs';

const CC_SKILL_DIR = join(homedir(), '.claude', 'skills', 'router-sync');
const CODEX_AGENTS_PATH = join(homedir(), '.codex', 'AGENTS.md');

export async function cmdUninstall(argv, _ctx) {
  const yes = argv.includes('--yes') || argv.includes('-y');

  // Build the plan first so the user sees what's coming before any destructive op.
  const plan = [];
  if (existsSync(DEFAULT_RC_PATH)) {
    plan.push({ path: DEFAULT_RC_PATH, kind: 'file', label: 'CLI config + key' });
  }
  if (existsSync(CC_SKILL_DIR)) {
    plan.push({ path: CC_SKILL_DIR, kind: 'dir', label: 'Claude Code skill' });
  }
  if (existsSync(CODEX_AGENTS_PATH)) {
    const content = readFileSync(CODEX_AGENTS_PATH, 'utf-8');
    if (extractCodexBlock(content)) {
      plan.push({ path: CODEX_AGENTS_PATH, kind: 'codex-block', label: 'Codex marker block (other content preserved)' });
    }
  }

  if (plan.length === 0) {
    emit('Nothing to remove — no router config or skill files found.', { ok: true, removed: [] });
    return;
  }

  if (!isJsonMode()) {
    process.stdout.write('\nThis will remove:\n');
    for (const item of plan) {
      const prefix = item.kind === 'codex-block' ? '  router-sync block in ' : '  ';
      process.stdout.write(`${prefix}${item.path}\n    (${item.label})\n`);
    }
    process.stdout.write('\nThe npm package itself stays. After this completes, run:\n');
    process.stdout.write('  npm uninstall -g @teleport-computer/router-cli\n\n');
  }

  if (!yes && !isJsonMode()) {
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve =>
      rl.question('Continue? [y/N] ', a => { rl.close(); resolve(a.trim().toLowerCase()); }),
    );
    if (answer !== 'y' && answer !== 'yes') {
      emit('Aborted. Nothing was removed.', { ok: false, aborted: true });
      return;
    }
  }

  const removed = [];
  for (const item of plan) {
    try {
      if (item.kind === 'file') {
        rmSync(item.path);
      } else if (item.kind === 'dir') {
        rmSync(item.path, { recursive: true });
      } else if (item.kind === 'codex-block') {
        // Splice the marker block out — preserves anything the user had in
        // AGENTS.md before/after our block.
        const content = readFileSync(item.path, 'utf-8');
        const block = extractCodexBlock(content);
        const merged = (block.before + block.after).replace(/\n{3,}/g, '\n\n');
        writeFileSync(item.path, merged);
      }
      removed.push({ path: item.path, kind: item.kind });
      note(`✓ Removed ${item.kind === 'codex-block' ? 'router-sync block from ' : ''}${item.path}`);
    } catch (e) {
      note(`✗ Failed to remove ${item.path}: ${e?.message ?? e}`);
    }
  }

  emit('\n✓ Done. Run `npm uninstall -g @teleport-computer/router-cli` to remove the CLI binary.', { ok: true, removed });
}
