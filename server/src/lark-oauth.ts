/**
 * Lark OAuth helpers (pure functions).
 *
 * No storage dependency. Wraps:
 *   - state signing/verification (HMAC-SHA256, base64url)
 *   - building the authorize URL
 *   - exchanging a code for tokens
 *   - refreshing user_access_token
 *   - fetching the bound user's profile
 *   - getting the app-level tenant_access_token (raw, no cache)
 *
 * Network calls go through fetch — mock fetch in tests.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// ─────────────────────────────────────────────────────────────
// State signing
// ─────────────────────────────────────────────────────────────

export interface StatePayload {
  nonce: string;
  intent: 'bind' | 'login';
  handle?: string;          // intent=bind: current router user
  callerKeyHash?: string;   // intent=login: hash of frontend's localStorage key
  inviteCode?: string;      // intent=login: prefill invite code on /register/lark
                            // when the user came from an invite link
  exp: number;              // ms epoch
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signState(payload: StatePayload, secret: string): string {
  const json = JSON.stringify(payload);
  const payloadPart = b64urlEncode(Buffer.from(json, 'utf8'));
  const sig = createHmac('sha256', secret).update(payloadPart).digest();
  return `${payloadPart}.${b64urlEncode(sig)}`;
}

export type VerifyResult =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyState(state: string, secret: string): VerifyResult {
  if (!state || typeof state !== 'string') return { ok: false, reason: 'malformed' };
  const parts = state.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [payloadPart, sigPart] = parts;

  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = createHmac('sha256', secret).update(payloadPart).digest();
    provided = b64urlDecode(sigPart);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadPart).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}

export function newNonce(): string {
  return b64urlEncode(randomBytes(16));
}

// ─────────────────────────────────────────────────────────────
// Authorize URL
// ─────────────────────────────────────────────────────────────

export interface BuildAuthorizeUrlInput {
  appId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  domain: string; // e.g. https://open.feishu.cn
}

export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const url = new URL('/open-apis/authen/v1/authorize', input.domain);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.appId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.scopes.join(' '));
  url.searchParams.set('state', input.state);
  return url.toString();
}

// ─────────────────────────────────────────────────────────────
// Nonce store (single-use, with TTL)
// ─────────────────────────────────────────────────────────────

export type NonceStore = Map<string, number>; // nonce → expiresAt (ms)

/**
 * Single-use nonce check with TTL. Returns true if first time within TTL
 * (and records it), false if already seen and not yet expired. Prunes
 * expired entries on every call so the map size is bounded by the
 * number of in-flight (≤5min old) OAuth attempts.
 *
 * In-memory only; restart clears the map, which is acceptable for Phase 0
 * (worst case: a user mid-flow retries OAuth once).
 */
export function claimNonce(store: NonceStore, nonce: string, expiresAt: number): boolean {
  const now = Date.now();
  for (const [k, exp] of store) {
    if (exp <= now) store.delete(k);
  }
  if (store.has(nonce)) return false;
  store.set(nonce, expiresAt);
  return true;
}

// ─────────────────────────────────────────────────────────────
// Token endpoints
// ─────────────────────────────────────────────────────────────

function ensureLarkOk(json: any): void {
  if (typeof json?.code === 'number' && json.code !== 0) {
    throw new Error(`Lark API error ${json.code}: ${json.msg || 'unknown'}`);
  }
}

export interface UserTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;          // seconds
  refreshExpiresIn: number;   // seconds
  scopes: string[];
}

// Feishu v2 token response uses inconsistent field names across regions / docs:
//   access_token  +  expires_in | expire_in | expire
//   refresh_token + (refresh_token_expires_in | refresh_expires_in)
// Pick the first non-undefined; fall back to safe defaults.
function pickAccessExpires(json: any): number {
  return json.expires_in ?? json.expire_in ?? json.expire ?? 7200;
}
function pickRefreshExpires(json: any): number {
  return json.refresh_token_expires_in ?? json.refresh_expires_in ?? 30 * 86400;
}

export async function exchangeCodeForTokens(input: {
  domain: string;
  appId: string;
  appSecret: string;
  code: string;
  redirectUri: string;
}): Promise<UserTokenSet> {
  const res = await fetch(`${input.domain}/open-apis/authen/v2/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: input.appId,
      client_secret: input.appSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
  const json: any = await res.json();
  ensureLarkOk(json);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: pickAccessExpires(json),
    refreshExpiresIn: pickRefreshExpires(json),
    scopes: typeof json.scope === 'string' ? json.scope.split(/\s+/).filter(Boolean) : [],
  };
}

export async function refreshUserToken(input: {
  domain: string;
  appId: string;
  appSecret: string;
  refreshToken: string;
}): Promise<UserTokenSet> {
  const res = await fetch(`${input.domain}/open-apis/authen/v2/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: input.appId,
      client_secret: input.appSecret,
      refresh_token: input.refreshToken,
    }),
  });
  const json: any = await res.json();
  ensureLarkOk(json);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: pickAccessExpires(json),
    refreshExpiresIn: pickRefreshExpires(json),
    scopes: typeof json.scope === 'string' ? json.scope.split(/\s+/).filter(Boolean) : [],
  };
}

export interface LarkUserInfo {
  openId: string;
  unionId?: string;
  name?: string;
  avatarUrl?: string;
}

export async function fetchLarkUserInfo(input: {
  domain: string;
  accessToken: string;
}): Promise<LarkUserInfo> {
  const res = await fetch(`${input.domain}/open-apis/authen/v1/user_info`, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
  const json: any = await res.json();
  ensureLarkOk(json);
  return {
    openId: json.data.open_id,
    unionId: json.data.union_id,
    name: json.data.name,
    avatarUrl: json.data.avatar_url,
  };
}

export async function getTenantAccessTokenRaw(input: {
  domain: string;
  appId: string;
  appSecret: string;
}): Promise<{ tenantAccessToken: string; expiresIn: number }> {
  const res = await fetch(`${input.domain}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: input.appId, app_secret: input.appSecret }),
  });
  const json: any = await res.json();
  ensureLarkOk(json);
  return { tenantAccessToken: json.tenant_access_token, expiresIn: json.expire };
}
