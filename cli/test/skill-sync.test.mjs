import { describe, it, expect, vi } from 'vitest';
import { decideSyncAction } from '../src/skill-sync.mjs';

const ONE_DAY_MS = 24 * 3600 * 1000;

describe('decideSyncAction', () => {
  it('skip when within 24h cache', () => {
    const r = decideSyncAction({ now: 1_000_000, lastCheckAt: 1_000_000 - 1000, localHash: 'x', localVersion: '1.0', serverVersion: '1.0' });
    expect(r).toEqual({ kind: 'skip', reason: 'cache_valid' });
  });

  it('skip when versions match', () => {
    const r = decideSyncAction({ now: 1_000_000 + 2 * ONE_DAY_MS, lastCheckAt: 0, localHash: 'x', localVersion: '1.0', serverVersion: '1.0' });
    expect(r).toEqual({ kind: 'skip', reason: 'versions_match' });
  });

  it('fetch when versions differ and cache expired', () => {
    const r = decideSyncAction({ now: 1_000_000 + 2 * ONE_DAY_MS, lastCheckAt: 0, localHash: 'x', localVersion: '1.0', serverVersion: '1.1' });
    expect(r.kind).toBe('fetch');
  });

  it('fetch when no local skill found', () => {
    const r = decideSyncAction({ now: 1_000_000 + 2 * ONE_DAY_MS, lastCheckAt: 0, localHash: null, localVersion: null, serverVersion: '1.0' });
    expect(r.kind).toBe('fetch');
  });
});
