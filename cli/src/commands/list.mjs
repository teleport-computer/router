import { apiCall } from '../api.mjs';
import { loadConfig, DEFAULT_RC_PATH } from '../config.mjs';
import { emit, fail, isJsonMode } from '../output.mjs';

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 6) return `${hours}h ago`;
  const d = new Date(ts);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`;
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${mon}-${day} ${hh}:${mm}`;
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const purple = (s) => `\x1b[35m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

function formatEntry(e) {
  const lines = [];
  const parts = [dim(`@${e.handle}`), dim(timeAgo(e.timestamp))];
  if (e.channel) parts.push(purple(`#${e.channel}`));
  lines.push(`  ${parts.join(' · ')}`);
  lines.push(`  ${bold(e.summary)}`);
  if (e.oneliner && e.oneliner !== e.summary) lines.push(`  ${dim(e.oneliner)}`);
  const tags = (e.tags || []).map(t => cyan(`#${t}`)).join(' ');
  if (tags) lines.push(`  ${tags}`);
  lines.push(`  ${dim(`id: ${e.id}`)}`);
  lines.push('');
  return lines.join('\n');
}

export async function cmdList(argv, ctx) {
  const cfg = loadConfig(DEFAULT_RC_PATH);
  if (!cfg.key) fail('Not logged in. Run: router init');

  const params = new URLSearchParams();
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === '--channel' && argv[i + 1]) { params.set('channel', argv[++i]); }
    else if (argv[i] === '--tag' && argv[i + 1]) { params.set('tags', argv[++i]); }
    else if (argv[i] === '--author' && argv[i + 1]) { params.set('author', argv[++i]); }
    else if (argv[i] === '--limit' && argv[i + 1]) { params.set('limit', argv[++i]); }
    i++;
  }
  if (!params.has('limit')) params.set('limit', '20');

  const channel = params.get('channel');
  let r;
  if (channel) {
    params.delete('channel');
    r = await apiCall({ method: 'GET', server: cfg.server, path: `/api/channels/${channel}/entries?${params}`, key: cfg.key, cliVersion: ctx.cliVersion });
  } else {
    r = await apiCall({ method: 'GET', server: cfg.server, path: `/api/entries?${params}`, key: cfg.key, cliVersion: ctx.cliVersion });
  }
  if (!r.ok) fail(`Error ${r.status}: ${r.data?.error ?? '?'}`);

  const entries = r.data?.entries || [];
  if (isJsonMode()) { emit('', { entries }); return; }
  if (entries.length === 0) {
    emit(dim('  No entries found.'), { entries: [] });
    return;
  }
  const text = entries.map(formatEntry).join('\n') + dim(`  ${entries.length} entries`);
  emit(text, { entries });
}
