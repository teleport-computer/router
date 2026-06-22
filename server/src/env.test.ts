import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('requireEnv', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns the env value when set', async () => {
    process.env.MY_VAR = 'hello';
    const { requireEnv } = await import('./env.js');
    expect(requireEnv('MY_VAR')).toBe('hello');
  });

  it('throws in production when missing', async () => {
    delete process.env.MY_VAR;
    process.env.NODE_ENV = 'production';
    const { requireEnv } = await import('./env.js');
    expect(() => requireEnv('MY_VAR')).toThrow(/MY_VAR/);
  });

  it('warns and returns empty string in dev when missing', async () => {
    delete process.env.MY_VAR;
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { requireEnv } = await import('./env.js');
    expect(requireEnv('MY_VAR')).toBe('');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MY_VAR'));
  });

  it('returns empty string silently in test', async () => {
    delete process.env.MY_VAR;
    process.env.NODE_ENV = 'test';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { requireEnv } = await import('./env.js');
    expect(requireEnv('MY_VAR')).toBe('');
    expect(warn).not.toHaveBeenCalled();
  });
});
