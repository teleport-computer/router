import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { msUntilNextMonday10amBeijing, runConciergeForUser, runConciergeForAllUsers } from './concierge-cron.js';

describe('msUntilNextMonday10amBeijing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Reference: 2026-05-11 is a Monday, 2026-05-12 is a Tuesday.

  it('returns delay to today (Monday) 10am Beijing when called Monday before 10am', () => {
    // 2026-05-11 (Mon) 09:30 Beijing = 2026-05-11 01:30 UTC
    vi.setSystemTime(new Date('2026-05-11T01:30:00Z'));
    const delay = msUntilNextMonday10amBeijing();
    expect(delay).toBe(30 * 60 * 1000);
  });

  it('returns delay to next Monday when called Monday after 10am', () => {
    // 2026-05-11 (Mon) 10:01 Beijing = 2026-05-11 02:01 UTC
    vi.setSystemTime(new Date('2026-05-11T02:01:00Z'));
    const delay = msUntilNextMonday10amBeijing();
    // Next fire: 7 days later minus 1 minute
    expect(delay).toBe(7 * 24 * 60 * 60 * 1000 - 60 * 1000);
  });

  it('returns delay to upcoming Monday when called Tuesday afternoon', () => {
    // 2026-05-12 (Tue) 14:00 Beijing = 2026-05-12 06:00 UTC
    vi.setSystemTime(new Date('2026-05-12T06:00:00Z'));
    const delay = msUntilNextMonday10amBeijing();
    // Tue 06:00 UTC → next Mon 02:00 UTC: 6 days - 4h = 5d 20h
    expect(delay).toBe((6 * 24 - 4) * 60 * 60 * 1000);
  });

  it('returns delay to next Monday when called Sunday evening', () => {
    // 2026-05-10 (Sun) 23:00 Beijing = 2026-05-10 15:00 UTC → next Mon 02:00 UTC = 11 hours later
    vi.setSystemTime(new Date('2026-05-10T15:00:00Z'));
    const delay = msUntilNextMonday10amBeijing();
    expect(delay).toBe(11 * 60 * 60 * 1000);
  });

  it('returns full week when called exactly at Monday 10am Beijing', () => {
    // Already at Monday 10am Beijing → next fire is next Monday
    vi.setSystemTime(new Date('2026-05-11T02:00:00Z'));
    const delay = msUntilNextMonday10amBeijing();
    expect(delay).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('runConciergeForUser', () => {
  let mockStorage: any;
  let mockApiClient: any;
  let logCalls: Array<[string, string]>;
  const log = (lvl: string, m: string) => { logCalls.push([lvl, m]); };

  beforeEach(() => {
    logCalls = [];
    mockApiClient = { post: vi.fn().mockResolvedValue(undefined) };
    mockStorage = {
      // computeUserRecap reads from these
      getEntriesSince: vi.fn().mockResolvedValue([]),
      getSubscribedChannels: vi.fn().mockResolvedValue([]),
      getChannelEntries: vi.fn().mockResolvedValue([]),
      getEntriesByHandle: vi.fn().mockResolvedValue([]),
      getEntriesByTags: vi.fn().mockResolvedValue([]),
      // we read user separately; assume passed in
      getUser: vi.fn(),
      updateUser: vi.fn().mockResolvedValue(undefined),
      // dispatch writes inbox via addNotification
      addNotification: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('skips users with conciergeRecapEnabled === false', async () => {
    const user: any = {
      handle: 'hx', teamId: 't1',
      conciergeRecapEnabled: false,
      lastConciergeSeenAt: 0,
    };
    const result = await runConciergeForUser({
      storage: mockStorage, apiClient: mockApiClient,
      user, publicUrl: 'https://x', log,
    });
    expect(result).toBe('opted-out');
    expect(mockStorage.updateUser).not.toHaveBeenCalled();
    expect(mockApiClient.post).not.toHaveBeenCalled();
  });

  it('skips users with empty recap (totalItems === 0)', async () => {
    const user: any = { handle: 'hx', teamId: 't1', lastConciergeSeenAt: 0 };
    // mocks default to all-empty arrays → empty recap
    const result = await runConciergeForUser({
      storage: mockStorage, apiClient: mockApiClient,
      user, publicUrl: 'https://x', log,
    });
    expect(result).toBe('empty-skip');
    expect(mockStorage.updateUser).not.toHaveBeenCalled();
    expect(mockApiClient.post).not.toHaveBeenCalled();
  });

  it('updates lastConciergeSeenAt when recap has daily-brief content (milestone)', async () => {
    const user: any = { handle: 'hx', teamId: 't1', lastConciergeSeenAt: 0, larkOpenId: 'ou_x' };
    // Inject a milestone-tagged entry — these count toward daily-brief content
    // (mentions/replies alone would trigger 'empty-skip' per new architecture).
    mockStorage.getEntriesSince.mockResolvedValueOnce([
      { id: 'e1', handle: 'andrew', teamId: 't1', summary: 'KnowMate v0.9 launched', content: '', tags: ['milestone'], timestamp: Date.now(), to: [] },
    ]);
    const result = await runConciergeForUser({
      storage: mockStorage, apiClient: mockApiClient,
      user, publicUrl: 'https://x', log,
    });
    expect(result).toBe('pushed');
    expect(mockStorage.updateUser).toHaveBeenCalledWith('hx', expect.objectContaining({ lastConciergeSeenAt: expect.any(Number) }));
  });

  it('returns empty-skip when only mentions/replies present (those go realtime)', async () => {
    const user: any = { handle: 'hx', teamId: 't1', lastConciergeSeenAt: 0 };
    // ONLY a mention — no channels / milestones / related → daily skip
    mockStorage.getEntriesSince.mockResolvedValueOnce([
      { id: 'e1', handle: 'andrew', teamId: 't1', summary: '@hx please review', content: '', tags: [], timestamp: Date.now(), to: [] },
    ]);
    const result = await runConciergeForUser({
      storage: mockStorage, apiClient: mockApiClient,
      user, publicUrl: 'https://x', log,
    });
    expect(result).toBe('empty-skip');
    expect(mockStorage.updateUser).not.toHaveBeenCalled();
    expect(mockApiClient.post).not.toHaveBeenCalled();
  });

  it('writes inbox but skips Lark push when user has no larkOpenId (M-4)', async () => {
    // No larkOpenId on the user → can't push to Lark, but inbox should still get written.
    const user: any = { handle: 'hx', teamId: 't1', lastConciergeSeenAt: 0 };
    mockStorage.getEntriesSince.mockResolvedValueOnce([
      { id: 'e1', handle: 'andrew', teamId: 't1', summary: 'shipped v2', content: '', tags: ['milestone'], timestamp: Date.now(), to: [] },
    ]);
    const result = await runConciergeForUser({
      storage: mockStorage, apiClient: mockApiClient,
      user, publicUrl: 'https://x', log,
    });
    expect(result).toBe('pushed');
    expect(mockStorage.addNotification).toHaveBeenCalledTimes(1); // inbox written
    expect(mockApiClient.post).not.toHaveBeenCalled();             // no Lark call
    expect(mockStorage.updateUser).toHaveBeenCalled();              // lastSeen still bumped
  });

  it('writes inbox but skips Lark push when user has digest pref off (M-4)', async () => {
    // User has Lark binding but explicitly opted out of digest push.
    const user: any = {
      handle: 'hx',
      teamId: 't1',
      lastConciergeSeenAt: 0,
      larkOpenId: 'ou_x',
      larkNotificationPrefs: { digest: false },
    };
    mockStorage.getEntriesSince.mockResolvedValueOnce([
      { id: 'e1', handle: 'andrew', teamId: 't1', summary: 'shipped v2', content: '', tags: ['milestone'], timestamp: Date.now(), to: [] },
    ]);
    const result = await runConciergeForUser({
      storage: mockStorage, apiClient: mockApiClient,
      user, publicUrl: 'https://x', log,
    });
    expect(result).toBe('pushed');
    expect(mockStorage.addNotification).toHaveBeenCalledTimes(1); // inbox written
    expect(mockApiClient.post).not.toHaveBeenCalled();             // explicit opt-out → no push
    expect(mockStorage.updateUser).toHaveBeenCalled();
    // log surface confirms the explicit "pref off" branch fired (vs no-binding silent skip)
    expect(logCalls.some(([lvl, m]) => lvl === 'info' && m.includes('pref off'))).toBe(true);
  });

  it('catches per-user errors and reports without throwing', async () => {
    mockStorage.getEntriesSince.mockRejectedValueOnce(new Error('DB down'));
    const user: any = { handle: 'hx', teamId: 't1', lastConciergeSeenAt: 0 };
    const result = await runConciergeForUser({
      storage: mockStorage, apiClient: mockApiClient,
      user, publicUrl: 'https://x', log,
    });
    expect(result).toBe('error');
    expect(logCalls.some(([lvl, m]) => lvl === 'warn' && m.includes('DB down'))).toBe(true);
  });
});

describe('runConciergeForAllUsers', () => {
  let mockStorage: any;
  let mockApiClient: any;
  let logCalls: Array<[string, string]>;
  const log = (lvl: string, m: string) => { logCalls.push([lvl, m]); };

  beforeEach(() => {
    logCalls = [];
    mockApiClient = { post: vi.fn().mockResolvedValue(undefined) };
    mockStorage = {
      getAllUsers: vi.fn(),
      getEntriesSince: vi.fn().mockResolvedValue([]),
      getSubscribedChannels: vi.fn().mockResolvedValue([]),
      getChannelEntries: vi.fn().mockResolvedValue([]),
      getEntriesByHandle: vi.fn().mockResolvedValue([]),
      getEntriesByTags: vi.fn().mockResolvedValue([]),
      updateUser: vi.fn().mockResolvedValue(undefined),
      addNotification: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('iterates all users and counts outcomes', async () => {
    mockStorage.getAllUsers.mockResolvedValueOnce([
      { handle: 'a', teamId: 't1', conciergeRecapEnabled: false },  // opted-out
      { handle: 'b', teamId: 't1', lastConciergeSeenAt: 0 },         // empty-skip (no entries)
    ]);

    const stats = await runConciergeForAllUsers({
      storage: mockStorage, apiClient: mockApiClient,
      publicUrl: 'https://x', log,
    });

    expect(stats).toEqual({ total: 2, pushed: 0, emptySkip: 1, optedOut: 1, errors: 0 });
  });

  it('errors in one user do not block others', async () => {
    mockStorage.getAllUsers.mockResolvedValueOnce([
      { handle: 'a', teamId: 't1', lastConciergeSeenAt: 0 },
      { handle: 'b', teamId: 't1', lastConciergeSeenAt: 0 },
    ]);
    // Sequence (single team t1, batched): team-level call → user a → user b
    mockStorage.getEntriesSince
      .mockRejectedValueOnce(new Error('DB transient'))   // 1. team t1 level (caught, teamEntries=[])
      .mockRejectedValueOnce(new Error('DB transient'))   // 2. user a's computeUserRecap → 'error'
      .mockResolvedValueOnce([]);                          // 3. user b's computeUserRecap → 'empty-skip'

    const stats = await runConciergeForAllUsers({
      storage: mockStorage, apiClient: mockApiClient,
      publicUrl: 'https://x', log,
    });

    expect(stats.errors).toBe(1);
    expect(stats.emptySkip).toBe(1);
    expect(stats.total).toBe(2);
  });

  it('calls LLM team overview once per team (not per user) when callLLM provided', async () => {
    mockStorage.getAllUsers.mockResolvedValueOnce([
      { handle: 'a', teamId: 't1', lastConciergeSeenAt: 0 },
      { handle: 'b', teamId: 't1', lastConciergeSeenAt: 0 },
      { handle: 'c', teamId: 't2', lastConciergeSeenAt: 0 },
    ]);
    // Every getEntriesSince call returns one milestone-tagged entry — both
    // team-level calls (used for team-overview LLM) AND per-user computeUserRecap
    // calls. Personal-callout LLM is gated on getEntriesByHandle returning
    // non-empty (which it doesn't here, default []), so it never fires.
    mockStorage.getEntriesSince.mockResolvedValue([
      { id: 'e1', handle: 'x', teamId: 't1', summary: 's', content: '', tags: ['milestone'], timestamp: Date.now(), to: [] },
    ]);

    const callLLM = vi.fn().mockResolvedValue('Synthesized team overview.');

    await runConciergeForAllUsers({
      storage: mockStorage, apiClient: mockApiClient,
      publicUrl: 'https://x', log, callLLM,
    });

    // Exactly 2 LLM calls: 1 team-overview per team (t1 + t2). Personal-callout
    // LLM short-circuits because getEntriesByHandle returns [].
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it('dryRun=true: targets users + returns stats but NO side effects', async () => {
    mockStorage.getAllUsers.mockResolvedValueOnce([
      { handle: 'a', teamId: 't1', conciergeRecapEnabled: false },           // opted-out
      { handle: 'b', teamId: 't1', lastConciergeSeenAt: 0, larkOpenId: 'ou_b' }, // would-push
      { handle: 'c', teamId: 't1', lastConciergeSeenAt: 0 },                 // empty-skip (no entries)
    ]);
    // Inject a milestone for the team-level getEntriesSince call so user b
    // crosses the empty-skip threshold.
    mockStorage.getEntriesSince.mockResolvedValue([
      { id: 'e1', handle: 'x', teamId: 't1', summary: 's', content: '', tags: ['milestone'], timestamp: Date.now(), to: [] },
    ]);
    const callLLM = vi.fn().mockResolvedValue('synthesized');

    const stats = await runConciergeForAllUsers({
      storage: mockStorage, apiClient: mockApiClient,
      publicUrl: 'https://x', log, callLLM,
      dryRun: true,
    });

    // Stats correctly classify each user. Total = 3 (a opted-out + b/c both
    // cross the empty-skip threshold via the shared milestone-tagged entry).
    // Exact pushed-vs-empty-skip split for b/c depends on computeUserRecap
    // internals; what matters for dryRun is the side-effect assertions below.
    expect(stats.total).toBe(3);
    expect(stats.optedOut).toBe(1);
    expect(stats.pushed + stats.emptySkip).toBe(2);

    // ZERO side effects:
    expect(callLLM).not.toHaveBeenCalled();              // team-overview LLM skipped
    expect(mockApiClient.post).not.toHaveBeenCalled();   // no Lark push
    expect(mockStorage.addNotification).not.toHaveBeenCalled(); // no inbox
    expect(mockStorage.updateUser).not.toHaveBeenCalled();      // no lastSeen bump
  });
});
