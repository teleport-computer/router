import { apiCall } from '../api.mjs';
import { loadConfig, DEFAULT_RC_PATH } from '../config.mjs';
import { emit, fail } from '../output.mjs';

export async function cmdWhoami(_argv, ctx) {
  const cfg = loadConfig(DEFAULT_RC_PATH);
  if (!cfg.key) fail('Not logged in. Run: router init');
  const r = await apiCall({ method: 'GET', server: cfg.server, path: '/api/me', key: cfg.key, cliVersion: ctx.cliVersion });
  if (!r.ok) fail(`Error ${r.status}`);
  emit(`@${r.data.handle} (team: ${r.data.teamId})`, r.data);
}
