import { apiCall } from '../api.mjs';
import { loadConfig, DEFAULT_RC_PATH } from '../config.mjs';
import { emit, fail } from '../output.mjs';
import { decideAction, formatBlockMessage } from '../version-check.mjs';

export async function cmdDelete(argv, ctx) {
  const id = argv[0];
  if (!id) fail('Usage: router delete <entry-id>');
  const cfg = loadConfig(DEFAULT_RC_PATH);
  if (!cfg.key) fail('Not logged in. Run: router init');

  const r = await apiCall({ method: 'DELETE', server: cfg.server, path: `/api/entries/${encodeURIComponent(id)}`, key: cfg.key, cliVersion: ctx.cliVersion });
  const a = decideAction(ctx.cliVersion, r.versionInfo);
  if (a.kind === 'block') fail(formatBlockMessage(a.latest));
  if (!r.ok) fail(`Error ${r.status}: ${r.data?.error ?? '?'}`);
  emit(`✓ Deleted entry ${id}`, { ok: true, id });
}
