import { describe, expect, it, vi } from 'vitest';
import { createSummarizeHandler } from './summarize.js';
import { MemoryStorage } from '../../storage.js';

function makeDeps(overrides: any = {}) {
  const storage = overrides.storage ?? new MemoryStorage();
  const apiClient = overrides.apiClient ?? {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
  };
  const fetchHistory = overrides.fetchHistory ?? vi.fn().mockResolvedValue({
    messages: [{ messageId: 'm1', senderId: 'ou_a', text: 'hi', createTime: 1745960000000 }],
    truncated: false,
    mentionedNames: new Map<string, string>(),
  });
  const summarize = overrides.summarize ?? vi.fn().mockResolvedValue({
    tldr: '总结', updates: [], decisions: ['d'], todo: [], open_questions: [], tags: [],
  });
  const parseTimeRange = overrides.parseTimeRange ?? vi.fn().mockResolvedValue({
    start_ts: 1745960000, end_ts: 1745963600, interpretation: '最近 1h', source: 'keyword',
  });
  const rateLimiter = overrides.rateLimiter ?? { check: () => ({ allowed: true }) };
  const log = vi.fn();
  return { storage, apiClient, fetchHistory, summarize, parseTimeRange, rateLimiter, log };
}

describe('summarize handler', () => {
  it('replies error card when chat is not bound and clicker has no router account', async () => {
    const deps = makeDeps();
    const handler = createSummarizeHandler(deps as any);
    await handler({
      message: { chat_id: 'oc_unbound', message_type: 'text', content: '{"text":"@_user_1 /summarize"}', mentions: [] },
      sender: { sender_id: { open_id: 'ou_x' } },
    });
    expect(deps.apiClient.post).toHaveBeenCalledWith('/open-apis/im/v1/messages?receive_id_type=chat_id', expect.objectContaining({
      receive_id: 'oc_unbound',
      msg_type: 'interactive',
    }));
    const card = (deps.apiClient.post as any).mock.calls[0][1].content;
    expect(card).toContain('未连接 router');
  });

  it('falls back to clicker user team when chat is not bound but user has router account', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'Feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });
    await storage.createUser({
      handle: 'alice', teamId: 't1', secretKeyHash: 'h', displayName: 'Alice', isAdmin: false, larkOpenId: 'ou_alice',
    } as any);
    const deps = makeDeps({ storage });
    const handler = createSummarizeHandler(deps as any);
    await handler({
      message: { chat_id: 'oc_unbound', message_type: 'text', content: '{"text":"@_user_1 /summarize"}', mentions: [] },
      sender: { sender_id: { open_id: 'ou_alice' } },
    });
    expect(deps.fetchHistory).toHaveBeenCalled();
    expect(deps.summarize).toHaveBeenCalled();
    const lastSummarizeArgs = (deps.summarize as any).mock.calls[0][0];
    expect(lastSummarizeArgs.chatName).toContain('Lark group');
  });

  it('happy path: fetches history, summarizes, sends card, updates last_summary', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'Feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'a', boundAt: 0, chatName: 'G' });
    const deps = makeDeps({ storage });
    const handler = createSummarizeHandler(deps as any);
    await handler({
      message: { chat_id: 'oc_1', message_type: 'text', content: '{"text":"@_user_1 /summarize 1h"}', mentions: [{ key: '@_user_1', name: 'Bot' }] },
      sender: { sender_id: { open_id: 'ou_x' } },
    });
    expect(deps.fetchHistory).toHaveBeenCalled();
    expect(deps.summarize).toHaveBeenCalled();
    const binding = await storage.getLarkChatBinding('oc_1');
    expect(binding?.lastSummaryTs).toBe(1745963600);
  });

  it('rate-limited reply when limiter blocks', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'Feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'a', boundAt: 0, chatName: 'G' });
    const rateLimiter = { check: () => ({ allowed: false, retryInMs: 60_000 }) };
    const deps = makeDeps({ storage, rateLimiter });
    const handler = createSummarizeHandler(deps as any);
    await handler({
      message: { chat_id: 'oc_1', message_type: 'text', content: '{"text":"@_user_1 /summarize"}', mentions: [{ key: '@_user_1', name: 'Bot' }] },
      sender: { sender_id: { open_id: 'ou_x' } },
    });
    const card = (deps.apiClient.post as any).mock.calls[0][1].content;
    expect(card).toContain('冷静');
    expect(deps.fetchHistory).not.toHaveBeenCalled();
  });

  it('tolerates trailing whitespace on /summarize command', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'Feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'a', boundAt: 0, chatName: 'G' });
    const deps = makeDeps({ storage });
    const handler = createSummarizeHandler(deps as any);
    await handler({
      message: { chat_id: 'oc_1', message_type: 'text', content: '{"text":"@_user_1 /summarize  "}', mentions: [{ key: '@_user_1', name: 'Bot' }] },
      sender: { sender_id: { open_id: 'ou_x' } },
    });
    expect(deps.fetchHistory).toHaveBeenCalled();
    // Empty arg with trailing whitespace is still a valid /summarize call (defaults to 30m via parseTimeRange)
    expect(deps.parseTimeRange).toHaveBeenCalledWith('', expect.anything());
  });

  it('extracts non-empty arg with trailing whitespace', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'Feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'a', boundAt: 0, chatName: 'G' });
    const deps = makeDeps({ storage });
    const handler = createSummarizeHandler(deps as any);
    await handler({
      message: { chat_id: 'oc_1', message_type: 'text', content: '{"text":"@_user_1 /summarize 1h "}', mentions: [{ key: '@_user_1', name: 'Bot' }] },
      sender: { sender_id: { open_id: 'ou_x' } },
    });
    expect(deps.parseTimeRange).toHaveBeenCalledWith('1h', expect.anything());
  });
});
