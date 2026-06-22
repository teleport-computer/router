import { describe, expect, it, beforeEach } from 'vitest';
import { MemoryStorage } from '../storage.js';

describe('lark chat bindings (storage layer)', () => {
  let s: MemoryStorage;
  beforeEach(() => { s = new MemoryStorage(); });

  it('create and retrieve binding by chat_id', async () => {
    await s.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'alice', boundAt: 1, chatName: 'Feedling Group' });
    const got = await s.getLarkChatBinding('oc_1');
    expect(got).toMatchObject({ chatId: 'oc_1', channelId: 'feedling', chatName: 'Feedling Group' });
  });

  it('listLarkChatBindingsByChannel filters correctly', async () => {
    await s.createLarkChatBinding({ chatId: 'oc_1', channelId: 'A', teamId: 't', boundBy: 'a', boundAt: 1, chatName: 'A1' });
    await s.createLarkChatBinding({ chatId: 'oc_2', channelId: 'A', teamId: 't', boundBy: 'a', boundAt: 1, chatName: 'A2' });
    await s.createLarkChatBinding({ chatId: 'oc_3', channelId: 'B', teamId: 't', boundBy: 'a', boundAt: 1, chatName: 'B1' });
    const a = await s.listLarkChatBindingsByChannel('A');
    expect(a.map(b => b.chatId).sort()).toEqual(['oc_1', 'oc_2']);
  });

  it('updateLarkLastSummary sets fields', async () => {
    await s.createLarkChatBinding({ chatId: 'oc_1', channelId: 'A', teamId: 't', boundBy: 'a', boundAt: 1, chatName: 'A' });
    await s.updateLarkLastSummary('oc_1', 1000, 2000);
    const got = await s.getLarkChatBinding('oc_1');
    expect(got?.lastSummaryTs).toBe(1000);
    expect(got?.lastSummaryAt).toBe(2000);
  });

  it('deleteLarkChatBinding removes it', async () => {
    await s.createLarkChatBinding({ chatId: 'oc_1', channelId: 'A', teamId: 't', boundBy: 'a', boundAt: 1, chatName: 'A' });
    await s.deleteLarkChatBinding('oc_1');
    expect(await s.getLarkChatBinding('oc_1')).toBeNull();
  });

  it('recordLarkCardAction returns id and is queryable by entry', async () => {
    const a1 = await s.recordLarkCardAction({ entryId: 'e1', chatId: 'oc_1', openId: 'ou_x', action: 'mark_read', actedAt: 1 });
    expect(a1.id).toBe(1);
    await s.recordLarkCardAction({ entryId: 'e1', chatId: 'oc_1', openId: 'ou_y', action: 'open', actedAt: 2 });
    await s.recordLarkCardAction({ entryId: 'e2', chatId: 'oc_1', openId: 'ou_x', action: 'comment', actedAt: 3, payload: { text: 'hello' } });
    const e1 = await s.listLarkCardActionsByEntry('e1');
    expect(e1).toHaveLength(2);
  });

  it('updateLarkBindingArchive sets and clears archive channel', async () => {
    await s.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't', boundBy: 'a', boundAt: 1, chatName: 'G' });
    await s.updateLarkBindingArchive('oc_1', 'shipped');
    expect((await s.getLarkChatBinding('oc_1'))?.archiveChannelId).toBe('shipped');
    await s.updateLarkBindingArchive('oc_1', null);
    expect((await s.getLarkChatBinding('oc_1'))?.archiveChannelId).toBeUndefined();
  });
});
