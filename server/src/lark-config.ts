/**
 * Lark configuration from process.env.
 *
 * Returns null when LARK_APP_ID, LARK_APP_SECRET, LARK_REDIRECT_URI, or
 * LARK_STATE_SECRET is missing — endpoints use this to short-circuit with
 * 503 lark_not_configured.
 */

export interface LarkRuntimeConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  domain: string;
  stateSecret: string;
  botEnabled: boolean;
  verificationToken?: string;
}

let cached: LarkRuntimeConfig | null | undefined;

export function loadLarkConfig(): LarkRuntimeConfig | null {
  if (cached !== undefined) return cached;
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  const redirectUri = process.env.LARK_REDIRECT_URI;
  const stateSecret = process.env.LARK_STATE_SECRET;
  const domain = process.env.LARK_DOMAIN || 'https://open.feishu.cn';
  const botEnabled = process.env.LARK_BOT_ENABLED === 'true';
  const verificationToken = process.env.LARK_VERIFICATION_TOKEN;

  if (!appId || !appSecret || !redirectUri || !stateSecret) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[lark] LARK_APP_ID / LARK_APP_SECRET / LARK_REDIRECT_URI / LARK_STATE_SECRET missing — Lark endpoints will return 503');
    }
    cached = null;
    return null;
  }
  cached = { appId, appSecret, redirectUri, domain, stateSecret, botEnabled, verificationToken };
  return cached;
}

/** For tests only: reset the cache so changes to env are picked up. */
export function _resetLarkConfigCache(): void {
  cached = undefined;
}
