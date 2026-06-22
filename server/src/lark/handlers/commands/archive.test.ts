import { describe, expect, it, vi } from 'vitest';
import { createArchiveHandler } from './archive.js';
import { MemoryStorage } from '../../../storage.js';

function p(chatId: string, openId: string) {
  return { message: { chat_id: chatId, content: '{"text":"archive notes"}' }, sender: { sender_id: { open_id: openId } } };
}

async function setup() {
  const s = new MemoryStorage();
  await s.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
  await s.createUser({ handle: 'alice', secretKeyHash: 'h', teamId: 't1', larkOpenId: 'ou_alice' } as any);
  for (const id of ['feedling', 'notes']) {
    await s.createChannel({ id, teamId: 't1', name: id, joinRule: 'open', createdBy: 'alice', createdAt: 0, skills: [], subscribers: [{ handle: 'alice', role: 'admin', joinedAt: 0 }] });
  }
  return s;
}

describe('archive handler', () => {
  it('errors when chat is not connected', async () => {
    const storage = await setup();
    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };
    const h = createArchiveHandler({ storage, apiClient: apiClient as any });
    await h({ payload: p('oc_1', 'ou_alice'), arg: 'notes' });
    expect((apiClient.post as any).mock.calls[0][1].content).toContain('请先');
  });

  it('errors when archive channel does not exist', async () => {
    const storage = await setup();
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'alice', boundAt: 0, chatName: 'G' });
    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };
    const h = createArchiveHandler({ storage, apiClient: apiClient as any });
    await h({ payload: p('oc_1', 'ou_alice'), arg: 'nope' });
    expect((apiClient.post as any).mock.calls[0][1].content).toContain('找不到');
  });

  it('happy path: updates archive_channel_id and confirms', async () => {
    const storage = await setup();
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'alice', boundAt: 0, chatName: 'G', archiveChannelId: 'feedling' });
    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };
    const h = createArchiveHandler({ storage, apiClient: apiClient as any });
    await h({ payload: p('oc_1', 'ou_alice'), arg: 'notes' });
    const binding = await storage.getLarkChatBinding('oc_1');
    expect(binding?.archiveChannelId).toBe('notes');
    expect((apiClient.post as any).mock.calls[0][1].content).toContain('归档');
  });
});
