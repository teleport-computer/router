import { describe, expect, it } from 'vitest';
import { parseTimeRange } from './parse-time-range.js';

const NOW = 1745960000;  // 2026-04-29 06:13:20 UTC

describe('parseTimeRange (fast path)', () => {
  it('empty → 30 minutes', async () => {
    const r = await parseTimeRange('', { now: NOW });
    expect(r.source).toBe('default');
    expect(r.end_ts).toBe(NOW);
    expect(r.start_ts).toBe(NOW - 30 * 60);
  });

  it('"30m" → 30 minutes', async () => {
    const r = await parseTimeRange('30m', { now: NOW });
    expect(r.source).toBe('keyword');
    expect(r.start_ts).toBe(NOW - 1800);
  });

  it('"1h" → 1 hour', async () => {
    const r = await parseTimeRange('1h', { now: NOW });
    expect(r.source).toBe('keyword');
    expect(r.start_ts).toBe(NOW - 3600);
  });

  it('"2d" → 2 days', async () => {
    const r = await parseTimeRange('2d', { now: NOW });
    expect(r.start_ts).toBe(NOW - 2 * 86400);
  });

  it('"today" → midnight UTC of today (Asia/Shanghai-aware)', async () => {
    const r = await parseTimeRange('today', { now: NOW });
    expect(r.source).toBe('keyword');
    expect(r.end_ts).toBe(NOW);
    expect(r.interpretation).toContain('Today');
    expect(r.start_ts).toBeLessThanOrEqual(NOW);
  });

  it('"上次" without lastSummaryTs → fallback to 30m default', async () => {
    const r = await parseTimeRange('上次', { now: NOW });
    expect(r.source).toBe('default');
    expect(r.start_ts).toBe(NOW - 1800);
  });

  it('"上次" with lastSummaryTs uses it', async () => {
    const r = await parseTimeRange('上次', { now: NOW, lastSummaryTs: NOW - 1000 });
    expect(r.source).toBe('keyword');
    expect(r.start_ts).toBe(NOW - 1000);
    expect(r.interpretation).toContain('Since last');
  });

  it('passes unknown query to llmFallback', async () => {
    const llmFallback = async () => ({ start_ts: 100, end_ts: 200, interpretation: 'mock', source: 'llm' as const });
    const r = await parseTimeRange('帮我看看早上 10 点到现在', { now: NOW, llmFallback });
    expect(r.source).toBe('llm');
    expect(r.start_ts).toBe(100);
  });
});
