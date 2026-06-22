import { describe, expect, it } from 'vitest';
import { renderEntryMarkdown, saveSummary } from './save-summary.js';
import { MemoryStorage } from '../storage.js';

describe('renderEntryMarkdown', () => {
  it('produces markdown with organizer header + only non-empty sections', () => {
    const md = renderEntryMarkdown({
      organizer: '@hx',
      chatName: '我的群',
      interpretation: '最近 30 分钟',
      summary: {
        tldr: '决定先做登录',
        updates: ['@a 完成 review'],
        decisions: ['先做登录'],
        todo: [{ who: '@b', what: '负责登录页' }],
        open_questions: [],
        tags: [],
      },
    });
    expect(md).toContain('整理：@hx');
    expect(md).toContain('我的群');
    expect(md).toContain('最近 30 分钟');
    expect(md).toContain('## TL;DR');
    expect(md).toContain('## 🔄 Updates');
    expect(md).toContain('## 🎯 Decisions');
    expect(md).toContain('## ✅ Todo');
    expect(md).not.toContain('## ❓ Open questions');
    expect(md).toContain('@b: 负责登录页');
  });

  it('omits all body sections when empty', () => {
    const md = renderEntryMarkdown({
      organizer: '@hx',
      chatName: 'D',
      interpretation: 'x',
      summary: { tldr: 't', updates: [], decisions: [], todo: [], open_questions: [], tags: [] },
    });
    expect(md).toContain('## TL;DR');
    expect(md).not.toContain('## 🔄 Updates');
    expect(md).not.toContain('## 🎯 Decisions');
  });
});

describe('saveSummary', () => {
  it('creates entry with lark-bot author + lark-summary tag + skip staging', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 'T1', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });

    const result = await saveSummary({
      storage,
      teamId: 't1',
      destinationChannelId: 'feedling',
      organizer: '@hx',
      chatName: '我的群',
      interpretation: '最近 30 分钟',
      summary: { tldr: '决定先做登录', updates: [], decisions: ['先做登录'], todo: [], open_questions: [], tags: [] },
    });

    expect(result.entry.handle).toBe('lark-bot-t1');
    expect(result.entry.tags).toContain('lark-summary');
    expect(result.entry.client).toBe('lark');
    expect(result.entry.channel).toBe('feedling');
    expect(result.entry.summary).toBe('[Lark Summary · 我的群 · 最近 30 分钟] 决定先做登录');
    expect(result.entry.publishAt).toBeFalsy();
    expect(result.entry.content).toContain('整理：@hx');
  });
});
