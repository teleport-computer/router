import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('buildServerInfo', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('platforms is empty when LARK_BOT_ENABLED unset', async () => {
    delete process.env.LARK_BOT_ENABLED;
    const { buildServerInfo } = await import('./server-info.js');
    expect(buildServerInfo().features.platforms).toEqual([]);
  });

  it('platforms includes "lark" only when LARK_BOT_ENABLED is exactly "true"', async () => {
    const { buildServerInfo } = await import('./server-info.js');
    process.env.LARK_BOT_ENABLED = 'true';
    expect(buildServerInfo().features.platforms).toContain('lark');
    process.env.LARK_BOT_ENABLED = 'false';
    expect(buildServerInfo().features.platforms).not.toContain('lark');
    process.env.LARK_BOT_ENABLED = '1';
    expect(buildServerInfo().features.platforms).not.toContain('lark');
  });

  it('defaults languages to ["en","zh"] when LOCALES_AVAILABLE unset', async () => {
    delete process.env.LOCALES_AVAILABLE;
    const { buildServerInfo } = await import('./server-info.js');
    expect(buildServerInfo().features.languages).toEqual(['en', 'zh']);
  });

  it('parses LOCALES_AVAILABLE as comma-separated, trimmed, filtered', async () => {
    process.env.LOCALES_AVAILABLE = 'en';
    const { buildServerInfo } = await import('./server-info.js');
    expect(buildServerInfo().features.languages).toEqual(['en']);
    process.env.LOCALES_AVAILABLE = ' en , zh ,';
    expect(buildServerInfo().features.languages).toEqual(['en', 'zh']);
  });

  it('always returns site_name "Teleport Router"', async () => {
    const { buildServerInfo } = await import('./server-info.js');
    expect(buildServerInfo().site_name).toBe('Teleport Router');
  });
});
