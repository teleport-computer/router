import { apiCall } from '../api.mjs';
import { loadConfig, DEFAULT_RC_PATH } from '../config.mjs';
import { emit, fail, isJsonMode } from '../output.mjs';
import { decideAction, formatBlockMessage } from '../version-check.mjs';

export async function cmdGet(argv, ctx) {
  const id = argv[0];
  if (!id) fail('Usage: router get <entry-id>');
  const cfg = loadConfig(DEFAULT_RC_PATH);
  if (!cfg.key) fail('Not logged in. Run: router init');

  const r = await apiCall({ method: 'GET', server: cfg.server, path: `/api/entries/${encodeURIComponent(id)}`, key: cfg.key, cliVersion: ctx.cliVersion });
  const a = decideAction(ctx.cliVersion, r.versionInfo);
  if (a.kind === 'block') fail(formatBlockMessage(a.latest));
  if (!r.ok) fail(`Error ${r.status}: ${r.data?.error ?? '?'}`);
  const e = r.data?.entry ?? r.data;

  if (isJsonMode()) { emit('', e); return; }
  emit(`Entry ${e.id}
Author: @${e.handle}
When: ${new Date(e.timestamp).toLocaleString()}
Channel: ${e.channel ? '#' + e.channel : '(none)'}
Tags: ${(e.tags ?? []).map(t => '#' + t).join(' ')}

${e.summary}

${e.content ?? ''}`, e);
}
