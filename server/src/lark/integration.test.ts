import { describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '../storage.js';
import { createSummarizeHandler } from './handlers/summarize.js';
import { parseTimeRange } from './parse-time-range.js';
import { createSummarizer } from './llm-summarize.js';
import { buildSummaryCard } from './card-builder.js';
import { createRateLimiter } from './rate-limit.js';
import { handleCardAction } from './handlers/card-action.js';
import { createSummaryTokenCache } from './summary-token-cache.js';

describe('lark integration', () => {
  it('full pipeline: bound chat → /summarize → card sent → last_summary updated', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'Feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'a', boundAt: 0, chatName: 'G' });

    const apiPosts: any[] = [];
    const apiPatches: any[] = [];
    const apiClient = {
      post: async (path: string, body: any) => { apiPosts.push({ path, body }); return { message_id: `om_${apiPosts.length}` }; },
      patch: async (path: string, body: any) => { apiPatches.push({ path, body }); return {}; },
      get: vi.fn().mockResolvedValue({}),
    } as any;
    const fetchHistory = vi.fn().mockResolvedValue({
      messages: [
        { messageId: 'm1', senderId: 'ou_a', text: '我们决定先做登录', createTime: 1745960000000 },
      ],
      truncated: false,
      mentionedNames: new Map<string, string>(),
    });
    const callLLM = vi.fn().mockResolvedValue(JSON.stringify({
      tldr: '决定先做登录', updates: [], decisions: ['先做登录'], todo: [], open_questions: [], tags: [],
    }));
    const summarizer = createSummarizer({ callLLM, model: 'm' });
    const handler = createSummarizeHandler({
      storage, apiClient,
      fetchHistory: opts => fetchHistory(opts),
      summarize: summarizer,
      parseTimeRange: (q, ctx) => parseTimeRange(q, ctx),
      rateLimiter: createRateLimiter({ windowMs: 1000, now: () => 0 }),
      now: () => 1745963600,
    });

    await handler({
      message: { chat_id: 'oc_1', message_type: 'text', content: '{"text":"@_user_1 /summarize 1h"}', mentions: [{ key: '@_user_1' }] },
      sender: { sender_id: { open_id: 'ou_x' } },
    });

    // 1 POST (loading card) + 1 PATCH (final summary card)
    expect(apiPosts).toHaveLength(1);
    expect(apiPatches).toHaveLength(1);
    const finalCard = apiPatches[0].body.content;
    expect(finalCard).toContain('决定先做登录');
    const binding = await storage.getLarkChatBinding('oc_1');
    expect(binding?.lastSummaryTs).toBeDefined();
  });
});

describe('lark integration — save flow', () => {
  it('summarize → token → save → entry created', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'a', boundAt: 0, chatName: 'G', archiveChannelId: 'feedling' });

    const apiPosts: any[] = [];
    const apiPatches: any[] = [];
    const apiClient = {
      post: async (path: string, body: any) => { apiPosts.push({ path, body }); return { message_id: `om_${apiPosts.length}` }; },
      patch: async (path: string, body: any) => { apiPatches.push({ path, body }); return {}; },
      get: vi.fn().mockResolvedValue({}),
    } as any;
    const fetchHistory = vi.fn().mockResolvedValue({
      messages: [{ messageId: 'm1', senderId: 'ou_a', text: '我们决定先做登录', createTime: 1745960000000 }],
      truncated: false,
      mentionedNames: new Map<string, string>(),
    });
    const callLLM = vi.fn().mockResolvedValue(JSON.stringify({
      tldr: '决定先做登录', updates: [], decisions: ['先做登录'], todo: [], open_questions: [], tags: [],
    }));
    const summarizer = createSummarizer({ callLLM, model: 'm' });
    const tokenCache = createSummaryTokenCache({ now: () => 1745963600 * 1000 });

    const handler = createSummarizeHandler({
      storage, apiClient,
      fetchHistory: opts => fetchHistory(opts),
      summarize: summarizer,
      parseTimeRange: (q, ctx) => parseTimeRange(q, ctx),
      rateLimiter: createRateLimiter({ windowMs: 1000, now: () => 0 }),
      tokenCache,
      now: () => 1745963600,
    });

    await handler({
      message: { chat_id: 'oc_1', message_type: 'text', content: '{"text":"@_user_1 /summarize 1h"}', mentions: [{ key: '@_user_1' }] },
      sender: { sender_id: { open_id: 'ou_x' } },
    });

    // 1 POST (loading) + 1 PATCH (final card with token)
    expect(apiPosts).toHaveLength(1);
    expect(apiPatches).toHaveLength(1);
    const cardJson = apiPatches[0].body.content;
    const tokenMatch = cardJson.match(/"summary_token":"([a-f0-9]+)"/);
    expect(tokenMatch).toBeTruthy();
    const token = tokenMatch![1];

    const saveResult = await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'save_summary', summary_token: token, channel_id: 'feedling' } },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_summary' },
    } as any, { storage, tokenCache, apiClient, publicUrl: 'https://r.x' });

    expect(saveResult.toast).toContain('Saved');

    const botUser = await storage.getUser('lark-bot-t1');
    expect(botUser).toBeTruthy();

    // PATCH was called twice: once to swap loading→summary, once to swap summary→saved
    expect(apiPatches).toHaveLength(2);
    const savedCard = apiPatches[1].body.content;
    expect(savedCard).toContain('Saved to');
    expect(savedCard).not.toContain('save_summary');
  });
});
