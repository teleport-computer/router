import { describe, it, expect } from 'vitest';
import {
  makePendingRegToken,
  getPendingReg,
  putPendingReg,
  consumePendingReg,
  DEFAULT_PENDING_TTL_MS,
  type PendingLarkStore,
  type PendingLarkRegistration,
} from './lark-pending.js';

function fakeReg(overrides: Partial<PendingLarkRegistration> = {}): PendingLarkRegistration {
  return {
    openId: 'ou_xyz',
    name: 'Alice',
    avatarUrl: 'https://cdn/x.png',
    refreshToken: 'rt-1',
    refreshExpiresAt: Date.now() + 30 * 86400 * 1000,
    scopes: ['contact:user.id:readonly'],
    expiresAt: Date.now() + DEFAULT_PENDING_TTL_MS,
    ...overrides,
  };
}

describe('lark-pending — token format', () => {
  it('generates rs_-distinct tokens with plr_ prefix', () => {
    const a = makePendingRegToken();
    const b = makePendingRegToken();
    expect(a).toMatch(/^plr_/);
    expect(b).toMatch(/^plr_/);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });
});

describe('lark-pending — get / put / consume', () => {
  it('put then get returns the row', () => {
    const store: PendingLarkStore = new Map();
    const t = 'plr_abc';
    putPendingReg(store, t, fakeReg());
    expect(getPendingReg(store, t)?.openId).toBe('ou_xyz');
  });

  it('get returns null for unknown token', () => {
    const store: PendingLarkStore = new Map();
    expect(getPendingReg(store, 'plr_unknown')).toBeNull();
  });

  it('consume removes the row', () => {
    const store: PendingLarkStore = new Map();
    putPendingReg(store, 'plr_a', fakeReg());
    consumePendingReg(store, 'plr_a');
    expect(getPendingReg(store, 'plr_a')).toBeNull();
  });
});

describe('lark-pending — expiry / lazy prune', () => {
  it('returns null when the requested row is expired', () => {
    const store: PendingLarkStore = new Map();
    putPendingReg(store, 'plr_old', fakeReg({ expiresAt: Date.now() - 1000 }));
    expect(getPendingReg(store, 'plr_old')).toBeNull();
  });

  it('lazy-prunes ALL expired rows on each get call (size bounded)', () => {
    const store: PendingLarkStore = new Map();
    const past = Date.now() - 1000;
    const future = Date.now() + 60_000;

    putPendingReg(store, 'plr_old1', fakeReg({ expiresAt: past }));
    putPendingReg(store, 'plr_old2', fakeReg({ expiresAt: past }));
    putPendingReg(store, 'plr_fresh', fakeReg({ expiresAt: future }));
    expect(store.size).toBe(3);

    // Probe an unrelated key — prune still runs
    getPendingReg(store, 'plr_does_not_exist');
    expect(store.size).toBe(1);
    expect(store.has('plr_fresh')).toBe(true);
  });

  it('synthetic now lets test fast-forward expiry', () => {
    const store: PendingLarkStore = new Map();
    const t0 = 1_000_000;
    putPendingReg(store, 'plr_t', fakeReg({ expiresAt: t0 + 5000 }));

    expect(getPendingReg(store, 'plr_t', t0)).not.toBeNull();
    expect(getPendingReg(store, 'plr_t', t0 + 5001)).toBeNull(); // pruned
  });
});

describe('lark-pending — race / multi-token', () => {
  it('multiple pending tokens for different OAuth attempts coexist', () => {
    const store: PendingLarkStore = new Map();
    putPendingReg(store, 'plr_a', fakeReg({ openId: 'ou_a' }));
    putPendingReg(store, 'plr_b', fakeReg({ openId: 'ou_b' }));
    expect(getPendingReg(store, 'plr_a')?.openId).toBe('ou_a');
    expect(getPendingReg(store, 'plr_b')?.openId).toBe('ou_b');
  });

  it('consume of one token does not affect siblings', () => {
    const store: PendingLarkStore = new Map();
    putPendingReg(store, 'plr_a', fakeReg());
    putPendingReg(store, 'plr_b', fakeReg());
    consumePendingReg(store, 'plr_a');
    expect(getPendingReg(store, 'plr_a')).toBeNull();
    expect(getPendingReg(store, 'plr_b')).not.toBeNull();
  });
});
