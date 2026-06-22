import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { msUntilNext3amBeijing, refreshAllBoundLarkUsers } from './lark-token-refresh-cron.js';

describe('msUntilNext3amBeijing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns delay to today 19:00 UTC when called before it', () => {
    // 2026-05-28 10:00 UTC → next 19:00 UTC is 9h away
    vi.setSystemTime(new Date('2026-05-28T10:00:00Z'));
    expect(msUntilNext3amBeijing()).toBe(9 * 60 * 60 * 1000);
  });

  it('returns delay to tomorrow 19:00 UTC when called after it', () => {
    // 2026-05-28 20:00 UTC → next 19:00 UTC is 23h away (tomorrow)
    vi.setSystemTime(new Date('2026-05-28T20:00:00Z'));
    expect(msUntilNext3amBeijing()).toBe(23 * 60 * 60 * 1000);
  });

  it('rolls to tomorrow when called exactly at 19:00 UTC', () => {
    vi.setSystemTime(new Date('2026-05-28T19:00:00Z'));
    expect(msUntilNext3amBeijing()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('refreshAllBoundLarkUsers', () => {
  let logs: Array<[string, string]>;
  const log = (lvl: string, m: string): void => { logs.push([lvl, m]); };

  beforeEach(() => { logs = []; });

  function makeUser(handle: string, extra: Record<string, unknown> = {}): any {
    return { handle, teamId: 't', createdAt: 1, larkOpenId: `ou_${handle}`, larkRefreshToken: `rt_${handle}`, ...extra };
  }

  it('skips users with no Lark refresh token', async () => {
    const storage = {
      getAllUsers: vi.fn().mockResolvedValue([
        makeUser('bound'),
        { handle: 'unbound', teamId: 't', createdAt: 1 }, // no larkRefreshToken
      ]),
      getUser: vi.fn(),
    };
    const tokenManager = { getValidUserAccessToken: vi.fn().mockResolvedValue('access_tok') };

    const stats = await refreshAllBoundLarkUsers({ storage, tokenManager, publicUrl: 'https://r.x', log });

    expect(stats.bound).toBe(1);
    expect(stats.refreshed).toBe(1);
    expect(tokenManager.getValidUserAccessToken).toHaveBeenCalledTimes(1);
    expect(tokenManager.getValidUserAccessToken).toHaveBeenCalledWith('bound');
  });

  it('counts successful refreshes', async () => {
    const storage = {
      getAllUsers: vi.fn().mockResolvedValue([makeUser('a'), makeUser('b')]),
      getUser: vi.fn(),
    };
    const tokenManager = { getValidUserAccessToken: vi.fn().mockResolvedValue('tok') };

    const stats = await refreshAllBoundLarkUsers({ storage, tokenManager, publicUrl: 'https://r.x', log });
    expect(stats).toMatchObject({ bound: 2, refreshed: 2, expired: 0, transient: 0 });
  });

  it('classifies permanent expiry (unbound after refresh) and notifies via bot DM', async () => {
    const storage = {
      getAllUsers: vi.fn().mockResolvedValue([makeUser('gone')]),
      // After failed refresh, the token manager unbound the user → no refresh token
      getUser: vi.fn().mockResolvedValue({ handle: 'gone', teamId: 't', createdAt: 1, larkRefreshToken: undefined }),
    };
    const tokenManager = { getValidUserAccessToken: vi.fn().mockResolvedValue(null) };
    const apiClient = { get: vi.fn(), post: vi.fn().mockResolvedValue({}), patch: vi.fn() };

    const stats = await refreshAllBoundLarkUsers({ storage, tokenManager, apiClient, publicUrl: 'https://r.x', log });

    expect(stats).toMatchObject({ bound: 1, refreshed: 0, expired: 1, transient: 0 });
    // DM sent to the captured open_id
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    const [path, body] = apiClient.post.mock.calls[0];
    expect(path).toContain('/open-apis/im/v1/messages');
    expect(body.receive_id).toBe('ou_gone');
    expect(body.msg_type).toBe('text');
  });

  it('classifies transient failure (binding preserved) and does NOT notify', async () => {
    const storage = {
      getAllUsers: vi.fn().mockResolvedValue([makeUser('flaky')]),
      // Binding still has refresh token → transient
      getUser: vi.fn().mockResolvedValue(makeUser('flaky')),
    };
    const tokenManager = { getValidUserAccessToken: vi.fn().mockResolvedValue(null) };
    const apiClient = { get: vi.fn(), post: vi.fn().mockResolvedValue({}), patch: vi.fn() };

    const stats = await refreshAllBoundLarkUsers({ storage, tokenManager, apiClient, publicUrl: 'https://r.x', log });

    expect(stats).toMatchObject({ bound: 1, refreshed: 0, expired: 0, transient: 1 });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('survives a token-manager throw (counts as transient, continues)', async () => {
    const storage = {
      getAllUsers: vi.fn().mockResolvedValue([makeUser('boom'), makeUser('ok')]),
      getUser: vi.fn().mockResolvedValue(makeUser('boom')), // still bound
    };
    const tokenManager = {
      getValidUserAccessToken: vi.fn()
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce('tok'),
    };

    const stats = await refreshAllBoundLarkUsers({ storage, tokenManager, publicUrl: 'https://r.x', log });
    expect(stats).toMatchObject({ bound: 2, refreshed: 1, transient: 1 });
  });
});
