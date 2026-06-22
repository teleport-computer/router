import { describe, expect, it, vi } from 'vitest';
import { createDisconnectHandler } from './disconnect.js';
import { MemoryStorage } from '../../../storage.js';

function p(chatId: string, openId: string) {
  return { message: { chat_id: chatId, content: '{"text":"disconnect"}' }, sender: { sender_id: { open_id: openId } } };
}

async function setup() {
  const s = new MemoryStorage();
  await s.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
  await s.createUser({ handle: 'alice', secretKeyHash: 'h1', teamId: 't1', larkOpenId: 'ou_alice' } as any);
  await s.createChannel({ id: 'feedling', teamId: 't1', name: 'feedling', joinRule: 'open', createdBy: 'alice', createdAt: 0, skills: [], subscribers: [{ handle: 'alice', role: 'admin', joinedAt: 0 }] });
  return s;
}

describe('disconnect handler', () => {
  it('errors when chat is not bound', async () => {
    const storage = await setup();
    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };
    const h = createDisconnectHandler({ storage, apiClient: apiClient as any });
    await h({ payload: p('oc_1', 'ou_alice'), arg: '' });
    expect((apiClient.post as any).mock.calls[0][1].content).toContain('未连接');
  });

  it('errors when clicker is on a different team than the binding', async () => {
    const storage = await setup();
    await storage.createTeam({ id: 't2', name: 't2', createdBy: 'b', createdAt: 0 } as any);
    await storage.createUser({ handle: 'bob', secretKeyHash: 'h2', teamId: 't2', larkOpenId: 'ou_bob' } as any);
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'alice', boundAt: 0, chatName: 'G' });
    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };
    const h = createDisconnectHandler({ storage, apiClient: apiClient as any });
    await h({ payload: p('oc_1', 'ou_bob'), arg: '' });
    expect((apiClient.post as any).mock.calls[0][1].content).toContain('team');
  });

  it('happy path: deletes binding and returns success', async () => {
    const storage = await setup();
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'alice', boundAt: 0, chatName: 'G' });
    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };
    const h = createDisconnectHandler({ storage, apiClient: apiClient as any });
    await h({ payload: p('oc_1', 'ou_alice'), arg: '' });
    expect(await storage.getLarkChatBinding('oc_1')).toBeNull();
    expect((apiClient.post as any).mock.calls[0][1].content).toContain('解绑');
  });
});
