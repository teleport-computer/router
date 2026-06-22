import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiCall, parseVersionHeaders } from '../src/api.mjs';

describe('parseVersionHeaders', () => {
  it('extracts latest and min-supported', () => {
    const h = new Headers({ 'X-Router-CLI-Latest': '1.2.0', 'X-Router-CLI-Min-Supported': '1.0.0' });
    expect(parseVersionHeaders(h)).toEqual({ latest: '1.2.0', minSupported: '1.0.0' });
  });
  it('returns nulls when headers absent', () => {
    expect(parseVersionHeaders(new Headers({}))).toEqual({ latest: null, minSupported: null });
  });
});

describe('apiCall', () => {
  beforeEach(() => { global.fetch = vi.fn(); });

  it('sends User-Agent', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({}), json: async () => ({}) });
    await apiCall({ method: 'GET', server: 'https://x.com', path: '/api/me', key: 'sk-x', cliVersion: '1.0.0' });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers['User-Agent']).toBe('teleport-router/1.0.0');
  });

  it('appends key as query param', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({}), json: async () => ({}) });
    await apiCall({ method: 'GET', server: 'https://x.com', path: '/api/me', key: 'sk-x', cliVersion: '1.0.0' });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('?key=sk-x');
  });
});
