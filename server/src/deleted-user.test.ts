import { describe, it, expect } from 'vitest';
import {
  generateDeletedHandle,
  isDeletedHandle,
  isReservedHandlePattern,
} from './deleted-user.js';
import { isValidHandle } from './identity.js';

describe('generateDeletedHandle', () => {
  it('returns _deleted_<6 hex chars>', () => {
    const h = generateDeletedHandle();
    expect(h).toMatch(/^_deleted_[0-9a-f]{6}$/);
  });

  it('is unique across calls (random suffix, not deterministic)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 50; i++) set.add(generateDeletedHandle());
    // 50 random 24-bit values: collision probability ~5e-5; if this ever
    // flakes, the universe has a problem (or randomBytes is broken).
    expect(set.size).toBe(50);
  });
});

describe('isDeletedHandle', () => {
  it('matches generated placeholders', () => {
    expect(isDeletedHandle('_deleted_a3f9b2')).toBe(true);
    expect(isDeletedHandle(generateDeletedHandle())).toBe(true);
  });

  it('rejects regular handles', () => {
    expect(isDeletedHandle('hx')).toBe(false);
    expect(isDeletedHandle('amiller')).toBe(false);
    expect(isDeletedHandle('router-bot')).toBe(false);
  });

  it('rejects near-misses', () => {
    expect(isDeletedHandle('_deleted_')).toBe(false);            // no suffix
    expect(isDeletedHandle('_deleted_xyz')).toBe(false);          // not hex
    expect(isDeletedHandle('_deleted_a3f9b2a')).toBe(false);      // suffix too long
    expect(isDeletedHandle('_deleted_a3f9b')).toBe(false);        // suffix too short
    expect(isDeletedHandle('deleted_a3f9b2')).toBe(false);        // missing leading _
    expect(isDeletedHandle('foo_deleted_a3f9b2')).toBe(false);    // not at start
  });
});

describe('placeholder vs isValidHandle interaction', () => {
  // The whole defense rests on: a generated placeholder MUST fail the
  // standard registration validation. If isValidHandle is loosened to
  // permit `_` prefix in the future, this test fires the alarm and the
  // explicit isReservedHandlePattern check at registration sites kicks in.
  it('placeholders are NOT valid registration handles', () => {
    expect(isValidHandle('_deleted_a3f9b2')).toBe(false);
  });

  it('isReservedHandlePattern catches what isValidHandle would miss if loosened', () => {
    expect(isReservedHandlePattern('_deleted_a3f9b2')).toBe(true);
    expect(isReservedHandlePattern('hx')).toBe(false);
  });
});
