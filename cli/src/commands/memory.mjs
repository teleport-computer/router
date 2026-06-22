import { readFileSync } from 'node:fs';
import { apiCall } from '../api.mjs';
import { loadConfig, DEFAULT_RC_PATH } from '../config.mjs';
import { emit, fail } from '../output.mjs';

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

/**
 * `router memory [subcommand]` dispatcher.
 *
 *   router memory                       — full Memory (current behavior)
 *   router memory sections              — list section names + 1-line summary
 *   router memory section <name>        — one section's full body
 *   router memory set <file>            — replace Memory with file content (admin)
 *   router memory set -                 — replace Memory with stdin (admin)
 *
 * Backed by HTTP endpoints `/api/memory`, `/api/memory/sections`,
 * `/api/memory/sections/:name`, and the `router_memory_set` MCP tool.
 * The section-fetch MCP tools were removed in 2026-05 — CC now sees the
 * full Memory in its system prompt, so `sections` / `section <name>` are
 * CLI-only paths for admins poking around from shell scripts.
 */
export async function cmdMemory(argv, ctx) {
  const cfg = loadConfig(DEFAULT_RC_PATH);
  if (!cfg.key) fail('Not logged in. Run: router init');

  const sub = argv[0];

  if (sub === 'sections') {
    return await listSections(cfg, ctx);
  }
  if (sub === 'section') {
    const name = argv[1];
    if (!name) fail('Usage: router memory section <name>');
    return await getSection(cfg, ctx, name);
  }
  if (sub === 'set') {
    const source = argv[1];
    if (!source) fail('Usage: router memory set <file> | -  (use - for stdin)');
    return await setMemory(cfg, ctx, source);
  }

  return await fullMemory(cfg, ctx);
}

async function fullMemory(cfg, ctx) {
  const r = await apiCall({
    method: 'GET',
    server: cfg.server,
    path: '/api/memory',
    key: cfg.key,
    cliVersion: ctx.cliVersion,
  });

  if (r.status === 501) {
    emit(r.data?.error ?? 'Coming soon. Team Memory feature ships in M3.', r.data);
    return;
  }
  if (!r.ok) fail(`Error ${r.status}: ${r.data?.error ?? '?'}`);

  const m = r.data;

  if (m.isTemplateOnly) {
    const lines = [
      yellow('⚠ Memory not configured yet'),
      dim('  Admin should fill it in at <server>/settings/memory.'),
    ];
    if (m.example) {
      lines.push('');
      lines.push(dim('Reference template (paste + adapt; do not commit verbatim):'));
      lines.push('');
      lines.push(dim(m.example));
    }
    emit(lines.join('\n'), m);
    return;
  }

  const updated = m.updatedAt
    ? `${new Date(m.updatedAt).toLocaleString()} by @${m.updatedByHandle}`
    : 'unknown';
  const lines = [
    bold('Team Memory'),
    dim(`  Last updated: ${updated}`),
    dim(`  ${m.charCount}/${m.charLimit} chars` + (m.canEdit ? ' · you can edit' : ' · read-only')),
    '',
    m.content,
  ];
  emit(lines.join('\n'), m);
}

async function listSections(cfg, ctx) {
  const r = await apiCall({
    method: 'GET',
    server: cfg.server,
    path: '/api/memory/sections',
    key: cfg.key,
    cliVersion: ctx.cliVersion,
  });
  if (!r.ok) fail(`Error ${r.status}: ${r.data?.error ?? '?'}`);

  if (r.data.isTemplateOnly || (r.data.sections ?? []).length === 0) {
    const msg = r.data.isTemplateOnly
      ? yellow('⚠ Memory not configured yet. Admin should fill it in at <server>/settings/memory.')
      : dim('(no sections — Memory has no ## headings)');
    emit(msg, r.data);
    return;
  }

  const lines = [
    bold('Memory sections:'),
    '',
    ...r.data.sections.map(s => `  - ${bold(s.name)} ${dim('— ' + (s.summary || '(empty)'))}`),
    '',
    dim('Fetch one with: router memory section <name>'),
  ];
  emit(lines.join('\n'), r.data);
}

async function getSection(cfg, ctx, name) {
  const r = await apiCall({
    method: 'GET',
    server: cfg.server,
    path: `/api/memory/sections/${encodeURIComponent(name)}`,
    key: cfg.key,
    cliVersion: ctx.cliVersion,
  });
  if (r.status === 404) {
    if (r.data?.error === 'memory_not_configured') {
      emit(yellow('⚠ Memory not configured yet.'), r.data);
      return;
    }
    if (r.data?.available) {
      emit(`Section "${name}" not found. Available: ${r.data.available.join(', ')}`, r.data);
      return;
    }
    fail(`Error ${r.status}: ${r.data?.error ?? '?'}`);
  }
  if (!r.ok) fail(`Error ${r.status}: ${r.data?.error ?? '?'}`);

  const lines = [
    bold(`## ${r.data.name}`),
    '',
    r.data.body,
  ];
  emit(lines.join('\n'), r.data);
}

async function setMemory(cfg, ctx, source) {
  // source is either a file path or '-' for stdin
  let content;
  try {
    if (source === '-') {
      // Read all of stdin synchronously
      content = readFileSync(0, 'utf8');
    } else {
      content = readFileSync(source, 'utf8');
    }
  } catch (e) {
    fail(`Cannot read ${source === '-' ? 'stdin' : source}: ${e.message}`);
  }

  if (!content.trim()) {
    fail('Refusing to save empty Memory. Use the web UI to clear it intentionally.');
  }

  const r = await apiCall({
    method: 'PUT',
    server: cfg.server,
    path: '/api/memory',
    key: cfg.key,
    body: { content },
    cliVersion: ctx.cliVersion,
  });

  if (r.status === 403) {
    fail('Only team admins can edit Memory. Ask an admin to run this for you.');
  }
  if (r.status === 400 && typeof r.data?.error === 'string' && r.data.error.startsWith('over_char_limit')) {
    fail(`Content too long: ${r.data.error}. Trim and retry.`);
  }
  if (!r.ok) fail(`Error ${r.status}: ${r.data?.error ?? '?'}`);

  const m = r.data;
  const lines = [
    green(`✓ Memory updated`),
    dim(`  ${m.charCount}/${m.charLimit} chars`),
    dim(`  Last updated by @${m.updatedByHandle} at ${new Date(m.updatedAt).toLocaleString()}`),
    dim(`  Previous version saved — restore via /settings/memory if needed`),
  ];
  emit(lines.join('\n'), m);
}
