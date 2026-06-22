import { describe, expect, it, vi } from 'vitest';
import { createLlmTimeRangeFallback } from './llm-time-range.js';

describe('llmTimeRangeFallback', () => {
  it('parses LLM JSON output', async () => {
    const callLLM = vi.fn().mockResolvedValue('{"start_ts":1745960000,"end_ts":1745963600,"interpretation":"今天 10:00 至 11:00"}');
    const fb = createLlmTimeRangeFallback({ callLLM, model: 'deepseek/deepseek-chat-v3.5' });
    const r = await fb('今天 10 点到 11 点', 1745963600);
    expect(r.start_ts).toBe(1745960000);
    expect(r.source).toBe('llm');
  });

  it('handles ```json wrapping', async () => {
    const callLLM = vi.fn().mockResolvedValue('```json\n{"start_ts":100,"end_ts":200,"interpretation":"test"}\n```');
    const fb = createLlmTimeRangeFallback({ callLLM, model: 'x' });
    const r = await fb('q', 999);
    expect(r.start_ts).toBe(100);
  });

  it('throws when LLM returns {error: ...}', async () => {
    const callLLM = vi.fn().mockResolvedValue('{"error":"无法理解时间范围"}');
    const fb = createLlmTimeRangeFallback({ callLLM, model: 'x' });
    await expect(fb('garbage', 0)).rejects.toThrow(/无法理解/);
  });
});
