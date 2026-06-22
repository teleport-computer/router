/**
 * High-level Lark token API. Storage-aware wrapper over lark-oauth pure funcs.
 *
 * Two surfaces:
 *   - getValidUserAccessToken(handle)  — refresh user_access_token on demand
 *   - getTenantAccessToken()           — app-level token, in-process cache
 */

import type { Storage } from './storage.js';
import { refreshUserToken, getTenantAccessTokenRaw } from './lark-oauth.js';

export interface LarkConfig {
  domain: string;
  appId: string;
  appSecret: string;
}

export interface TokenManager {
  getValidUserAccessToken(handle: string): Promise<string | null>;
  getTenantAccessToken(): Promise<string>;
}

export function createTokenManager(storage: Storage, config: LarkConfig): TokenManager {
  // Tenant token in-process cache.
  let tenantToken: string | null = null;
  let tenantExpiresAt = 0;
  // Refresh 10 minutes before expiry.
  const TENANT_BUFFER_MS = 10 * 60 * 1000;

  return {
    async getValidUserAccessToken(handle: string): Promise<string | null> {
      const user = await storage.getUser(handle);
      if (!user || !user.larkRefreshToken) return null;

      try {
        const tokens = await refreshUserToken({
          domain: config.domain,
          appId: config.appId,
          appSecret: config.appSecret,
          refreshToken: user.larkRefreshToken,
        });
        // Persist the rolled refresh_token (always changes).
        await storage.bindLarkAccount(handle, {
          larkOpenId: user.larkOpenId!,
          larkUnionId: user.larkUnionId,
          larkName: user.larkName,
          larkAvatarUrl: user.larkAvatarUrl,
          larkRefreshToken: tokens.refreshToken,
          larkRefreshTokenExpiresAt: Date.now() + tokens.refreshExpiresIn * 1000,
          larkScopes: tokens.scopes.length > 0 ? tokens.scopes : (user.larkScopes ?? []),
          larkBoundAt: user.larkBoundAt ?? Date.now(),
        });
        return tokens.accessToken;
      } catch (err: any) {
        // Only unbind on PERMANENT refresh failures (the refresh token is
        // genuinely invalid — user revoked, expired, app changed scopes
        // requiring re-consent). Transient failures (network, 5xx, rate
        // limits) must NOT trigger unbind, because that creates a death
        // spiral: a single inject path / weekly cron probe with a flaky
        // refresh tears down the binding, and every subsequent call then
        // fails too because larkRefreshToken is now gone.
        //
        // Lark error code 99991671/99991672/20020 are typical for "refresh
        // token invalid/expired". The error string from refreshUserToken
        // includes the upstream `code=` and `msg=`. Match conservatively;
        // anything that doesn't clearly say "invalid refresh token" → keep
        // the binding and just return null for this call.
        const msg = String(err?.message ?? err);
        const isPermanent =
          /invalid_grant|invalid_refresh_token|refresh_token.*(expired|invalid)|99991671|99991672|99991678|20020/i
            .test(msg);
        if (isPermanent) {
          console.warn(`[lark-tokens] refresh PERMANENTLY failed for ${handle}, unbinding: ${msg}`);
          await storage.unbindLarkAccount(handle);
        } else {
          console.warn(`[lark-tokens] refresh transiently failed for ${handle} (binding preserved): ${msg}`);
        }
        return null;
      }
    },

    async getTenantAccessToken(): Promise<string> {
      const now = Date.now();
      if (tenantToken && tenantExpiresAt - TENANT_BUFFER_MS > now) {
        return tenantToken;
      }
      const r = await getTenantAccessTokenRaw(config);
      tenantToken = r.tenantAccessToken;
      tenantExpiresAt = now + r.expiresIn * 1000;
      return tenantToken;
    },
  };
}
