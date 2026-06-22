import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  signState, verifyState, newNonce,
  buildAuthorizeUrl, claimNonce, type NonceStore,
  exchangeCodeForTokens, refreshUserToken,
  fetchLarkUserInfo, getTenantAccessTokenRaw,
} from './lark-oauth.js';

const SECRET = 'test-state-secret-32bytes-min-aaaaaaaaaaa';

describe('lark-oauth — state', () => {
  it('signState produces a string with two dot-separated parts (payload + sig)', () => {
    const s = signState({ nonce: 'n1', intent: 'bind', exp: Date.now() + 60_000 }, SECRET);
    expect(s.split('.').length).toBe(2);
  });

  it('verifyState returns payload for fresh, well-signed state', () => {
    const payload = { nonce: 'n1', intent: 'bind' as const, handle: 'alice', exp: Date.now() + 60_000 };
    const s = signState(payload, SECRET);
    const result = verifyState(s, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toMatchObject(payload);
  });

  it('verifyState rejects expired state', () => {
    const s = signState({ nonce: 'n1', intent: 'bind', exp: Date.now() - 1000 }, SECRET);
    const result = verifyState(s, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('verifyState rejects bad signature (different secret)', () => {
    const s = signState({ nonce: 'n1', intent: 'bind', exp: Date.now() + 60_000 }, SECRET);
    const result = verifyState(s, 'different-secret-xxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_signature');
  });

  it('verifyState rejects malformed input', () => {
    expect(verifyState('not-a-state', SECRET).ok).toBe(false);
    expect(verifyState('', SECRET).ok).toBe(false);
    expect(verifyState('a.b.c', SECRET).ok).toBe(false);
  });

  it('newNonce produces non-empty unique strings', () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });
});

describe('lark-oauth — authorize URL', () => {
  it('buildAuthorizeUrl includes app_id, redirect_uri, scope, state', () => {
    const url = buildAuthorizeUrl({
      appId: 'cli_xxx',
      redirectUri: 'https://example.com/api/lark/callback',
      scopes: ['contact:user.id:readonly', 'contact:user.base:readonly'],
      state: 'signed-state-value',
      domain: 'https://open.feishu.cn',
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://open.feishu.cn');
    expect(parsed.pathname).toBe('/open-apis/authen/v1/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('cli_xxx');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://example.com/api/lark/callback');
    expect(parsed.searchParams.get('state')).toBe('signed-state-value');
    expect(parsed.searchParams.get('scope')).toBe('contact:user.id:readonly contact:user.base:readonly');
    expect(parsed.searchParams.get('response_type')).toBe('code');
  });
});

describe('lark-oauth — nonce store', () => {
  it('claimNonce returns true the first time and false the second within TTL', () => {
    const store: NonceStore = new Map();
    const future = Date.now() + 60_000;
    expect(claimNonce(store, 'n1', future)).toBe(true);
    expect(claimNonce(store, 'n1', future)).toBe(false);
    expect(claimNonce(store, 'n2', future)).toBe(true);
  });

  it('claimNonce prunes expired entries so a stale nonce can be re-used', () => {
    const store: NonceStore = new Map();
    const past = Date.now() - 1000;
    const future = Date.now() + 60_000;
    expect(claimNonce(store, 'n1', past)).toBe(true);     // accepted but immediately stale
    expect(claimNonce(store, 'n1', future)).toBe(true);   // pruned + re-accepted
    expect(claimNonce(store, 'n1', future)).toBe(false);  // now in TTL
  });
});

describe('lark-oauth — token exchange', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('exchangeCodeForTokens posts code to v2/oauth/token and returns parsed tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        access_token: 'u-at',
        refresh_token: 'u-rt',
        expires_in: 7200,
        refresh_expires_in: 30 * 86400,
        scope: 'contact:user.id:readonly contact:user.base:readonly',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const tokens = await exchangeCodeForTokens({
      domain: 'https://open.feishu.cn',
      appId: 'cli_x',
      appSecret: 'sec',
      code: 'C123',
      redirectUri: 'https://r/cb',
    });
    expect(tokens).toEqual({
      accessToken: 'u-at',
      refreshToken: 'u-rt',
      expiresIn: 7200,
      refreshExpiresIn: 30 * 86400,
      scopes: ['contact:user.id:readonly', 'contact:user.base:readonly'],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://open.feishu.cn/open-apis/authen/v2/oauth/token');
    expect(init?.method).toBe('POST');
    const body = JSON.parse((init as any).body);
    expect(body).toMatchObject({ grant_type: 'authorization_code', code: 'C123', client_id: 'cli_x' });
  });

  it('exchangeCodeForTokens throws on non-zero code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 99991663, msg: 'bad code' }),
    }));
    await expect(exchangeCodeForTokens({
      domain: 'https://open.feishu.cn',
      appId: 'a',
      appSecret: 's',
      code: 'C',
      redirectUri: 'r',
    })).rejects.toThrow(/bad code/);
  });

  it('refreshUserToken returns refreshed tokens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        access_token: 'u-at-new',
        refresh_token: 'u-rt-new',
        expires_in: 7200,
        refresh_expires_in: 30 * 86400,
        scope: 'contact:user.id:readonly',
      }),
    }));
    const tokens = await refreshUserToken({
      domain: 'https://open.feishu.cn',
      appId: 'cli_x',
      appSecret: 'sec',
      refreshToken: 'u-rt-old',
    });
    expect(tokens.accessToken).toBe('u-at-new');
    expect(tokens.refreshToken).toBe('u-rt-new');
  });

  it('fetchLarkUserInfo returns identity fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          open_id: 'ou_xyz',
          union_id: 'on_xyz',
          name: 'Alice',
          avatar_url: 'https://cdn/x.png',
        },
      }),
    }));
    const info = await fetchLarkUserInfo({
      domain: 'https://open.feishu.cn',
      accessToken: 'u-at',
    });
    expect(info).toEqual({
      openId: 'ou_xyz',
      unionId: 'on_xyz',
      name: 'Alice',
      avatarUrl: 'https://cdn/x.png',
    });
  });

  it('getTenantAccessTokenRaw returns app token + expires_in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, tenant_access_token: 't-at', expire: 7200 }),
    }));
    const r = await getTenantAccessTokenRaw({
      domain: 'https://open.feishu.cn',
      appId: 'cli_x',
      appSecret: 'sec',
    });
    expect(r).toEqual({ tenantAccessToken: 't-at', expiresIn: 7200 });
  });
});
