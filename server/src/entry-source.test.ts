import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectMcpClientApp, detectHttpClientApp, INTERNAL_SOURCE } from './entry-source.js';

describe('detectMcpClientApp', () => {
  it('maps known canonical names', () => {
    expect(detectMcpClientApp('claude-code')).toBe('cc-cli');
    expect(detectMcpClientApp('claude-ai')).toBe('cc-desktop');
    expect(detectMcpClientApp('claude')).toBe('cc-desktop');
    expect(detectMcpClientApp('codex')).toBe('codex');
    expect(detectMcpClientApp('cursor')).toBe('cursor');
    expect(detectMcpClientApp('cursor-vscode')).toBe('cursor');
  });

  it('is case-insensitive on input', () => {
    expect(detectMcpClientApp('Claude-Code')).toBe('cc-cli');
    expect(detectMcpClientApp('CURSOR')).toBe('cursor');
  });

  it('passes unknown names through with mcp- prefix', () => {
    expect(detectMcpClientApp('newthing')).toBe('mcp-newthing');
  });

  it('returns "unknown" when name missing', () => {
    expect(detectMcpClientApp(undefined)).toBe('unknown');
    expect(detectMcpClientApp('')).toBe('unknown');
  });

  it('logs unknown name only once per process', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    detectMcpClientApp('rare-client-x');
    detectMcpClientApp('rare-client-x');
    detectMcpClientApp('rare-client-x');
    const matching = spy.mock.calls.filter(c => String(c[0]).includes('rare-client-x'));
    expect(matching.length).toBe(1);
    spy.mockRestore();
  });
});

describe('detectHttpClientApp', () => {
  beforeEach(() => {
    // No teardown needed — module-level Set persists, but we use unique UAs per test.
  });

  it('detects router-cli by UA prefix', () => {
    expect(detectHttpClientApp('router-cli/1.0.7', undefined)).toBe('router-cli');
    expect(detectHttpClientApp('Router-CLI/1.0.7 something', undefined)).toBe('router-cli');
  });

  it('detects browser UA from our origin as web', () => {
    expect(detectHttpClientApp(
      'Mozilla/5.0 Chrome',
      'https://router.feedling.app',
      ['router.feedling.app'],
    )).toBe('web');
  });

  it('detects browser UA from any origin when ourOrigins is empty', () => {
    expect(detectHttpClientApp('Mozilla/5.0', 'https://anywhere.com', [])).toBe('web');
  });

  it('returns http when browser UA but origin not in allowlist', () => {
    expect(detectHttpClientApp(
      'Mozilla/5.0',
      'https://attacker.com',
      ['router.feedling.app'],
    )).toBe('http');
  });

  it('matches subdomain of our origin', () => {
    expect(detectHttpClientApp(
      'Mozilla/5.0',
      'https://staging.router.feedling.app',
      ['router.feedling.app'],
    )).toBe('web');
  });

  it('returns http for non-browser non-CLI UA', () => {
    expect(detectHttpClientApp('curl/8.4.0', undefined)).toBe('http');
    expect(detectHttpClientApp('PostmanRuntime/7.0', undefined)).toBe('http');
  });

  it('returns http when UA is missing entirely', () => {
    expect(detectHttpClientApp(undefined, undefined)).toBe('http');
  });
});

describe('INTERNAL_SOURCE', () => {
  it('exposes lark-bot/internal pair for cron writers', () => {
    expect(INTERNAL_SOURCE.sourceApp).toBe('lark-bot');
    expect(INTERNAL_SOURCE.sourceVia).toBe('internal');
  });
});
