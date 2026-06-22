import { apiCall } from '../api.mjs';
import { loadConfig, DEFAULT_RC_PATH } from '../config.mjs';
import { emit, fail, isJsonMode } from '../output.mjs';

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const purple = (s) => `\x1b[35m${s}\x1b[0m`;

export async function cmdChannels(_argv, ctx) {
  const cfg = loadConfig(DEFAULT_RC_PATH);
  if (!cfg.key) fail('Not logged in. Run: router init');

  const r = await apiCall({ method: 'GET', server: cfg.server, path: '/api/channels', key: cfg.key, cliVersion: ctx.cliVersion });
  if (!r.ok) fail(`Error ${r.status}: ${r.data?.error ?? '?'}`);

  const channels = r.data?.channels || [];
  if (isJsonMode()) { emit('', { channels }); return; }
  if (channels.length === 0) {
    emit(dim('  No channels.'), { channels: [] });
    return;
  }
  const lines = [];
  for (const ch of channels) {
    const skills = ch.skills?.length || 0;
    const subs = ch.subscribers?.length || 0;
    lines.push(`  ${purple(`#${ch.id}`)} ${dim(`— ${ch.name}`)}`);
    lines.push(`  ${dim(`${subs} members · ${skills} skills`)}`);
    if (ch.description) lines.push(`  ${dim(ch.description)}`);
    lines.push('');
  }
  emit(lines.join('\n'), { channels });
}
