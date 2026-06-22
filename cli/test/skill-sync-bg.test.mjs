import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// We can't easily test backgroundSyncSkill without mocking fetch + filesystem,
// so this is a basic invocation smoke test. End-to-end is exercised in
// Task 27 manual smoke.

describe('backgroundSyncSkill', () => {
  beforeEach(() => { global.fetch = vi.fn(); });

  it('returns "throttled" when within 24h cache', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({}), json: async () => ({ version: '1.0.0', hash: 'sha256:x', content: 'x' }) });
    const { backgroundSyncSkill } = await import('../src/skill-sync.mjs');
    const result = await backgroundSyncSkill({ cfg: { server: 'https://x.com', last_skill_check_at: Date.now() - 1000 }, cliVersion: '1.0.0' });
    expect(result).toBe('throttled');
  });

  it('returns "skipped" when server fetch fails (so caller can retry)', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, headers: new Headers({}), text: async () => 'oops', json: async () => ({}) });
    const { backgroundSyncSkill } = await import('../src/skill-sync.mjs');
    const result = await backgroundSyncSkill({ cfg: { server: 'https://x.com', last_skill_check_at: 0 }, cliVersion: '1.0.0' });
    expect(result).toBe('skipped');
  });
});
