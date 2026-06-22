import { describe, expect, it, vi } from 'vitest';
import { handleCardAction } from './card-action.js';
import { MemoryStorage } from '../../storage.js';

describe('card-action handler', () => {
  it('records mark_read', async () => {
    const storage = new MemoryStorage();
    const out = await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'mark_read', entry_id: 'e1' } },
      context: { open_chat_id: 'oc_1' },
    } as any, { storage, now: () => 100 });
    expect(out.toast).toContain('已记录');
    const acts = await storage.listLarkCardActionsByEntry('e1');
    expect(acts).toHaveLength(1);
    expect(acts[0].action).toBe('mark_read');
  });

  it('records open without payload', async () => {
    const storage = new MemoryStorage();
    await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'open', entry_id: 'e2' } },
      context: { open_chat_id: 'oc_1' },
    } as any, { storage, now: () => 100 });
    const acts = await storage.listLarkCardActionsByEntry('e2');
    expect(acts[0].action).toBe('open');
  });

  it('records comment with payload (intent only — actual comment goes via web)', async () => {
    const storage = new MemoryStorage();
    await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'comment', entry_id: 'e3' } },
      context: { open_chat_id: 'oc_1' },
    } as any, { storage, now: () => 100 });
    const acts = await storage.listLarkCardActionsByEntry('e3');
    expect(acts[0].action).toBe('comment');
  });

  it('returns error toast on unknown action', async () => {
    const storage = new MemoryStorage();
    const out = await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'whatever', entry_id: 'e' } },
      context: { open_chat_id: 'oc_1' },
    } as any, { storage, now: () => 100 });
    expect(out.toast).toMatch(/未知/);
  });
});

import { createSummaryTokenCache } from '../summary-token-cache.js';

describe('card-action save_summary', () => {
  it('returns "expired" for unknown token', async () => {
    const storage = new MemoryStorage();
    const tokenCache = createSummaryTokenCache({ now: () => 0 });
    const out = await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'save_summary', summary_token: 'unknown' } },
      context: { open_chat_id: 'oc_1' },
    } as any, { storage, tokenCache });
    expect(out.toast).toContain('expired');
  });

  it('happy path saves entry and returns success toast', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 'T1', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });

    let now = 1000;
    const tokenCache = createSummaryTokenCache({ now: () => now });
    const token = tokenCache.put({
      summary: { tldr: 't', updates: [], decisions: ['d1'], todo: [], open_questions: [], tags: [] },
      interpretation: 'last 30m',
      chatId: 'oc_1', chatName: 'G', teamId: 't1',
      defaultArchiveChannelId: 'feedling',
      organizerOpenId: 'ou_x',
      generatedAt: now,
    });

    const out = await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'save_summary', summary_token: token, channel_id: 'feedling' } },
      context: { open_chat_id: 'oc_1' },
    } as any, { storage, tokenCache, publicUrl: 'https://r.x' });

    expect(out.toast).toContain('Saved');
    expect(out.toast).toContain('feedling');

    const botUser = await storage.getUser('lark-bot-t1');
    expect(botUser).toBeTruthy();
  });

  it('PATCHes original card to saved-state when apiClient + open_message_id present', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 'T1', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });

    const tokenCache = createSummaryTokenCache({ now: () => 1000 });
    const token = tokenCache.put({
      summary: { tldr: 't', updates: [], decisions: ['d1'], todo: [], open_questions: [], tags: [] },
      interpretation: 'last 30m',
      chatId: 'oc_1', chatName: 'G', teamId: 't1',
      defaultArchiveChannelId: 'feedling',
      organizerOpenId: 'ou_x',
      generatedAt: 1000,
    });

    const patches: Array<{ path: string; body: any }> = [];
    const apiClient = {
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(async (path: string, body: any) => { patches.push({ path, body }); return {}; }),
    } as any;

    await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'save_summary', summary_token: token, channel_id: 'feedling' } },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_xyz' },
    } as any, { storage, tokenCache, apiClient, publicUrl: 'https://r.x' });

    expect(patches).toHaveLength(1);
    expect(patches[0].path).toContain('om_xyz');
    const card = patches[0].body.content;
    expect(card).toContain('Saved to');
    // action block (with save_summary button) is gone
    expect(card).not.toContain('save_summary');
  });

  it('skips PATCH when apiClient missing — toast still returned', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 'T1', createdBy: 'a', createdAt: 0 } as any);

    const tokenCache = createSummaryTokenCache({ now: () => 1000 });
    const token = tokenCache.put({
      summary: { tldr: 't', updates: [], decisions: [], todo: [], open_questions: [], tags: [] },
      interpretation: 'last 30m',
      chatId: 'oc_1', chatName: 'G', teamId: 't1',
      defaultArchiveChannelId: '',
      organizerOpenId: 'ou_x',
      generatedAt: 1000,
    });

    const out = await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'save_summary', summary_token: token, channel_id: '__none__' } },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_xyz' },
    } as any, { storage, tokenCache, publicUrl: 'https://r.x' });

    expect(out.toast).toContain('Saved');
  });

  it('saves entry without channel when channel_id is __none__', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 'T1', createdBy: 'a', createdAt: 0 } as any);

    let now = 1000;
    const tokenCache = createSummaryTokenCache({ now: () => now });
    const token = tokenCache.put({
      summary: { tldr: 't', updates: [], decisions: ['d1'], todo: [], open_questions: [], tags: [] },
      interpretation: 'last 30m',
      chatId: 'oc_1', chatName: 'G', teamId: 't1',
      defaultArchiveChannelId: '',
      organizerOpenId: 'ou_x',
      generatedAt: now,
    });

    const out = await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'save_summary', summary_token: token, channel_id: '__none__' } },
      context: { open_chat_id: 'oc_1' },
    } as any, { storage, tokenCache, publicUrl: 'https://r.x' });

    expect(out.toast).toContain('Saved');
    expect(out.toast).toContain('(no channel)');

    const botUser = await storage.getUser('lark-bot-t1');
    expect(botUser).toBeTruthy();
    const entries = await storage.getEntriesByHandle('t1', 'lark-bot-t1');
    expect(entries).toHaveLength(1);
    expect(entries[0].channel).toBeFalsy();
  });
});

describe('card-action settings.disconnect + settings.rebind', () => {
  async function seed() {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 'T1', createdBy: 'u', createdAt: 0 } as any);
    await storage.createUser({ key: 'k', teamId: 't1', handle: 'me', pseudonym: 'me', larkOpenId: 'ou_x', createdAt: 0 } as any);
    await storage.createChannel({ id: 'router', teamId: 't1', name: 'router', joinRule: 'open', createdBy: 'me', createdAt: 0, skills: [], subscribers: [] });
    await storage.createChannel({ id: 'other', teamId: 't1', name: 'other', joinRule: 'open', createdBy: 'me', createdAt: 0, skills: [], subscribers: [] });
    return storage;
  }

  it('disconnect removes binding', async () => {
    const storage = await seed();
    await storage.createLarkChatBinding({
      chatId: 'oc_1', channelId: 'router', teamId: 't1',
      boundBy: 'me', boundAt: 0, chatName: 'G',
    });
    const out = await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'settings.disconnect' } },
      context: { open_chat_id: 'oc_1' },
    } as any, { storage });
    expect(out.toast).toContain('Disconnected');
    expect(await storage.getLarkChatBinding('oc_1')).toBeNull();
  });

  it('disconnect with no binding is idempotent', async () => {
    const storage = await seed();
    const out = await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'settings.disconnect' } },
      context: { open_chat_id: 'oc_1' },
    } as any, { storage });
    expect(out.toast).toContain('Already disconnected');
  });

  it('rebind swaps the binding to a different tag in same team', async () => {
    const storage = await seed();
    await storage.createLarkChatBinding({
      chatId: 'oc_1', channelId: 'router', teamId: 't1',
      boundBy: 'me', boundAt: 0, chatName: 'G',
    });
    const out = await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'settings.rebind' }, option: 'other' },
      context: { open_chat_id: 'oc_1' },
    } as any, { storage });
    expect(out.toast).toContain('Switched to #other');
    expect(out.toast).toContain('was #router');
    const b = await storage.getLarkChatBinding('oc_1');
    expect(b?.channelId).toBe('other');
    expect(b?.archiveChannelId).toBe('other');
    expect(b?.chatName).toBe('G');  // chatName preserved across rebind
  });

  it('rebind to same tag is a no-op toast', async () => {
    const storage = await seed();
    await storage.createLarkChatBinding({
      chatId: 'oc_1', channelId: 'router', teamId: 't1',
      boundBy: 'me', boundAt: 0, chatName: 'G',
    });
    const out = await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'settings.rebind' }, option: 'router' },
      context: { open_chat_id: 'oc_1' },
    } as any, { storage });
    expect(out.toast).toContain('Already bound');
    // Original binding intact
    expect((await storage.getLarkChatBinding('oc_1'))?.channelId).toBe('router');
  });

  it('rebind rejects cross-team channel', async () => {
    const storage = await seed();
    await storage.createTeam({ id: 't2', name: 'T2', createdBy: 'u', createdAt: 0 } as any);
    await storage.createChannel({ id: 'foreign', teamId: 't2', name: 'foreign', joinRule: 'open', createdBy: 'me', createdAt: 0, skills: [], subscribers: [] });
    await storage.createLarkChatBinding({
      chatId: 'oc_1', channelId: 'router', teamId: 't1',
      boundBy: 'me', boundAt: 0, chatName: 'G',
    });
    const out = await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'settings.rebind' }, option: 'foreign' },
      context: { open_chat_id: 'oc_1' },
    } as any, { storage });
    // Cross-team tag is invisible to this user (resolveTeamTag is team-scoped),
    // so the handler reports "not found in your team" rather than leaking
    // that the tag exists somewhere else.
    expect(out.toast).toContain('not found in your team');
    expect((await storage.getLarkChatBinding('oc_1'))?.channelId).toBe('router');
  });

  it('connect/rebind accepts an entry-only tag, auto-creating its tag_config', async () => {
    const storage = await seed();
    // wip is used in entries but has no tag_config row.
    await storage.addEntry({
      handle: 'me', teamId: 't1', client: 'cli',
      content: 'x', summary: 'x', tags: ['wip'], timestamp: 0,
    } as any);
    expect(await storage.getTagConfig('t1', 'wip')).toBeNull();

    // 1. Connect from unbound chat
    const connect = await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'settings.connect' }, option: 'wip' },
      context: { open_chat_id: 'oc_new' },
    } as any, { storage });
    expect(connect.toast).toContain('Connected to #wip');
    expect(await storage.getTagConfig('t1', 'wip')).not.toBeNull();
    expect((await storage.getLarkChatBinding('oc_new'))?.channelId).toBe('wip');

    // 2. Rebind a bound chat to another entry-only tag.
    await storage.createLarkChatBinding({
      chatId: 'oc_2', channelId: 'router', teamId: 't1',
      boundBy: 'me', boundAt: 0, chatName: 'G',
    });
    await storage.addEntry({
      handle: 'me', teamId: 't1', client: 'cli',
      content: 'y', summary: 'y', tags: ['adhoc-2'], timestamp: 0,
    } as any);
    const rebind = await handleCardAction({
      operator: { open_id: 'ou_x' },
      action: { value: { action: 'settings.rebind' }, option: 'adhoc-2' },
      context: { open_chat_id: 'oc_2' },
    } as any, { storage });
    expect(rebind.toast).toContain('Switched to #adhoc-2');
    expect((await storage.getLarkChatBinding('oc_2'))?.channelId).toBe('adhoc-2');
  });

  it('rebind without router-bound user returns auth hint', async () => {
    const storage = await seed();
    await storage.createLarkChatBinding({
      chatId: 'oc_1', channelId: 'router', teamId: 't1',
      boundBy: 'me', boundAt: 0, chatName: 'G',
    });
    const out = await handleCardAction({
      operator: { open_id: 'ou_unknown' },
      action: { value: { action: 'settings.rebind' }, option: 'other' },
      context: { open_chat_id: 'oc_1' },
    } as any, { storage });
    expect(out.toast).toContain('Bind your router account');
    expect((await storage.getLarkChatBinding('oc_1'))?.channelId).toBe('router');
  });
});
