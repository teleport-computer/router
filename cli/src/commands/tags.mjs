import { apiCall } from '../api.mjs';
import { loadConfig, DEFAULT_RC_PATH } from '../config.mjs';
import { emit, fail, isJsonMode } from '../output.mjs';

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

export async function cmdTags(_argv, ctx) {
  const cfg = loadConfig(DEFAULT_RC_PATH);
  if (!cfg.key) fail('Not logged in. Run: router init');

  let tags;
  const r = await apiCall({ method: 'GET', server: cfg.server, path: '/api/tags', key: cfg.key, cliVersion: ctx.cliVersion });
  if (r.ok && r.data?.tags) {
    tags = r.data.tags;
  } else {
    // Fallback: derive counts from entries
    const all = await apiCall({ method: 'GET', server: cfg.server, path: '/api/entries?limit=1000', key: cfg.key, cliVersion: ctx.cliVersion });
    if (!all.ok) fail(`Error ${all.status}: ${all.data?.error ?? '?'}`);
    const counts = {};
    for (const e of (all.data?.entries || [])) {
      for (const t of (e.tags || [])) {
        counts[t] = (counts[t] || 0) + 1;
      }
    }
    tags = Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  if (isJsonMode()) { emit('', { tags }); return; }
  if (!tags || tags.length === 0) {
    emit(dim('  No tags yet.'), { tags: [] });
    return;
  }
  const lines = [];
  for (const { tag, count } of tags) {
    const bar = '█'.repeat(Math.min(count, 30));
    lines.push(`  ${cyan(`#${tag}`)} ${dim(`(${count})`)} ${dim(bar)}`);
  }
  lines.push('');
  lines.push(dim(`  ${tags.length} tags total`));
  emit(lines.join('\n'), { tags });
}
