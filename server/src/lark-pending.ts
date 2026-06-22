/**
 * Pending Lark-direct registrations: in-memory state machine for the brief
 * window between Feishu OAuth callback and the user filling out
 * handle + invite_code on /register/lark.
 *
 * Stash the Lark identity (open_id, name, refresh_token, scopes) under a
 * short-lived random token. The user lands on /register/lark?pending=TOKEN,
 * the form fetches the pending row to display name + avatar, then submits
 * back with handle + invite_code. The endpoint validates and consumes.
 *
 * 10-min TTL; lazy-pruned on every access. In-memory only — restart drops
 * pending rows, which is fine (user just re-does the OAuth dance).
 */

export interface PendingLarkRegistration {
  openId: string;
  unionId?: string;
  name?: string;
  avatarUrl?: string;
  refreshToken: string;
  refreshExpiresAt: number;
  scopes: string[];
  expiresAt: number;
}

export type PendingLarkStore = Map<string, PendingLarkRegistration>;

export const DEFAULT_PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Generate a random pending registration token with `plr_` prefix
 * (distinct from rs_ session tokens for log-grep clarity).
 */
export function makePendingRegToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'plr_' + Buffer.from(bytes).toString('base64url');
}

/**
 * Look up a pending row by token. Lazy-prunes ALL expired rows on each
 * call so the map size is bounded by in-flight registrations.
 *
 * Returns null if the token doesn't exist OR if it's expired.
 */
export function getPendingReg(store: PendingLarkStore, token: string, now: number = Date.now()): PendingLarkRegistration | null {
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
  return store.get(token) || null;
}

/**
 * Insert a new pending row. Caller passes the data + chooses TTL via
 * expiresAt directly so tests can use synthetic timestamps.
 */
export function putPendingReg(store: PendingLarkStore, token: string, reg: PendingLarkRegistration): void {
  store.set(token, reg);
}

/** Remove a token after successful registration completion. */
export function consumePendingReg(store: PendingLarkStore, token: string): void {
  store.delete(token);
}
