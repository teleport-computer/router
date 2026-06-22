import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TOOLS } from './agent-tools.js';
import { MemoryStorage } from '../storage.js';
import type { LarkApiClient } from './api-client.js';

function makeApiClient(): LarkApiClient & { _post: any } {
  const post = vi.fn().mockResolvedValue({});
  return { post, patch: vi.fn(), get: vi.fn(), _post: post } as any;
}

async function setup(opts: { withGroupBinding?: boolean; sender?: 'bound' | 'unbound' } = {}) {
  const storage = new MemoryStorage();
  await storage.createTeam({ id: 't1', name: 'T1', createdBy: 'taco', createdAt: 0 } as any);
  await storage.createChannel({
    id: 'frontend', teamId: 't1', name: 'Frontend', joinRule: 'open',
    createdBy: 'taco', createdAt: 0, skills: [], subscribers: [],
  });
  await storage.createChannel({
    id: 'general', teamId: 't1', name: 'General', joinRule: 'open',
    createdBy: 'taco', createdAt: 0, skills: [], subscribers: [],
  });
  if (opts.sender !== 'unbound') {
    await storage.createUser({
      handle: 'taco', secretKeyHash: 'h', teamId: 't1',
      larkOpenId: 'ou_taco', createdAt: 0,
    } as any);
  }
  if (opts.withGroupBinding) {
    await storage.createLarkChatBinding({
      chatId: 'oc_grp_1', channelId: 'general', teamId: 't1',
      boundBy: 'taco', boundAt: 0, chatName: 'Engineering',
    } as any);
  }
  const apiClient = makeApiClient();
  const ctx = {
    storage,
    apiClient: apiClient as any,
    chatId: 'oc_grp_1',
    senderOpenId: 'ou_taco',
    publicUrl: 'https://r.test',
  };
  return { storage, apiClient, ctx };
}

describe('save_entry tool', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('saves with author = sender handle (NOT bot) and channel = group binding', async () => {
    const { storage, apiClient, ctx } = await setup({ withGroupBinding: true });
    const res = await TOOLS.save_entry.execute(
      { content: '决定用 Zustand 替换 Pinia' },
      ctx,
    );
    const parsed = JSON.parse(res.output);
    expect(parsed.saved).toBeTruthy();
    expect(parsed.handle).toBe('taco');
    expect(parsed.channel).toBe('general');
    expect(res.silent).toBe(true);

    const entry = await storage.getEntry(parsed.saved);
    expect(entry).toBeTruthy();
    expect(entry!.handle).toBe('taco');
    expect(entry!.client).toBe('lark');
    expect(entry!.content).toBe('决定用 Zustand 替换 Pinia');
    expect(entry!.channel).toBe('general');
    expect(entry!.tags).toContain('lark-bot-save');

    expect(apiClient._post).toHaveBeenCalledTimes(1);
    const [path, body] = apiClient._post.mock.calls[0];
    expect(path).toContain('/open-apis/im/v1/messages');
    expect((body as any).receive_id).toBe('oc_grp_1');
    const cardJson = JSON.parse((body as any).content);
    expect(JSON.stringify(cardJson)).toContain('taco');
    expect(JSON.stringify(cardJson)).toContain(parsed.saved);
  });

  it('saves channel-less when no group binding and user did not specify', async () => {
    const { storage, ctx } = await setup({ withGroupBinding: false });
    const res = await TOOLS.save_entry.execute({ content: '私聊里随手记一下' }, ctx);
    const parsed = JSON.parse(res.output);
    expect(parsed.channel).toBeNull();
    const entry = await storage.getEntry(parsed.saved);
    expect(entry!.channel).toBeUndefined();
  });

  it('honors user-specified channel when slug exists in same team', async () => {
    const { storage, ctx } = await setup({ withGroupBinding: true });
    const res = await TOOLS.save_entry.execute(
      { content: 'X', channel: 'frontend' },
      ctx,
    );
    const parsed = JSON.parse(res.output);
    expect(parsed.channel).toBe('frontend');
    const entry = await storage.getEntry(parsed.saved);
    expect(entry!.channel).toBe('frontend');
  });

  it('strips leading # and lowercases user-specified channel', async () => {
    const { ctx } = await setup({ withGroupBinding: true });
    const res = await TOOLS.save_entry.execute(
      { content: 'X', channel: '#FrontEnd' },
      ctx,
    );
    const parsed = JSON.parse(res.output);
    expect(parsed.channel).toBe('frontend');
  });

  it('falls back to group binding when user-specified channel slug does not exist', async () => {
    const { ctx } = await setup({ withGroupBinding: true });
    const res = await TOOLS.save_entry.execute(
      { content: 'X', channel: 'does-not-exist' },
      ctx,
    );
    const parsed = JSON.parse(res.output);
    expect(parsed.channel).toBe('general');
  });

  it('returns sender_not_bound error and does not write entry when sender is unbound', async () => {
    const { storage, apiClient, ctx } = await setup({ sender: 'unbound' });
    const res = await TOOLS.save_entry.execute({ content: 'X' }, ctx);
    const parsed = JSON.parse(res.output);
    expect(parsed.error).toContain('sender_not_bound');
    expect(parsed.error).toContain('https://r.test/settings');
    // No entry written, no card posted
    const entries = await storage.getEntries('t1', 50);
    expect(entries.length).toBe(0);
    expect(apiClient._post).not.toHaveBeenCalled();
  });

  it('rejects empty content', async () => {
    const { ctx } = await setup({ withGroupBinding: true });
    const res = await TOOLS.save_entry.execute({ content: '   ' }, ctx);
    const parsed = JSON.parse(res.output);
    expect(parsed.error).toContain('content');
  });

  it('always appends lark-bot-save tag and dedupes user-supplied tags', async () => {
    const { storage, ctx } = await setup({ withGroupBinding: true });
    const res = await TOOLS.save_entry.execute(
      { content: 'X', tags: ['decision', 'frontend', 'lark-bot-save'] },
      ctx,
    );
    const parsed = JSON.parse(res.output);
    const entry = await storage.getEntry(parsed.saved);
    expect(entry!.tags).toContain('lark-bot-save');
    expect(entry!.tags).toContain('decision');
    expect(entry!.tags).toContain('frontend');
    // dedup
    const occurrences = entry!.tags.filter(t => t === 'lark-bot-save').length;
    expect(occurrences).toBe(1);
  });

  it('still returns saved when card post fails (entry survives)', async () => {
    const { storage, apiClient, ctx } = await setup({ withGroupBinding: true });
    apiClient.post = vi.fn().mockRejectedValue(new Error('lark down')) as any;
    apiClient._post = apiClient.post;
    const res = await TOOLS.save_entry.execute({ content: 'X' }, ctx);
    const parsed = JSON.parse(res.output);
    expect(parsed.saved).toBeTruthy();
    const entry = await storage.getEntry(parsed.saved);
    expect(entry).toBeTruthy();
  });
});
