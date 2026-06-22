import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RouterEntry, Channel, Skill, SkillEffect } from './storage.js';
import { evaluateChannelTriggers, evaluateTagTriggers, runEffects } from './webhook.js';
import { MemoryStorage } from './storage.js';

const baseEntry = (overrides: Partial<RouterEntry> = {}): RouterEntry => ({
  id: 'e1', handle: 'ada', teamId: 'team-a', client: 'code',
  content: 'hello world', summary: 'hello', tags: ['urgent', 'frontend'],
  timestamp: 1700000000000, channel: 'feedling',
  ...overrides,
});

const baseChannel = (skills: Skill[]): Channel => ({
  id: 'feedling', teamId: 'team-a', name: 'Feedling',
  joinRule: 'open', createdBy: 'ada', createdAt: 0,
  subscribers: [], skills,
});

const skill = (overrides: Partial<Skill>): Skill => ({
  id: 's1', name: 's1', description: '', instructions: '',
  exposeAs: 'context', createdAt: 0,
  ...overrides,
});

describe('evaluateChannelTriggers', () => {
  let markFired: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' }) as any;
    markFired = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
  });

  it('fires on_entry_write effects when no filter is set', async () => {
    const ch = baseChannel([
      skill({
        triggers: [{ type: 'on_entry_write' }],
        effects: [{ type: 'lark_webhook', url: 'https://lark/x', template: 'card' }],
      }),
    ]);
    await evaluateChannelTriggers(baseEntry(), ch, markFired);
    await new Promise(r => setTimeout(r, 0));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as any).mock.calls[0][0]).toBe('https://lark/x');
  });

  it('fires effects only when tag filter matches (AND semantics)', async () => {
    const ch = baseChannel([
      skill({
        id: 'sm', name: 'sm',
        triggers: [{ type: 'on_entry_write', filter: { tags: ['urgent', 'frontend'] } }],
        effects: [{ type: 'lark_webhook', url: 'https://lark/match', template: 'card' }],
      }),
      skill({
        id: 'sk', name: 'sk',
        triggers: [{ type: 'on_entry_write', filter: { tags: ['nope'] } }],
        effects: [{ type: 'lark_webhook', url: 'https://lark/skip', template: 'card' }],
      }),
    ]);
    await evaluateChannelTriggers(baseEntry(), ch, markFired);
    await new Promise(r => setTimeout(r, 0));
    const urls = (global.fetch as any).mock.calls.map((c: any[]) => c[0]);
    expect(urls).toContain('https://lark/match');
    expect(urls).not.toContain('https://lark/skip');
  });

  it('fires effects only when author filter matches', async () => {
    const ch = baseChannel([
      skill({
        triggers: [{ type: 'on_entry_write', filter: { authors: ['bob'] } }],
        effects: [{ type: 'lark_webhook', url: 'https://lark/bob', template: 'card' }],
      }),
    ]);
    await evaluateChannelTriggers(baseEntry({ handle: 'ada' }), ch, markFired);
    await new Promise(r => setTimeout(r, 0));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('skips manual triggers', async () => {
    const ch = baseChannel([
      skill({
        triggers: [{ type: 'manual' }],
        effects: [{ type: 'lark_webhook', url: 'https://lark/manual', template: 'card' }],
      }),
    ]);
    await evaluateChannelTriggers(baseEntry(), ch, markFired);
    await new Promise(r => setTimeout(r, 0));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('skips entries authored by the lark-bot system user (loop prevention)', async () => {
    const ch = baseChannel([
      skill({
        triggers: [{ type: 'on_entry_write' }],
        effects: [{ type: 'lark_webhook', url: 'https://lark/x', template: 'card' }],
      }),
    ]);
    await evaluateChannelTriggers(baseEntry({ handle: 'lark-bot-team-a' }), ch, markFired);
    await new Promise(r => setTimeout(r, 0));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls markFired after evaluation so startup recovery does not re-fire', async () => {
    const ch = baseChannel([
      skill({
        triggers: [{ type: 'on_entry_write' }],
        effects: [{ type: 'lark_webhook', url: 'https://lark/x', template: 'card' }],
      }),
    ]);
    await evaluateChannelTriggers(baseEntry(), ch, markFired);
    expect(markFired).toHaveBeenCalledWith('e1');
  });

  it('fires effects for auto:digest entries (digests should push to group)', async () => {
    const ch = baseChannel([
      skill({
        triggers: [{ type: 'on_entry_write' }],
        effects: [{ type: 'lark_webhook', url: 'https://lark/digest-push', template: 'card' }],
      }),
    ]);
    await evaluateChannelTriggers(
      baseEntry({ tags: ['auto:digest', 'weekly'] }),
      ch,
      markFired,
    );
    await new Promise(r => setTimeout(r, 0));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as any).mock.calls[0][0]).toBe('https://lark/digest-push');
    expect(markFired).toHaveBeenCalledWith('e1');
  });

  it('marks fired even when no skills match', async () => {
    const ch = baseChannel([]);
    await evaluateChannelTriggers(baseEntry(), ch, markFired);
    expect(markFired).toHaveBeenCalledWith('e1');
  });
});

describe('runEffects', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' }) as any;
  });

  it('dispatches lark_webhook with a card payload', async () => {
    const effects: SkillEffect[] = [
      { type: 'lark_webhook', url: 'https://lark/y', template: 'card' },
    ];
    await runEffects(baseEntry(), baseChannel([]), effects);
    await new Promise(r => setTimeout(r, 0));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.msg_type).toBe('interactive');
  });

  it('dispatches lark_webhook with text template when configured', async () => {
    const effects: SkillEffect[] = [
      { type: 'lark_webhook', url: 'https://lark/t', template: 'text' },
    ];
    await runEffects(baseEntry(), baseChannel([]), effects);
    await new Promise(r => setTimeout(r, 0));
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.msg_type).toBe('text');
  });

  it('dispatches http_post with custom headers and JSON body', async () => {
    const effects: SkillEffect[] = [
      { type: 'http_post', url: 'https://api/x', headers: { 'X-Token': 'abc' } },
    ];
    await runEffects(baseEntry(), baseChannel([]), effects);
    await new Promise(r => setTimeout(r, 0));
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe('https://api/x');
    expect(call[1].headers['X-Token']).toBe('abc');
    expect(call[1].headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(call[1].body);
    expect(body.entry.id).toBe('e1');
    expect(body.channel.id).toBe('feedling');
  });
});

describe('runEffects bot path (M2b)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;
  });

  it('suppresses legacy lark_webhook when bindings exist (bot path is preferred)', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'Feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'a', boundAt: 0, chatName: 'G' });

    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };

    const entry = { id: 'e1', handle: 'a', teamId: 't1', client: 'desktop', content: 'c', summary: 's', tags: [], timestamp: 0 } as any;
    const channel = { id: 'feedling', teamId: 't1', name: 'Feedling', skills: [], subscribers: [], joinRule: 'open', createdBy: 'a', createdAt: 0 } as any;
    const effects = [{ type: 'lark_webhook', url: 'https://example.com/hook' } as any];
    await runEffects(entry, channel, effects, { larkApiClient: apiClient as any, storage });

    // legacy webhook suppressed when binding exists; bot push happens in pushBoundLarkChats (separate function)
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to legacy webhook when no bindings', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'Feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });
    const apiClient = { post: vi.fn(), get: vi.fn() };

    const entry = { id: 'e1', handle: 'a', teamId: 't1', client: 'desktop', content: 'c', summary: 's', tags: [], timestamp: 0 } as any;
    const channel = { id: 'feedling', teamId: 't1', name: 'Feedling', skills: [], subscribers: [], joinRule: 'open', createdBy: 'a', createdAt: 0 } as any;
    const effects = [{ type: 'lark_webhook', url: 'https://example.com/hook' } as any];
    await runEffects(entry, channel, effects, { larkApiClient: apiClient as any, storage });

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/hook', expect.anything());
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('pushBoundLarkChats (binding-driven push via evaluateChannelTriggers)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let markFired: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;
    markFired = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
  });

  it('pushes entry card to bound Lark chat when push_enabled=true (regardless of skill config)', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'Feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'a', boundAt: 0, chatName: 'G' });
    // Default is now FALSE — explicit opt-in is required.
    await storage.updateLarkBindingPushEnabled('oc_1', true);

    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };
    const entry = { id: 'e1', handle: 'a', teamId: 't1', client: 'desktop', content: 'c', summary: 's', tags: [], timestamp: 0 } as any;
    const channel = { id: 'feedling', teamId: 't1', name: 'Feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, subscribers: [], skills: [] } as any;
    await evaluateChannelTriggers(entry, channel, markFired, { larkApiClient: apiClient as any, storage });

    expect(apiClient.post).toHaveBeenCalledWith(
      '/open-apis/im/v1/messages?receive_id_type=chat_id',
      expect.objectContaining({ receive_id: 'oc_1', msg_type: 'interactive' }),
    );
  });

  it('does NOT push when push_enabled is unset (new default OFF)', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'Feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'a', boundAt: 0, chatName: 'G' });
    // No call to updateLarkBindingPushEnabled — default applies (FALSE / undefined)

    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };
    const entry = { id: 'e1', handle: 'a', teamId: 't1', client: 'desktop', content: 'c', summary: 's', tags: [], timestamp: 0 } as any;
    const channel = { id: 'feedling', teamId: 't1', name: 'Feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, subscribers: [], skills: [] } as any;
    await evaluateChannelTriggers(entry, channel, markFired, { larkApiClient: apiClient as any, storage });

    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('skips bindings with pushEnabled=false', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'a', createdAt: 0 } as any);
    await storage.createChannel({ id: 'feedling', teamId: 't1', name: 'Feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, skills: [], subscribers: [] });
    await storage.createLarkChatBinding({ chatId: 'oc_1', channelId: 'feedling', teamId: 't1', boundBy: 'a', boundAt: 0, chatName: 'G' });
    await storage.updateLarkBindingPushEnabled('oc_1', false);

    const apiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };
    const entry = { id: 'e1', handle: 'a', teamId: 't1', client: 'desktop', content: 'c', summary: 's', tags: [], timestamp: 0 } as any;
    const channel = { id: 'feedling', teamId: 't1', name: 'Feedling', joinRule: 'open', createdBy: 'a', createdAt: 0, subscribers: [], skills: [] } as any;
    await evaluateChannelTriggers(entry, channel, markFired, { larkApiClient: apiClient as any, storage });

    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('evaluateTagTriggers (multi-tag fan-out)', () => {
  let markFired: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
  let storage: MemoryStorage;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' }) as any;
    markFired = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    storage = new MemoryStorage();
  });

  it('fans out to every tag with a hash_config row', async () => {
    const webhookSkill: Skill = {
      id: 's1', name: 's1', description: '', instructions: '', exposeAs: 'context', createdAt: 0,
      triggers: [{ type: 'on_entry_write' }],
      effects: [{ type: 'lark_webhook', url: 'https://lark/a', template: 'card' }],
    };
    await storage.upsertTagConfig('t1', 'feedling', { skills: [webhookSkill], subscribers: [] });
    await storage.upsertTagConfig('t1', 'decision', {
      skills: [{ ...webhookSkill, effects: [{ type: 'lark_webhook', url: 'https://lark/b', template: 'card' }] }],
      subscribers: [],
    });

    const entry: RouterEntry = {
      id: 'e-fan', handle: 'ada', teamId: 't1', client: 'code',
      content: 'x', summary: 's', tags: ['feedling', 'decision', 'no-config'],
      timestamp: 1700000000000,
    };

    const fired = await evaluateTagTriggers(entry, storage, markFired);
    expect(fired.sort()).toEqual(['decision', 'feedling']);
    const calls = (global.fetch as any).mock.calls.map((c: any[]) => c[0]);
    expect(calls).toContain('https://lark/a');
    expect(calls).toContain('https://lark/b');
  });

  it('marks fired even when no tag has a hash_config row', async () => {
    const entry: RouterEntry = {
      id: 'e-cold', handle: 'ada', teamId: 't1', client: 'code',
      content: 'x', summary: 's', tags: ['untracked'],
      timestamp: 1700000000000,
    };
    const fired = await evaluateTagTriggers(entry, storage, markFired);
    expect(fired).toEqual([]);
    expect(markFired).toHaveBeenCalledWith('e-cold');
  });

  it('includes the legacy entry.channel value as a candidate tag', async () => {
    const webhookSkill: Skill = {
      id: 's1', name: 's1', description: '', instructions: '', exposeAs: 'context', createdAt: 0,
      triggers: [{ type: 'on_entry_write' }],
      effects: [{ type: 'lark_webhook', url: 'https://lark/legacy', template: 'card' }],
    };
    await storage.upsertTagConfig('t1', 'legacy-only', { skills: [webhookSkill], subscribers: [] });

    const entry: RouterEntry = {
      id: 'e-legacy', handle: 'ada', teamId: 't1', client: 'code',
      content: 'x', summary: 's', tags: [], channel: 'legacy-only',
      timestamp: 1700000000000,
    };
    const fired = await evaluateTagTriggers(entry, storage, markFired);
    expect(fired).toEqual(['legacy-only']);
  });
});
