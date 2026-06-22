import { loadConfig, saveConfig, DEFAULT_RC_PATH } from '../config.mjs';
import { emit } from '../output.mjs';

export async function cmdLogout(_argv, _ctx) {
  const cfg = loadConfig(DEFAULT_RC_PATH);
  if (!cfg.key) {
    emit('Already logged out.', { ok: true, was_logged_in: false });
    return;
  }
  saveConfig(DEFAULT_RC_PATH, { ...cfg, key: null });
  emit('✓ Logged out. Run `router init` to log in again.', { ok: true, was_logged_in: true });
}
