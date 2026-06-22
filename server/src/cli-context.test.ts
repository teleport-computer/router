import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorage } from './storage.js';
import { buildContext, clearContextCache } from './cli-context.js';

describe('buildContext', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    clearContextCache();
  });

  it('returns defaults for fresh user', async () => {
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'u', createdAt: 0 });
    await storage.createUser({ handle: 'u', secretKeyHash: 'h', teamId: 't1' });
    const user = await storage.getUser('u');
    const ctx = await buildContext(storage, user!, 1_000_000);
    expect(ctx.version).toBe('1.0');
    expect(ctx.sync_mode).toBe('active');
    expect(ctx.preview_mode).toBe('always');
    expect(ctx.sync_triggers).toContain('sync');
    expect(ctx.sync_triggers).toContain('记一下');
    expect(ctx.privacy_strip_patterns.length).toBeGreaterThan(0);
    expect(ctx.skill_template_version).toBe('1.0.14');
    expect(ctx.last_updated).toBe(1000); // floor(1_000_000 / 1000)
  });

  it('caches by user handle', async () => {
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'u', createdAt: 0 });
    await storage.createUser({ handle: 'u', secretKeyHash: 'h', teamId: 't1' });
    const user = await storage.getUser('u');
    await buildContext(storage, user!, 1_000_000);
    await storage.updateUserPreferences('u', { syncMode: 'passive' });
    const updatedMid = await storage.getUser('u');
    const ctx2 = await buildContext(storage, updatedMid!, 1_000_000 + 60_000);
    expect(ctx2.sync_mode).toBe('active');  // still cached against handle
    const updated = await storage.getUser('u');
    const ctx3 = await buildContext(storage, updated!, 1_000_000 + 6 * 60_000);
    expect(ctx3.sync_mode).toBe('passive');  // cache expired
  });

  // NOTE: Channels are now team-public (see Storage.getSubscribedChannels comment),
  // so every team channel is visible regardless of subscriber list. We verify:
  //  - all team channels show up (no missing)
  //  - dedup: a channel referenced by a recent entry doesn't appear twice
  //  - skill summary + needs_second_call surface from channel.skills
  it('lists team channels with dedup and skill summary', async () => {
    await storage.createTeam({ id: 't1', name: 't', createdBy: 'u', createdAt: 0 });
    await storage.createUser({ handle: 'u', secretKeyHash: 'h', teamId: 't1' });
    await storage.createChannel({
      id: 'a', teamId: 't1', name: 'A', joinRule: 'open', createdBy: 'u', createdAt: 0,
      skills: [
        { id: 's1', name: 'route', description: 'restructure entry', instructions: 'do X', exposeAs: 'prewrite', createdAt: 0 },
        { id: 's2', name: 'note', description: 'context note', instructions: '', exposeAs: 'context', createdAt: 0 },
      ],
      subscribers: [{ handle: 'u', role: 'admin', joinedAt: 0 }],
    });
    await storage.createChannel({
      id: 'b', teamId: 't1', name: 'B', joinRule: 'open', createdBy: 'u', createdAt: 0,
      skills: [],
      subscribers: [],
    });
    // Entry referencing channel 'a' to exercise dedup path (a appears in subscribed AND active set)
    await storage.addEntry({
      handle: 'u', teamId: 't1', client: 'code', content: '', summary: 'x',
      tags: [], timestamp: Date.now(), channel: 'a',
    });
    const user = await storage.getUser('u');
    const ctx = await buildContext(storage, user!, Date.now());
    const ids = ctx.channels.map(c => c.id).sort();
    expect(ids).toEqual(['a', 'b']); // both visible, no duplicate of 'a'
    const a = ctx.channels.find(c => c.id === 'a')!;
    expect(a.needs_second_call).toBe(true); // has prewrite skill
    expect(a.skill).toContain('route');
    expect(a.skill).toContain('note');
    const b = ctx.channels.find(c => c.id === 'b')!;
    expect(b.needs_second_call).toBe(false);
    expect(b.skill).toBe('');
  });
});
