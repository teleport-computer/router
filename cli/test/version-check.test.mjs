import { describe, it, expect } from 'vitest';
import { compareVersions, decideAction } from '../src/version-check.mjs';

describe('compareVersions', () => {
  it('1.0.0 < 1.0.1', () => expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0));
  it('1.2.0 > 1.0.99', () => expect(compareVersions('1.2.0', '1.0.99')).toBeGreaterThan(0));
  it('1.0.0 == 1.0.0', () => expect(compareVersions('1.0.0', '1.0.0')).toBe(0));
});

describe('decideAction', () => {
  it('latest equals current → none', () => {
    expect(decideAction('1.2.0', { latest: '1.2.0', minSupported: '1.0.0' })).toEqual({ kind: 'none' });
  });
  it('current < min supported → block', () => {
    expect(decideAction('0.9.0', { latest: '1.2.0', minSupported: '1.0.0' })).toEqual({ kind: 'block', latest: '1.2.0' });
  });
  it('current < latest, >= min → soft warn', () => {
    expect(decideAction('1.0.0', { latest: '1.2.0', minSupported: '1.0.0' })).toEqual({ kind: 'soft', latest: '1.2.0' });
  });
  it('headers missing → none', () => {
    expect(decideAction('1.0.0', { latest: null, minSupported: null })).toEqual({ kind: 'none' });
  });
});
