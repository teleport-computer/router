/**
 * Lark user-token keep-alive cron.
 *
 * Problem: Lark v2 OAuth refresh tokens expire in 7 days, and they're
 * single-use rolling — each refresh issues a new one with a fresh 7-day
 * window. If a bound user goes 7 days without any code path refreshing their
 * token (e.g. they don't open CC), the binding dies and they have to re-OAuth.
 *
 * Fix: this cron refreshes EVERY bound user's token once a day. Daily cadence
 * inside a 7-day window gives ~7x safety margin — missing a day or two is fine.
 * So a user binds ONCE and the link stays alive indefinitely (as long as the
 * cron itself isn't down for 7+ consecutive days).
 *
 * On permanent expiry (token already dead when cron runs — happens on first
 * run for pre-existing stale bindings, or after long cron downtime), the
 * token manager unbinds the user. We capture their open_id beforehand and
 * push a "please re-link" Lark DM via the bot (tenant token still works even
 * after the user token died).
 *
 * See docs/superpowers/specs/2026-05-28-lark-token-refresh-cron-design.md.
 */

import type { Storage } from './storage.js';
import type { TokenManager } from './lark-tokens.js';
import type { LarkApiClient } from './lark/api-client.js';

export interface RefreshAllDeps {
  storage: Pick<Storage, 'getAllUsers' | 'getUser'>;
  tokenManager: Pick<TokenManager, 'getValidUserAccessToken'>;
  /** Bot API client — used to DM users whose token permanently expired. Optional. */
  apiClient?: LarkApiClient | null;
  publicUrl: string;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export interface RefreshRunStats {
  bound: number;       // users with a Lark refresh token
  refreshed: number;   // successfully rolled forward
  expired: number;     // permanently dead → unbound (+ notified if possible)
  transient: number;   // refresh failed but binding preserved (will retry next run)
}

/**
 * China = UTC+8, no DST. 03:00 Beijing == 19:00 UTC (previous calendar day).
 * Compute ms until the next 19:00 UTC boundary. 3am is a low-traffic window.
 */
export function msUntilNext3amBeijing(): number {
  const now = new Date();
  const target = new Date();
  target.setUTCHours(19, 0, 0, 0); // 19:00 UTC == 03:00 Beijing next day
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

/** Send a "re-link Lark" prompt to a user whose token permanently expired. */
async function notifyRebind(apiClient: LarkApiClient, openId: string, publicUrl: string): Promise<void> {
  const url = `${publicUrl.replace(/\/$/, '')}/settings/lark`;
  await apiClient.post('/open-apis/im/v1/messages?receive_id_type=open_id', {
    receive_id: openId,
    msg_type: 'text',
    content: JSON.stringify({
      text: `你的 Router ↔ Lark 链接已过期，日历/任务同步已暂停。重新连接一下就好（一次即可，之后会自动保活）：${url}`,
    }),
  });
}

/**
 * Refresh every bound user's Lark token. Reuses tokenManager.getValidUserAccessToken,
 * which on success persists the rolled refresh_token, and on permanent failure
 * unbinds the user. Returns run stats.
 */
export async function refreshAllBoundLarkUsers(deps: RefreshAllDeps): Promise<RefreshRunStats> {
  const log = deps.log ?? ((lvl, m) => console[lvl === 'info' ? 'log' : lvl](`[lark-token-refresh] ${m}`));
  const stats: RefreshRunStats = { bound: 0, refreshed: 0, expired: 0, transient: 0 };

  const users = await deps.storage.getAllUsers();
  for (const u of users) {
    if (!u.larkRefreshToken) continue; // not bound — nothing to keep alive
    stats.bound++;
    const openIdBefore = u.larkOpenId;

    let token: string | null = null;
    try {
      token = await deps.tokenManager.getValidUserAccessToken(u.handle);
    } catch (e: any) {
      log('warn', `@${u.handle}: refresh threw: ${e?.message ?? e}`);
    }

    if (token) {
      stats.refreshed++;
      continue;
    }

    // Refresh returned null. Distinguish permanent (unbound) vs transient
    // (binding preserved) by re-reading the user's current binding state.
    const after = await deps.storage.getUser(u.handle);
    if (!after?.larkRefreshToken) {
      stats.expired++;
      log('warn', `@${u.handle}: token permanently expired, unbound`);
      if (deps.apiClient && openIdBefore) {
        notifyRebind(deps.apiClient, openIdBefore, deps.publicUrl).catch(err =>
          log('warn', `@${u.handle}: rebind notice failed: ${err?.message ?? err}`),
        );
      }
    } else {
      stats.transient++;
      log('warn', `@${u.handle}: refresh transiently failed (binding kept, retry next run)`);
    }
  }

  log('info', `done: bound=${stats.bound} refreshed=${stats.refreshed} expired=${stats.expired} transient=${stats.transient}`);
  return stats;
}

/**
 * Schedule the daily token-refresh run. Recursive setTimeout to the next
 * 3am Beijing boundary (resilient to drift / restarts / missed fires).
 * Returns a stop function for tests / shutdown.
 */
export function startLarkTokenRefreshCron(deps: RefreshAllDeps): () => void {
  if (process.env.LARK_TOKEN_REFRESH_CRON_DISABLED === '1') {
    console.log('[lark-token-refresh] DISABLED via LARK_TOKEN_REFRESH_CRON_DISABLED env var');
    return () => {};
  }

  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  function scheduleNext(): void {
    if (stopped) return;
    const delay = msUntilNext3amBeijing();
    const targetTime = new Date(Date.now() + delay);
    console.log(`[lark-token-refresh] next run at ${targetTime.toISOString()} (in ${Math.round(delay / 3600000)}h)`);
    timer = setTimeout(async () => {
      try {
        await refreshAllBoundLarkUsers(deps);
      } catch (e: any) {
        console.warn(`[lark-token-refresh] run failed: ${e?.message ?? e}`);
      } finally {
        scheduleNext();
      }
    }, delay);
  }

  scheduleNext();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
