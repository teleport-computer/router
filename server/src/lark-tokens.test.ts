import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryStorage } from './storage.js';
import { createTokenManager } from './lark-tokens.js';

const CONFIG = {
  domain: 'https://open.feishu.cn',
  appId: 'cli_x',
  appSecret: 'sec',
};

async function makeUserBound(storage: MemoryStorage, refreshToken: string) {
  await storage.createTeam({ id: 't1', name: 'T', createdBy: 'a', createdAt: 0 });
  await storage.createUser({ handle: 'alice', secretKeyHash: 'h', teamId: 't1' });
  await storage.bindLarkAccount('alice', {
    larkOpenId: 'ou_xyz',
    larkRefreshToken: refreshToken,
    larkRefreshTokenExpiresAt: Date.now() + 30 * 86400 * 1000,
    larkScopes: [],
    larkBoundAt: Date.now(),
  });
}

describe('lark-tokens — getValidUserAccessToken', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('refreshes via refresh_token, persists new refresh_token, returns new access_token', async () => {
    const storage = new MemoryStorage();
    await makeUserBound(storage, 'rt-old');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        access_token: 'at-new',
        refresh_token: 'rt-new',
        expires_in: 7200,
        refresh_expires_in: 30 * 86400,
        scope: '',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const tm = createTokenManager(storage, CONFIG);
    const at = await tm.getValidUserAccessToken('alice');
    expect(at).toBe('at-new');

    const u = await storage.getUser('alice');
    expect(u?.larkRefreshToken).toBe('rt-new');
  });

  it('returns null and clears lark fields when refresh fails', async () => {
    const storage = new MemoryStorage();
    await makeUserBound(storage, 'rt-bad');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 20021, msg: 'invalid_refresh_token' }),
    }));

    const tm = createTokenManager(storage, CONFIG);
    const at = await tm.getValidUserAccessToken('alice');
    expect(at).toBeNull();

    const u = await storage.getUser('alice');
    expect(u?.larkOpenId).toBeUndefined();
    expect(u?.larkRefreshToken).toBeUndefined();
  });

  it('returns null when user has no binding', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 'T', createdBy: 'a', createdAt: 0 });
    await storage.createUser({ handle: 'alice', secretKeyHash: 'h', teamId: 't1' });

    const tm = createTokenManager(storage, CONFIG);
    expect(await tm.getValidUserAccessToken('alice')).toBeNull();
  });
});

describe('lark-tokens — getTenantAccessToken (cached)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('caches across calls within expiry window', async () => {
    const storage = new MemoryStorage();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, tenant_access_token: 't1', expire: 7200 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const tm = createTokenManager(storage, CONFIG);
    const a = await tm.getTenantAccessToken();
    const b = await tm.getTenantAccessToken();
    expect(a).toBe('t1');
    expect(b).toBe('t1');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
