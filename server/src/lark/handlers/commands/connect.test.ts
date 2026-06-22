import { describe, expect, it, vi } from 'vitest';
import { createConnectHandler } from './connect.js';
import { MemoryStorage } from '../../../storage.js';

function makeFakePayload(chatId: string, openId: string) {
  return {
    message: { chat_id: chatId, content: '{"text":"connect feedling"}' },
    sender: { sender_id: { open_id: openId } },
  };
}

async function setupStorage() {
  const s = new MemoryStorage();
  await s.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
  await s.createUser({ handle: 'alice', secretKeyHash: 'h1', teamId: 't1', larkOpenId: 'ou_alice' } as any);
  await s.createChannel({ id: 'feedling', teamId: 't1', name: 'feedling', joinRule: 'open', createdBy: 'alice', createdAt: 0, skills: [], subscribers: [{ handle: 'alice', role: 'admin', joinedAt: 0 }] });
  return s;
}

describe('connect handler', () => {
  it('returns "请先绑定" card when clicker has no router account', async () => {
    const storage = await setupStorage();
    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };
    const handler = createConnectHandler({ storage, apiClient: apiClient as any, publicUrl: 'https://r.x' });
    await handler({ payload: makeFakePayload('oc_1', 'ou_unknown'), arg: 'feedling' });
    const card = (apiClient.post as any).mock.calls[0][1].content;
    expect(card).toContain('请先到 router');
  });

  it('returns "找不到 channel" when channel does not exist', async () => {
    const storage = await setupStorage();
    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };
    const handler = createConnectHandler({ storage, apiClient: apiClient as any, publicUrl: 'https://r.x' });
    await handler({ payload: makeFakePayload('oc_1', 'ou_alice'), arg: 'nonexistent' });
    const card = (apiClient.post as any).mock.calls[0][1].content;
    expect(card).toContain('找不到');
  });

  it('rejects with "找不到 tag" when the tag belongs to a different team (team-scoped resolve)', async () => {
    const storage = await setupStorage();
    await storage.createTeam({ id: 't2', name: 't2', createdBy: 'b', createdAt: 0 } as any);
    await storage.createUser({ handle: 'bob', secretKeyHash: 'h2', teamId: 't2', larkOpenId: 'ou_bob' } as any);
    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };
    const handler = createConnectHandler({ storage, apiClient: apiClient as any, publicUrl: 'https://r.x' });
    await handler({ payload: makeFakePayload('oc_1', 'ou_bob'), arg: 'feedling' });
    const card = (apiClient.post as any).mock.calls[0][1].content;
    // bob is in t2, #feedling exists in t1 — from bob's perspective it doesn't exist
    expect(card).toContain('找不到 tag');
  });

  it('returns "已经绑过" when chat is already bound', async () => {
    const storage = await setupStorage();
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'alice', boundAt: 0, chatName: 'G' });
    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };
    const handler = createConnectHandler({ storage, apiClient: apiClient as any, publicUrl: 'https://r.x' });
    await handler({ payload: makeFakePayload('oc_1', 'ou_alice'), arg: 'feedling' });
    const card = (apiClient.post as any).mock.calls[0][1].content;
    expect(card).toContain('已绑');
  });

  it('happy path: creates binding and returns success card', async () => {
    const storage = await setupStorage();
    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn().mockResolvedValue({ name: '测试群' }) };
    const handler = createConnectHandler({ storage, apiClient: apiClient as any, publicUrl: 'https://r.x' });
    await handler({ payload: makeFakePayload('oc_1', 'ou_alice'), arg: 'feedling' });
    const binding = await storage.getLarkChatBinding('oc_1');
    expect(binding).toMatchObject({ chatId: 'oc_1', channelId: 'feedling', boundBy: 'alice', chatName: '测试群' });
    expect(binding?.archiveChannelId).toBe('feedling');
    const card = (apiClient.post as any).mock.calls[0][1].content;
    expect(card).toContain('已连');
  });
});
