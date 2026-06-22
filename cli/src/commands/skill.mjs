import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { apiCall } from '../api.mjs';
import { loadConfig, DEFAULT_RC_PATH } from '../config.mjs';
import { emit, note, fail } from '../output.mjs';
import {
  computeContentHash,
  extractContentHash,
  wrapForCodex,
  extractCodexBlock,
} from '../skill-template.mjs';
import { decideOverwriteAction } from '../skill-sync.mjs';

const CC_SKILL_DIR = join(homedir(), '.claude', 'skills', 'router-sync');
const CC_SKILL_PATH = join(CC_SKILL_DIR, 'SKILL.md');
const CODEX_AGENTS_PATH = join(homedir(), '.codex', 'AGENTS.md');

async function fetchTemplate(server, cliVersion) {
  const r = await apiCall({ method: 'GET', server, path: '/api/skill-template', key: null, cliVersion });
  if (!r.ok) fail(`Failed to fetch template: ${r.status}`);
  return r.data; // { version, hash, content }
}

function readSkillFile(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

function decideAndWrite({ targetPath, currentContent, isCodex, template, force }) {
  const newContent = template.content;
  if (!currentContent) {
    if (isCodex) {
      // Append wrapped block to existing AGENTS.md (or create new)
      const existing = existsSync(targetPath) ? readFileSync(targetPath, 'utf-8') : '';
      const block = wrapForCodex(newContent, template.version, template.hash);
      const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n\n' : (existing.length > 0 ? '\n' : '');
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, existing + sep + block + '\n');
    } else {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, newContent);
    }
    return { result: 'installed' };
  }

  if (isCodex) {
    const block = extractCodexBlock(currentContent);
    if (!block) {
      // No marker — append fresh block
      const wrapped = wrapForCodex(newContent, template.version, template.hash);
      const sep = currentContent.endsWith('\n') ? '\n' : '\n\n';
      writeFileSync(targetPath, currentContent + sep + wrapped + '\n');
      return { result: 'installed' };
    }
    // Compare hashes within marker block
    const localHash = computeContentHash(block.inner);
    const originalHash = block.inner.match(/hash:([^\s]+)/)?.[1] ?? null;
    const decision = decideOverwriteAction({
      originalShippedHash: originalHash ? 'sha256:' + originalHash : null,
      currentLocalHash: localHash,
    });
    if (decision.kind === 'user_modified' && !force) {
      return { result: 'user_modified', existing: block.inner, newContent: wrapForCodex(newContent, template.version, template.hash) };
    }
    const wrapped = wrapForCodex(newContent, template.version, template.hash);
    writeFileSync(targetPath, block.before + wrapped + block.after);
    return { result: 'updated' };
  }

  // CC: standalone file
  const localHash = computeContentHash(currentContent);
  const originalHash = extractContentHash(currentContent);
  const decision = decideOverwriteAction({
    originalShippedHash: originalHash,
    currentLocalHash: localHash,
  });
  if (decision.kind === 'user_modified' && !force) {
    return { result: 'user_modified', existing: currentContent, newContent };
  }
  writeFileSync(targetPath, newContent);
  return { result: 'updated' };
}

export async function cmdSkill(argv, ctx) {
  const sub = argv[0];
  if (!sub) fail('Usage: router skill <install|show|diff>');
  if (sub === 'install') return await cmdSkillInstall(argv.slice(1), ctx);
  if (sub === 'show') return await cmdSkillShow(argv.slice(1), ctx);
  if (sub === 'diff') return await cmdSkillDiff(argv.slice(1), ctx);
  fail(`Unknown subcommand: ${sub}`);
}

async function cmdSkillInstall(argv, ctx) {
  const cfg = loadConfig(DEFAULT_RC_PATH);
  const targets = parseTargets(argv);
  const force = argv.includes('--force');
  const template = await fetchTemplate(cfg.server, ctx.cliVersion);

  for (const target of targets) {
    const path = target === 'cc' ? CC_SKILL_PATH : CODEX_AGENTS_PATH;
    const isCodex = target === 'codex';
    const current = readSkillFile(path);
    const result = decideAndWrite({ targetPath: path, currentContent: current, isCodex, template, force });
    if (result.result === 'user_modified') {
      note(`⚠ ${target}: local file differs from template. Run with --force to overwrite, or edit manually.`);
    } else {
      emit(`✓ ${target}: ${result.result} at ${path}`, { ok: true, target, action: result.result, path });
    }
  }
}

function parseTargets(argv) {
  const t = [];
  if (argv.includes('--cc') || argv.length === 0) t.push('cc');
  if (argv.includes('--codex')) t.push('codex');
  return t.length ? t : ['cc'];
}

async function cmdSkillShow(_argv, ctx) {
  const cfg = loadConfig(DEFAULT_RC_PATH);
  const template = await fetchTemplate(cfg.server, ctx.cliVersion);
  process.stdout.write(template.content);
  process.stdout.write('\n');
}

async function cmdSkillDiff(argv, ctx) {
  const cfg = loadConfig(DEFAULT_RC_PATH);
  const target = argv.includes('--codex') ? 'codex' : 'cc';
  const localPath = target === 'cc' ? CC_SKILL_PATH : CODEX_AGENTS_PATH;

  if (!existsSync(localPath)) {
    fail(`Local ${target} skill file does not exist: ${localPath}\nRun: router skill install --${target}`);
  }
  const template = await fetchTemplate(cfg.server, ctx.cliVersion);
  let localContent = readFileSync(localPath, 'utf-8');
  if (target === 'codex') {
    const block = extractCodexBlock(localContent);
    if (!block) fail(`No router-sync marker block found in ${localPath}`);
    localContent = block.inner;
  }

  const { spawnSync } = await import('child_process');
  const { writeFileSync: wfs, mkdtempSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');
  const tmp = mkdtempSync(join(tmpdir(), 'router-skill-diff-'));
  const localTmp = join(tmp, 'local.md');
  const serverTmp = join(tmp, 'server.md');
  wfs(localTmp, localContent);
  wfs(serverTmp, template.content);
  try {
    const res = spawnSync('diff', ['-u', '--label', `local (${target})`, '--label', `server v${template.version}`, localTmp, serverTmp], { encoding: 'utf-8' });
    if (res.status === 0) {
      emit(`✓ ${target}: local matches server v${template.version} exactly.`, { ok: true, in_sync: true, version: template.version });
      return;
    }
    process.stdout.write(res.stdout);
    emit('', { ok: true, in_sync: false, version: template.version });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
