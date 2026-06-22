import { saveConfig, loadConfig, DEFAULT_RC_PATH } from '../config.mjs';
import { emit, fail } from '../output.mjs';

export async function cmdLogin(argv, _ctx) {
  const key = argv[0];
  if (!key) fail('Usage: router login <secret-key>');
  const cfg = loadConfig(DEFAULT_RC_PATH);
  saveConfig(DEFAULT_RC_PATH, { ...cfg, key });
  emit('✓ Saved key. Run `router whoami` to verify.', { ok: true });
}
