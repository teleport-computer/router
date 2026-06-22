import { describe, expect, it } from 'vitest';
import { createSummaryTokenCache } from './summary-token-cache.js';

const baseData = {
  summary: { tldr: 't', updates: [], decisions: [], todo: [], open_questions: [], tags: [] },
  interpretation: 'x',
  chatId: 'oc_1',
  chatName: 'G',
  teamId: 't1',
  defaultArchiveChannelId: 'feedling',
  organizerOpenId: 'ou_x',
};

describe('summary-token-cache', () => {
  it('put returns a token; take retrieves the data once', () => {
    let now = 0;
    const cache = createSummaryTokenCache({ now: () => now });
    const token = cache.put({ ...baseData, generatedAt: now });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(10);
    const retrieved = cache.take(token);
    expect(retrieved?.chatId).toBe('oc_1');
    expect(cache.take(token)).toBeNull();
  });

  it('returns null for unknown token', () => {
    const cache = createSummaryTokenCache({ now: () => 0 });
    expect(cache.take('nonexistent')).toBeNull();
  });

  it('expires entries after TTL (default 1h)', () => {
    let now = 0;
    const cache = createSummaryTokenCache({ now: () => now });
    const token = cache.put({ ...baseData, generatedAt: now });
    now = 60 * 60 * 1000 + 1;
    expect(cache.take(token)).toBeNull();
  });
});
