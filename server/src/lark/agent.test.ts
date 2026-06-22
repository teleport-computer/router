import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgent, _resetRateLimitForTest, _checkRateForTest } from './agent.js';
import type { LarkApiClient } from './api-client.js';
import type { Storage } from '../storage.js';

beforeEach(() => {
  _resetRateLimitForTest();
});

describe('checkRate', () => {
  it('group mode: 1 per minute', () => {
    const now = 1_000_000;
    expect(_checkRateForTest('chat-1', now, 'group')).toBe(true);
    expect(_checkRateForTest('chat-1', now + 100, 'group')).toBe(false);
    expect(_checkRateForTest('chat-1', now + 60_001, 'group')).toBe(true);
  });

  it('p2p mode: 5 per minute', () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(_checkRateForTest('chat-2', now + i * 100, 'p2p')).toBe(true);
    }
    expect(_checkRateForTest('chat-2', now + 1000, 'p2p')).toBe(false);
  });

  it('p2p window resets after 60s', () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      _checkRateForTest('chat-3', now + i * 100, 'p2p');
    }
    // After 60s, oldest entry expires → 1 slot free
    expect(_checkRateForTest('chat-3', now + 60_001, 'p2p')).toBe(true);
  });

  it('different chat ids isolated', () => {
    const now = 1_000_000;
    expect(_checkRateForTest('chat-a', now, 'group')).toBe(true);
    expect(_checkRateForTest('chat-b', now, 'group')).toBe(true);
  });
});

describe('runAgent rateLimited return', () => {
  function makeDeps(): any {
    return {
      storage: {} as Storage,
      apiClient: { post: vi.fn(), patch: vi.fn(), get: vi.fn() } as any as LarkApiClient,
      llmModel: 'test',
      llmApiKey: 'k',
      publicUrl: 'https://r.test',
    };
  }

  it('returns { rateLimited: true } when p2p exceeds limit', async () => {
    const deps = makeDeps();
    const now = 1_000_000;
    // Burn 5 slots
    for (let i = 0; i < 5; i++) {
      await runAgent({ chatId: 'c1', senderOpenId: 'o1', text: 'hi' }, deps, { mode: 'p2p', now: now + i });
    }
    const result = await runAgent(
      { chatId: 'c1', senderOpenId: 'o1', text: 'hi' },
      deps,
      { mode: 'p2p', now: now + 100 },
    );
    expect(result).toEqual({ rateLimited: true });
  });

  it('returns void when group exceeds limit (legacy behavior)', async () => {
    const deps = makeDeps();
    const now = 1_000_000;
    await runAgent({ chatId: 'g1', senderOpenId: 'o1', text: 'hi' }, deps, { mode: 'group', now });
    const result = await runAgent(
      { chatId: 'g1', senderOpenId: 'o1', text: 'hi' },
      deps,
      { mode: 'group', now: now + 100 },
    );
    expect(result).toBeUndefined();
  });

  it('default mode is group', async () => {
    const deps = makeDeps();
    const now = 1_000_000;
    await runAgent({ chatId: 'g2', senderOpenId: 'o1', text: 'hi' }, deps, { now });
    const result = await runAgent(
      { chatId: 'g2', senderOpenId: 'o1', text: 'hi' },
      deps,
      { now: now + 100 },
    );
    expect(result).toBeUndefined();
  });
});
