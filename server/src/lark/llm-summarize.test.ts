import { describe, expect, it, vi } from 'vitest';
import { createSummarizer } from './llm-summarize.js';
import type { ChatMessage } from './api-client.js';

const msgs: ChatMessage[] = [
  { messageId: 'm1', senderId: 'ou_a', text: '我们要不要先把登录做了', createTime: 1745960000000 },
  { messageId: 'm2', senderId: 'ou_b', text: '同意,先做登录', createTime: 1745960010000 },
];

describe('summarize', () => {
  it('parses LLM JSON output', async () => {
    const callLLM = vi.fn().mockResolvedValue(JSON.stringify({
      tldr: '决定先做登录',
      updates: [],
      decisions: ['先做登录'],
      todo: [{ who: '@b', what: '负责登录页' }],
      open_questions: [],
    }));
    const summarize = createSummarizer({ callLLM, model: 'deepseek/deepseek-chat-v3.5' });
    const r = await summarize({ messages: msgs, chatName: 'Demo', interpretation: '最近 30 分钟', resolveSender: id => id, tagContext: '' });
    expect(r.tldr).toContain('登录');
    expect(r.decisions).toEqual(['先做登录']);
    expect(r.todo).toHaveLength(1);
  });

  it('strips ```json wrapping', async () => {
    const callLLM = vi.fn().mockResolvedValue('```json\n{"tldr":"x","updates":[],"decisions":[],"todo":[],"open_questions":[]}\n```');
    const summarize = createSummarizer({ callLLM, model: 'x' });
    const r = await summarize({ messages: msgs, chatName: 'Demo', interpretation: '最近 30 分钟', resolveSender: id => id, tagContext: '' });
    expect(r.tldr).toBe('x');
  });

  it('replaces sender ids via resolveSender', async () => {
    const callLLM = vi.fn().mockResolvedValue(JSON.stringify({ tldr: 't', updates: [], decisions: [], todo: [], open_questions: [] }));
    const summarize = createSummarizer({ callLLM, model: 'x' });
    await summarize({ messages: msgs, chatName: 'Demo', interpretation: 'x', resolveSender: id => id === 'ou_a' ? 'Alice' : id, tagContext: '' });
    const prompt = (callLLM as any).mock.calls[0][0] as string;
    expect(prompt).toContain('Alice');
    expect(prompt).not.toContain('ou_a');
  });

  it('preserves updates array', async () => {
    const callLLM = vi.fn().mockResolvedValue(JSON.stringify({
      tldr: 't', updates: ['u1', 'u2'], decisions: [], todo: [], open_questions: [],
    }));
    const summarize = createSummarizer({ callLLM, model: 'x' });
    const r = await summarize({ messages: msgs, chatName: 'D', interpretation: 'x', resolveSender: id => id, tagContext: '' });
    expect(r.updates).toEqual(['u1', 'u2']);
  });
});
