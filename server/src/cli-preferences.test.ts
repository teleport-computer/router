import { describe, it, expect } from 'vitest';
import { validatePatch, userToPreferences } from './cli-preferences.js';

describe('validatePatch', () => {
  it('accepts valid sync_mode', () => {
    expect(validatePatch({ sync_mode: 'passive' })).toEqual({ ok: true, value: { sync_mode: 'passive' } });
  });
  it('rejects invalid sync_mode', () => {
    expect(validatePatch({ sync_mode: 'wat' })).toEqual({ ok: false, error: 'invalid_sync_mode' });
  });
  it('rejects non-string array entries', () => {
    expect(validatePatch({ privacy_strip_custom: [1, 2] })).toEqual({ ok: false, error: 'invalid_privacy_strip_custom' });
  });
});

describe('userToPreferences', () => {
  it('uses defaults for missing fields', () => {
    const out = userToPreferences({ handle: 'x', secretKeyHash: '', teamId: '', createdAt: 0 } as any);
    expect(out).toEqual({ sync_mode: 'active', preview_mode: 'always', privacy_strip_custom: [] });
  });
});
