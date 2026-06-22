import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStorage, FileStorage, StagedStorage, isValidChannelId, isValidTeamId, teamNameToId, tokenize } from './storage.js';
import { hashSecretKey } from './identity.js';

describe('MemoryStorage', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  // ── Entry CRUD ──

  describe('Entry operations', () => {
    it('should add and retrieve an entry', async () => {
      const entry = await storage.addEntry({
        handle: 'taco',
        teamId: 'teleport',
        client: 'desktop',
        content: 'H5首页用Swiper做全屏滑动方案',
        summary: 'H5首页确认用Swiper做全屏滑动',
        tags: ['feedling', 'frontend', 'decision'],
        role: 'frontend',
        timestamp: Date.now(),
      });

      expect(entry.id).toBeDefined();
      expect(entry.handle).toBe('taco');
      expect(entry.teamId).toBe('teleport');
      expect(entry.summary).toBe('H5首页确认用Swiper做全屏滑动');
      expect(entry.tags).toEqual(['feedling', 'frontend', 'decision']);
      expect(entry.keywords).toBeDefined();
      expect(entry.keywords!.length).toBeGreaterThan(0);

      const found = await storage.getEntry(entry.id);
      expect(found).toEqual(entry);
    });

    it('should return null for nonexistent entry', async () => {
      expect(await storage.getEntry('nope')).toBeNull();
    });

    it('should delete an entry', async () => {
      const entry = await storage.addEntry({
        handle: 'taco',
        teamId: 'teleport',
        client: 'code',
        content: 'test',
        summary: 'test',
        tags: ['test'],
        timestamp: Date.now(),
      });

      await storage.deleteEntry(entry.id);
      expect(await storage.getEntry(entry.id)).toBeNull();
    });
  });

  // ── Team isolation ──

  describe('Team isolation', () => {
    beforeEach(async () => {
      await storage.addEntry({
        handle: 'alice', teamId: 'team-a', client: 'desktop',
        content: 'Team A entry about swiper', summary: 'Team A swiper',
        tags: ['frontend', 'swiper'], timestamp: 1000,
      });
      await storage.addEntry({
        handle: 'bob', teamId: 'team-b', client: 'code',
        content: 'Team B entry about swiper', summary: 'Team B swiper',
        tags: ['frontend', 'swiper'], timestamp: 2000,
      });
    });

    it('getEntries returns only entries for the specified team', async () => {
      const a = await storage.getEntries('team-a');
      expect(a).toHaveLength(1);
      expect(a[0].handle).toBe('alice');

      const b = await storage.getEntries('team-b');
      expect(b).toHaveLength(1);
      expect(b[0].handle).toBe('bob');
    });

    it('searchEntries respects team isolation', async () => {
      const a = await storage.searchEntries('team-a', 'swiper');
      expect(a).toHaveLength(1);
      expect(a[0].teamId).toBe('team-a');

      const b = await storage.searchEntries('team-b', 'swiper');
      expect(b).toHaveLength(1);
      expect(b[0].teamId).toBe('team-b');
    });

    it('getEntriesByTags respects team isolation', async () => {
      const a = await storage.getEntriesByTags('team-a', ['frontend']);
      expect(a).toHaveLength(1);
      expect(a[0].teamId).toBe('team-a');
    });

    it('getEntriesSince respects team isolation', async () => {
      const a = await storage.getEntriesSince('team-a', 0);
      expect(a).toHaveLength(1);
    });

    it('getEntryCount can filter by team', async () => {
      expect(await storage.getEntryCount('team-a')).toBe(1);
      expect(await storage.getEntryCount('team-b')).toBe(1);
      expect(await storage.getEntryCount()).toBe(2);
    });

    it('getChannelEntries respects team isolation', async () => {
      await storage.addEntry({
        handle: 'alice', teamId: 'team-a', client: 'code',
        content: 'channel post', summary: 'channel post',
        tags: ['feedling'], timestamp: 3000, to: ['#feedling'],
      });
      await storage.addEntry({
        handle: 'bob', teamId: 'team-b', client: 'code',
        content: 'other channel post', summary: 'other post',
        tags: ['feedling'], timestamp: 4000, to: ['#feedling'],
      });

      const a = await storage.getChannelEntries('team-a', 'feedling');
      expect(a).toHaveLength(1);
      expect(a[0].teamId).toBe('team-a');
    });
  });

  // ── Tag operations ──

  describe('Tag operations', () => {
    beforeEach(async () => {
      await storage.addEntry({
        handle: 'taco', teamId: 'teleport', client: 'desktop',
        content: 'Entry 1', summary: 'Summary 1',
        tags: ['feedling', 'frontend', 'decision'], timestamp: 1000,
      });
      await storage.addEntry({
        handle: 'andrew', teamId: 'teleport', client: 'code',
        content: 'Entry 2', summary: 'Summary 2',
        tags: ['feedling', 'backend', 'api'], timestamp: 2000,
      });
      await storage.addEntry({
        handle: 'liko', teamId: 'teleport', client: 'desktop',
        content: 'Entry 3', summary: 'Summary 3',
        tags: ['design', 'brainstorm'], timestamp: 3000,
      });
    });

    it('getEntriesByTags with single tag', async () => {
      const results = await storage.getEntriesByTags('teleport', ['feedling']);
      expect(results).toHaveLength(2);
    });

    it('getEntriesByTags with multiple tags (AND logic)', async () => {
      const results = await storage.getEntriesByTags('teleport', ['feedling', 'frontend']);
      expect(results).toHaveLength(1);
      expect(results[0].handle).toBe('taco');
    });

    it('getEntriesByTags with no matches', async () => {
      const results = await storage.getEntriesByTags('teleport', ['nonexistent']);
      expect(results).toHaveLength(0);
    });

    it('updateEntryTags updates tags and keywords', async () => {
      const entries = await storage.getEntries('teleport');
      const entry = entries[0];

      const updated = await storage.updateEntryTags(entry.id, ['new-tag', 'urgent']);
      expect(updated).not.toBeNull();
      expect(updated!.tags).toEqual(['new-tag', 'urgent']);

      // Keywords should be regenerated
      const found = await storage.getEntry(entry.id);
      expect(found!.tags).toEqual(['new-tag', 'urgent']);
    });

    it('updateEntryTags returns null for nonexistent entry', async () => {
      expect(await storage.updateEntryTags('nope', ['x'])).toBeNull();
    });

    it('getTagStats returns tag counts sorted by frequency', async () => {
      const stats = await storage.getTagStats('teleport');
      expect(stats[0]).toEqual({ tag: 'feedling', count: 2 });
      expect(stats.find(s => s.tag === 'design')).toEqual({ tag: 'design', count: 1 });
    });

    it('getTagStats is team-scoped', async () => {
      await storage.addEntry({
        handle: 'bob', teamId: 'other-team', client: 'code',
        content: 'other', summary: 'other',
        tags: ['feedling'], timestamp: 9000,
      });

      const stats = await storage.getTagStats('teleport');
      const feedling = stats.find(s => s.tag === 'feedling');
      expect(feedling!.count).toBe(2); // Only teleport's entries
    });
  });

  // ── User operations ──

  describe('User operations', () => {
    const testUser = {
      handle: 'taco',
      secretKeyHash: hashSecretKey('test-secret-key-1234567890'),
      teamId: 'teleport',
      displayName: 'Taco',
      isAdmin: true,
    };

    it('should create and retrieve a user', async () => {
      const user = await storage.createUser(testUser);
      expect(user.handle).toBe('taco');
      expect(user.teamId).toBe('teleport');
      expect(user.isAdmin).toBe(true);
      expect(user.createdAt).toBeDefined();

      const found = await storage.getUser('taco');
      expect(found).toEqual(user);
    });

    it('should find user by key tag', async () => {
      await storage.createUser(testUser);
      const found = await storage.getUserByKeyHash(testUser.secretKeyHash);
      expect(found).not.toBeNull();
      expect(found!.handle).toBe('taco');
    });

    it('should return null for unknown key tag', async () => {
      expect(await storage.getUserByKeyHash('unknown')).toBeNull();
    });

    it('should update user', async () => {
      await storage.createUser(testUser);
      const updated = await storage.updateUser('taco', { displayName: 'New Name', role: 'frontend' });
      expect(updated!.displayName).toBe('New Name');
      expect(updated!.role).toBe('frontend');
    });

    it('isHandleAvailable', async () => {
      expect(await storage.isHandleAvailable('taco')).toBe(true);
      await storage.createUser(testUser);
      expect(await storage.isHandleAvailable('taco')).toBe(false);
    });

    it('getAllUsers can filter by team', async () => {
      await storage.createUser(testUser);
      await storage.createUser({
        handle: 'bob', secretKeyHash: hashSecretKey('bob-key-1234567890abcdef'),
        teamId: 'other-team',
      });

      expect((await storage.getAllUsers('teleport'))).toHaveLength(1);
      expect((await storage.getAllUsers('other-team'))).toHaveLength(1);
      expect((await storage.getAllUsers())).toHaveLength(2);
    });

    it('updateUserPreferences updates sync_mode and persists', async () => {
      await storage.createUser({ handle: 'u1', secretKeyHash: 'h', teamId: 't' });
      await storage.updateUserPreferences('u1', { syncMode: 'passive', previewMode: 'never' });
      const u = await storage.getUser('u1');
      expect(u?.syncMode).toBe('passive');
      expect(u?.previewMode).toBe('never');
    });
  });

  // ── Team operations ──

  describe('Team operations', () => {
    it('should create and retrieve a team', async () => {
      const team = await storage.createTeam({
        id: 'teleport', name: 'Teleport', createdBy: 'taco', createdAt: Date.now(),
      });
      expect(team.id).toBe('teleport');

      const found = await storage.getTeam('teleport');
      expect(found).toEqual(team);
    });

    it('should reject duplicate team ID', async () => {
      await storage.createTeam({
        id: 'teleport', name: 'Teleport', createdBy: 'taco', createdAt: Date.now(),
      });
      await expect(storage.createTeam({
        id: 'teleport', name: 'Teleport 2', createdBy: 'bob', createdAt: Date.now(),
      })).rejects.toThrow('already exists');
    });

    it('isTeamIdAvailable', async () => {
      expect(await storage.isTeamIdAvailable('teleport')).toBe(true);
      await storage.createTeam({
        id: 'teleport', name: 'Teleport', createdBy: 'taco', createdAt: Date.now(),
      });
      expect(await storage.isTeamIdAvailable('teleport')).toBe(false);
    });
  });

  // ── Team invite operations ──

  describe('TeamInvite operations', () => {
    it('should create and use an invite', async () => {
      const invite = await storage.createTeamInvite({
        code: 'tpr-abc123',
        teamId: 'teleport',
        createdBy: 'taco',
        createdAt: Date.now(),
        maxUses: 5,
        uses: 0,
      });
      expect(invite.code).toBe('tpr-abc123');

      const used = await storage.useTeamInvite('tpr-abc123');
      expect(used.uses).toBe(1);
    });

    it('should reject nonexistent invite', async () => {
      await expect(storage.useTeamInvite('nope')).rejects.toThrow('not found');
    });

    it('should reject expired invite', async () => {
      await storage.createTeamInvite({
        code: 'tpr-expired',
        teamId: 'teleport',
        createdBy: 'taco',
        createdAt: Date.now() - 100000,
        expiresAt: Date.now() - 1000, // Already expired
        uses: 0,
      });
      await expect(storage.useTeamInvite('tpr-expired')).rejects.toThrow('expired');
    });

    it('should reject invite that reached max uses', async () => {
      await storage.createTeamInvite({
        code: 'tpr-maxed',
        teamId: 'teleport',
        createdBy: 'taco',
        createdAt: Date.now(),
        maxUses: 1,
        uses: 1,
      });
      await expect(storage.useTeamInvite('tpr-maxed')).rejects.toThrow('maximum uses');
    });

    it('listTeamInvites filters by team', async () => {
      await storage.createTeamInvite({
        code: 'tpr-a', teamId: 'teleport', createdBy: 'taco', createdAt: Date.now(), uses: 0,
      });
      await storage.createTeamInvite({
        code: 'tpr-b', teamId: 'acme', createdBy: 'bob', createdAt: Date.now(), uses: 0,
      });

      expect((await storage.listTeamInvites('teleport'))).toHaveLength(1);
      expect((await storage.listTeamInvites('acme'))).toHaveLength(1);
    });
  });

  // ── Channel operations ──

  describe('Channel operations', () => {
    it('should create and retrieve a channel', async () => {
      const channel = await storage.createChannel({
        id: 'feedling', teamId: 'teleport', name: 'Feedling',
        joinRule: 'open', createdBy: 'taco', createdAt: Date.now(),
        skills: [], subscribers: [{ handle: 'taco', role: 'admin', joinedAt: Date.now() }],
      });

      const found = await storage.getChannel('feedling');
      expect(found!.id).toBe('feedling');
      expect(found!.teamId).toBe('teleport');
    });

    it('listChannels filters by team', async () => {
      await storage.createChannel({
        id: 'ch-a', teamId: 'teleport', name: 'A',
        joinRule: 'open', createdBy: 'taco', createdAt: Date.now(),
        skills: [], subscribers: [],
      });
      await storage.createChannel({
        id: 'ch-b', teamId: 'acme', name: 'B',
        joinRule: 'open', createdBy: 'bob', createdAt: Date.now(),
        skills: [], subscribers: [],
      });

      expect((await storage.listChannels('teleport'))).toHaveLength(1);
      expect((await storage.listChannels('acme'))).toHaveLength(1);
    });

    it('should add and remove subscribers', async () => {
      await storage.createChannel({
        id: 'feedling', teamId: 'teleport', name: 'Feedling',
        joinRule: 'open', createdBy: 'taco', createdAt: Date.now(),
        skills: [], subscribers: [],
      });

      await storage.addSubscriber('feedling', 'taco', 'admin');
      await storage.addSubscriber('feedling', 'andrew', 'member');

      let ch = await storage.getChannel('feedling');
      expect(ch!.subscribers).toHaveLength(2);

      await storage.removeSubscriber('feedling', 'andrew');
      ch = await storage.getChannel('feedling');
      expect(ch!.subscribers).toHaveLength(1);
    });

    it('getSubscribedChannels returns all team channels (team-public)', async () => {
      await storage.createUser({
        handle: 'taco', secretKeyHash: 'h-taco', displayName: 'Taco',
        teamId: 'teleport',
      });
      await storage.createChannel({
        id: 'feedling', teamId: 'teleport', name: 'Feedling',
        joinRule: 'open', createdBy: 'taco', createdAt: Date.now(),
        skills: [], subscribers: [{ handle: 'taco', role: 'admin', joinedAt: Date.now() }],
      });
      await storage.createChannel({
        id: 'random', teamId: 'teleport', name: 'Random',
        joinRule: 'open', createdBy: 'taco', createdAt: Date.now(),
        skills: [], subscribers: [],
      });
      await storage.createChannel({
        id: 'other-team', teamId: 'acme', name: 'Other',
        joinRule: 'open', createdBy: 'bob', createdAt: Date.now(),
        skills: [], subscribers: [],
      });

      const channels = await storage.getSubscribedChannels('taco');
      expect(channels.map(c => c.id).sort()).toEqual(['feedling', 'random']);
    });
  });

  // ── TagConfig operations (B-plus successor to channels) ──

  describe('TagConfig operations', () => {
    it('upsertTagConfig creates a row on first call and updates on second', async () => {
      const created = await storage.upsertTagConfig('teleport', 'feedling', {
        name: 'Feedling',
        description: 'product feed',
        createdBy: 'taco',
        skills: [],
        subscribers: [],
      });
      expect(created.tag).toBe('feedling');
      expect(created.teamId).toBe('teleport');
      expect(created.name).toBe('Feedling');
      expect(created.createdAt).toBeGreaterThan(0);

      const updated = await storage.upsertTagConfig('teleport', 'feedling', {
        description: 'updated description',
      });
      expect(updated.name).toBe('Feedling');
      expect(updated.description).toBe('updated description');
    });

    it('getTagConfig returns null for missing tag', async () => {
      expect(await storage.getTagConfig('teleport', 'no-such')).toBeNull();
    });

    it('same tag in different teams is isolated', async () => {
      await storage.upsertTagConfig('teleport', 'decision', { name: 'A', skills: [], subscribers: [] });
      await storage.upsertTagConfig('acme',     'decision', { name: 'B', skills: [], subscribers: [] });

      const teleport = await storage.getTagConfig('teleport', 'decision');
      const acme     = await storage.getTagConfig('acme', 'decision');
      expect(teleport!.name).toBe('A');
      expect(acme!.name).toBe('B');
    });

    it('listTagConfigs filters by team', async () => {
      await storage.upsertTagConfig('teleport', 'a', { skills: [], subscribers: [] });
      await storage.upsertTagConfig('teleport', 'b', { skills: [], subscribers: [] });
      await storage.upsertTagConfig('acme',     'c', { skills: [], subscribers: [] });

      const tp = await storage.listTagConfigs('teleport');
      expect(tp.map(c => c.tag).sort()).toEqual(['a', 'b']);
      expect((await storage.listTagConfigs('acme')).map(c => c.tag)).toEqual(['c']);
    });

    it('addTagSubscriber auto-creates the row (B-plus)', async () => {
      // No prior upsert — addTagSubscriber alone should bring the row to life.
      const cfg = await storage.addTagSubscriber('teleport', 'fresh-tag', 'taco');
      expect(cfg.tag).toBe('fresh-tag');
      expect(cfg.subscribers).toHaveLength(1);
      expect(cfg.subscribers[0].handle).toBe('taco');
      expect(cfg.subscribers[0].role).toBe('member');
    });

    it('addTagSubscriber is idempotent', async () => {
      await storage.addTagSubscriber('teleport', 'h', 'taco');
      await storage.addTagSubscriber('teleport', 'h', 'taco');
      const cfg = await storage.getTagConfig('teleport', 'h');
      expect(cfg!.subscribers).toHaveLength(1);
    });

    it('removeTagSubscriber drops one subscriber and leaves the row', async () => {
      await storage.addTagSubscriber('teleport', 'h', 'taco');
      await storage.addTagSubscriber('teleport', 'h', 'andrew');
      await storage.removeTagSubscriber('teleport', 'h', 'andrew');
      const cfg = await storage.getTagConfig('teleport', 'h');
      expect(cfg!.subscribers.map(s => s.handle)).toEqual(['taco']);
    });

    it('removeTagSubscriber returns null when row is missing', async () => {
      expect(await storage.removeTagSubscriber('teleport', 'missing', 'taco')).toBeNull();
    });

    it('getSubscribedTags returns hashes where handle is in subscribers', async () => {
      await storage.createUser({
        handle: 'taco', secretKeyHash: 'h', displayName: 'T', teamId: 'teleport',
      });
      await storage.addTagSubscriber('teleport', 'a', 'taco');
      await storage.addTagSubscriber('teleport', 'b', 'andrew'); // not taco
      const subs = await storage.getSubscribedTags('taco');
      expect(subs.map(s => s.tag)).toEqual(['a']);
    });

    it('getEntriesByTag unions tags[] and legacy channel column', async () => {
      // Entry tagged via tags[]
      await storage.addEntry({
        handle: 'taco', teamId: 'teleport', client: 'code',
        content: 'tagged', summary: 'tagged', tags: ['feedling'], timestamp: 2000,
      });
      // Entry written with legacy channel value, no tag in tags[]
      await storage.addEntry({
        handle: 'taco', teamId: 'teleport', client: 'code',
        content: 'legacy', summary: 'legacy', tags: [], channel: 'feedling', timestamp: 1000,
      });
      // Unrelated
      await storage.addEntry({
        handle: 'taco', teamId: 'teleport', client: 'code',
        content: 'other', summary: 'other', tags: ['other'], timestamp: 500,
      });

      const result = await storage.getEntriesByTag('teleport', 'feedling');
      const summaries = result.map(e => e.summary).sort();
      expect(summaries).toEqual(['legacy', 'tagged']);
    });

    it('legacy createChannel reads back via getTagConfig', async () => {
      await storage.createChannel({
        id: 'cross', teamId: 'teleport', name: 'Cross',
        joinRule: 'open', createdBy: 'taco', createdAt: Date.now(),
        skills: [], subscribers: [{ handle: 'taco', role: 'admin', joinedAt: Date.now() }],
      });
      const cfg = await storage.getTagConfig('teleport', 'cross');
      expect(cfg).not.toBeNull();
      expect(cfg!.subscribers).toHaveLength(1);
      expect(cfg!.subscribers[0].handle).toBe('taco');
    });

    it('legacy addSubscriber writes through to tag_configs', async () => {
      await storage.upsertTagConfig('teleport', 'wire', { skills: [], subscribers: [] });
      await storage.addSubscriber('wire', 'taco', 'member');
      const cfg = await storage.getTagConfig('teleport', 'wire');
      expect(cfg!.subscribers.map(s => s.handle)).toEqual(['taco']);
    });
  });

  // ── Addressing ──

  describe('Addressing', () => {
    it('getEntriesAddressedTo finds entries sent to a handle', async () => {
      await storage.addEntry({
        handle: 'alice', teamId: 'teleport', client: 'code',
        content: 'hey', summary: 'message to bob',
        tags: [], timestamp: 1000, to: ['@bob'],
      });
      await storage.addEntry({
        handle: 'alice', teamId: 'teleport', client: 'code',
        content: 'public', summary: 'public post',
        tags: [], timestamp: 2000,
      });

      const results = await storage.getEntriesAddressedTo('teleport', 'bob');
      expect(results).toHaveLength(1);
      expect(results[0].summary).toBe('message to bob');
    });

    it('getRepliesTo finds replies to an entry', async () => {
      const parent = await storage.addEntry({
        handle: 'taco', teamId: 'teleport', client: 'desktop',
        content: 'parent', summary: 'parent post',
        tags: ['test'], timestamp: 1000,
      });
      await storage.addEntry({
        handle: 'andrew', teamId: 'teleport', client: 'code',
        content: 'reply', summary: 'reply post',
        tags: ['test'], timestamp: 2000, inReplyTo: parent.id,
      });

      const replies = await storage.getRepliesTo(parent.id);
      expect(replies).toHaveLength(1);
      expect(replies[0].summary).toBe('reply post');
    });
  });

  describe('Preset tag operations', () => {
    it('should add and list preset tags', async () => {
      const tag = await storage.addPresetTag({ name: 'update', description: 'Daily work progress', createdAt: Date.now() });
      expect(tag.name).toBe('update');
      expect(tag.description).toBe('Daily work progress');

      const all = await storage.getPresetTags();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('update');
    });

    it('should update preset tag description', async () => {
      await storage.addPresetTag({ name: 'bugfix', description: 'Bug fix', createdAt: Date.now() });
      const updated = await storage.updatePresetTag('bugfix', 'Bug fix record');
      expect(updated).not.toBeNull();
      expect(updated!.description).toBe('Bug fix record');
    });

    it('should return null when updating non-existent preset tag', async () => {
      const result = await storage.updatePresetTag('nope', 'desc');
      expect(result).toBeNull();
    });

    it('should delete preset tag', async () => {
      await storage.addPresetTag({ name: 'temp', description: 'Temporary', createdAt: Date.now() });
      const deleted = await storage.deletePresetTag('temp');
      expect(deleted).toBe(true);

      const all = await storage.getPresetTags();
      expect(all).toHaveLength(0);
    });

    it('should return false when deleting non-existent preset tag', async () => {
      const deleted = await storage.deletePresetTag('nope');
      expect(deleted).toBe(false);
    });

    it('should reject duplicate preset tag names', async () => {
      await storage.addPresetTag({ name: 'update', description: 'desc1', createdAt: Date.now() });
      await expect(storage.addPresetTag({ name: 'update', description: 'desc2', createdAt: Date.now() }))
        .rejects.toThrow();
    });
  });
});

// ── Utility functions ──

describe('Utility functions', () => {
  it('isValidChannelId', () => {
    expect(isValidChannelId('feedling')).toBe(true);
    expect(isValidChannelId('my-channel')).toBe(true);
    expect(isValidChannelId('a')).toBe(false);
    expect(isValidChannelId('-bad')).toBe(false);
  });

  it('isValidTeamId', () => {
    expect(isValidTeamId('teleport')).toBe(true);
    expect(isValidTeamId('my-team')).toBe(true);
    expect(isValidTeamId('a')).toBe(false);
  });

  it('teamNameToId', () => {
    expect(teamNameToId('Teleport')).toBe('teleport');
    expect(teamNameToId('My Cool Team')).toBe('my-cool-team');
    expect(teamNameToId('  Spaces  ')).toBe('spaces');
  });

  it('tokenize', () => {
    const tokens = tokenize('Hello world, this is a test of tokenization');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('test');
    expect(tokens).toContain('tokenization');
    expect(tokens).not.toContain('this'); // stop word
    expect(tokens).not.toContain('is');   // stop word
    expect(tokens).not.toContain('a');    // too short
  });
});

describe('FileStorage skill migration', () => {
  let tmpFile: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'router-skill-mig-'));
    tmpFile = join(dir, 'data.json');
  });

  afterEach(() => {
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
  });

  it('migrates legacy webhook_url skill to effects + triggers + exposeAs', async () => {
    const legacy = {
      entries: [],
      users: [],
      teams: [],
      teamInvites: [],
      channels: [
        ['feedling', {
          id: 'feedling',
          teamId: 'team-a',
          name: 'Feedling',
          joinRule: 'open',
          createdBy: '@hx',
          createdAt: 1700000000000,
          subscribers: [],
          skills: [{
            id: 'feedling_lark',
            name: 'lark',
            description: 'old skill',
            instructions: '',
            webhook_url: 'https://open.feishu.cn/legacy',
            handlerType: 'instructions',
            createdAt: 1700000000000,
          }],
        }],
      ],
      channelInvites: [],
      notifications: [],
      nextId: 1,
    };
    writeFileSync(tmpFile, JSON.stringify(legacy));

    const storage = new FileStorage(tmpFile);
    const ch = await storage.getChannel('feedling');
    expect(ch).not.toBeNull();
    const skill = ch!.skills[0];
    expect(skill.exposeAs).toBe('context');
    expect(skill.triggers).toEqual([{ type: 'on_entry_write' }]);
    expect(skill.effects).toEqual([
      { type: 'lark_webhook', url: 'https://open.feishu.cn/legacy', template: 'card' },
    ]);
    expect((skill as any).webhook_url).toBeUndefined();
    expect((skill as any).handlerType).toBeUndefined();
  });

  it('leaves already-migrated skills alone (idempotent)', async () => {
    const modern = {
      entries: [], users: [], teams: [], teamInvites: [],
      channels: [
        ['c1', {
          id: 'c1', teamId: 'team-a', name: 'C1', joinRule: 'open',
          createdBy: '@hx', createdAt: 1700000000000, subscribers: [],
          skills: [{
            id: 'c1_x', name: 'x', description: '', instructions: '',
            exposeAs: 'tool',
            triggers: [{ type: 'manual' }],
            effects: [],
            createdAt: 1700000000000,
          }],
        }],
      ],
      channelInvites: [], notifications: [], nextId: 1,
    };
    writeFileSync(tmpFile, JSON.stringify(modern));

    const storage = new FileStorage(tmpFile);
    const ch = await storage.getChannel('c1');
    const skill = ch!.skills[0];
    expect(skill.exposeAs).toBe('tool');
    expect(skill.triggers).toEqual([{ type: 'manual' }]);
    expect(skill.effects).toEqual([]);
  });

  it('handles a legacy skill with no webhook_url (just adds exposeAs)', async () => {
    const legacy = {
      entries: [], users: [], teams: [], teamInvites: [],
      channels: [
        ['c2', {
          id: 'c2', teamId: 'team-a', name: 'C2', joinRule: 'open',
          createdBy: '@hx', createdAt: 1700000000000, subscribers: [],
          skills: [{
            id: 'c2_y', name: 'y', description: 'instr-only', instructions: 'do something',
            handlerType: 'instructions',
            createdAt: 1700000000000,
          }],
        }],
      ],
      channelInvites: [], notifications: [], nextId: 1,
    };
    writeFileSync(tmpFile, JSON.stringify(legacy));

    const storage = new FileStorage(tmpFile);
    const ch = await storage.getChannel('c2');
    const skill = ch!.skills[0];
    expect(skill.exposeAs).toBe('tool');
    expect(skill.triggers).toBeUndefined();
    expect(skill.effects).toBeUndefined();
    expect((skill as any).handlerType).toBeUndefined();
  });
});

describe('Team members with recent activity (data path for /api/team/members)', () => {
  let storage: MemoryStorage;

  beforeEach(async () => {
    storage = new MemoryStorage();

    // Two users on team-a, one on team-b
    await storage.createUser({
      handle: 'ada', secretKeyHash: 'h1', teamId: 'team-a',
      displayName: 'Ada Chen', role: 'frontend',
    });
    await storage.createUser({
      handle: 'bob', secretKeyHash: 'h2', teamId: 'team-a',
      displayName: 'Bob Wei', role: 'backend',
    });
    await storage.createUser({
      handle: 'eve', secretKeyHash: 'h3', teamId: 'team-b',
      displayName: 'Eve', role: 'design',
    });

    // ada has 4 entries (we'll keep top 3)
    for (let i = 1; i <= 4; i++) {
      await storage.addEntry({
        handle: 'ada', teamId: 'team-a', client: 'code',
        content: `c${i}`, summary: `ada entry ${i}`, tags: ['frontend'],
        timestamp: 1700000000000 + i * 1000,
      });
    }
    // bob has no entries
    // eve (other team) has entries that should NOT leak
    await storage.addEntry({
      handle: 'eve', teamId: 'team-b', client: 'code',
      content: 'leak', summary: 'should not leak', tags: ['design'],
      timestamp: 1700000999999,
    });
  });

  it('returns all team members with up to 3 most recent entries each', async () => {
    const users = await storage.getAllUsers('team-a');
    expect(users.map(u => u.handle).sort()).toEqual(['ada', 'bob']);

    const adaEntries = await storage.getEntriesByHandle('team-a', 'ada', 3);
    expect(adaEntries).toHaveLength(3);
    // Most recent first
    expect(adaEntries[0].summary).toBe('ada entry 4');
    expect(adaEntries[1].summary).toBe('ada entry 3');
    expect(adaEntries[2].summary).toBe('ada entry 2');

    const bobEntries = await storage.getEntriesByHandle('team-a', 'bob', 3);
    expect(bobEntries).toHaveLength(0);
  });

  it('does not leak entries across teams', async () => {
    const adaEntriesInWrongTeam = await storage.getEntriesByHandle('team-b', 'ada', 3);
    expect(adaEntriesInWrongTeam).toHaveLength(0);
  });

  it('hidden entries do not crowd out visible ones when using a buffer limit', async () => {
    // Add a hidden entry for ada with the highest timestamp (it would be #1 if visible)
    const hiddenEntry = await storage.addEntry({
      handle: 'ada', teamId: 'team-a', client: 'code',
      content: 'h', summary: 'hidden entry', tags: [],
      timestamp: 1700000099999,
    });
    await storage.updateEntry(hiddenEntry.id, { hidden: true });

    // With limit=3: fetches [hidden@99999, ada4, ada3] — after filter: [ada4, ada3] → only 2
    const tooTight = await storage.getEntriesByHandle('team-a', 'ada', 3);
    const visibleTight = tooTight.filter(e => !e.hidden);
    expect(visibleTight).toHaveLength(2); // proves limit=3 is NOT enough

    // With limit=50 (buffer): fetches all 5 entries — after filter: [ada4, ada3, ada2, ada1] → 4 visible
    const buffered = await storage.getEntriesByHandle('team-a', 'ada', 50);
    const visibleBuffered = buffered.filter(e => !e.hidden);
    expect(visibleBuffered.length).toBeGreaterThanOrEqual(3); // proves the buffer works
    expect(visibleBuffered[0].summary).toBe('ada entry 4'); // still newest-first after skipping hidden
  });
});

describe('StagedStorage persistence across restarts', () => {
  it('rehydrates pending entries from the backing storage', async () => {
    // Simulate server lifecycle: create staged, add a pending entry, then
    // instantiate a fresh StagedStorage sharing the same backing storage.
    const backing = new MemoryStorage();
    const staging = new StagedStorage(60_000, backing);

    const draft = await staging.addEntry({
      handle: 'ada', teamId: 'team-a', client: 'code',
      content: 'draft content', summary: 'a draft', tags: ['wip'],
      timestamp: Date.now(),
    });

    expect(staging.isPending(draft.id)).toBe(true);
    // Pending is visible to its author and not to others.
    const asAuthor = await staging.getEntries('team-a', 50, 0, undefined, 'ada');
    expect(asAuthor.map(e => e.id)).toContain(draft.id);
    const asStranger = await staging.getEntries('team-a', 50);
    expect(asStranger.map(e => e.id)).not.toContain(draft.id);

    // Shut down and re-instantiate — pending must survive.
    staging.stop();
    const reborn = new StagedStorage(60_000, backing);
    expect(reborn.isPending(draft.id)).toBe(false); // index starts empty
    const n = await reborn.rehydratePending();
    expect(n).toBe(1);
    expect(reborn.isPending(draft.id)).toBe(true);

    // Still hidden from strangers after rehydration.
    const strangerAgain = await reborn.getEntries('team-a', 50);
    expect(strangerAgain.map(e => e.id)).not.toContain(draft.id);
    reborn.stop();
  });

  it('publishing clears publishAt and makes the entry visible to everyone', async () => {
    const backing = new MemoryStorage();
    const staging = new StagedStorage(60_000, backing);
    const draft = await staging.addEntry({
      handle: 'ada', teamId: 'team-a', client: 'code',
      content: 'x', summary: 'x', tags: ['wip'],
      timestamp: Date.now(),
    });

    const published = await staging.publishEntry(draft.id);
    expect(published?.id).toBe(draft.id);
    expect(published?.publishAt ?? null).toBe(null);
    expect(staging.isPending(draft.id)).toBe(false);

    const visible = await staging.getEntries('team-a', 50);
    expect(visible.map(e => e.id)).toContain(draft.id);
    staging.stop();
  });
});

describe('MemoryStorage — Lark binding', () => {
  let storage: MemoryStorage;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 'Team 1', createdBy: 'alice', createdAt: Date.now() });
    await storage.createUser({ handle: 'alice', secretKeyHash: 'tag-a', teamId: 't1' });
    await storage.createUser({ handle: 'bob', secretKeyHash: 'tag-b', teamId: 't1' });
  });

  it('getUserByLarkOpenId returns null when no one is bound', async () => {
    expect(await storage.getUserByLarkOpenId('ou_xyz')).toBeNull();
  });

  it('bindLarkAccount writes lark fields and returns updated user', async () => {
    const user = await storage.bindLarkAccount('alice', {
      larkOpenId: 'ou_xyz',
      larkName: 'Alice Wang',
      larkRefreshToken: 'rt-1',
      larkRefreshTokenExpiresAt: Date.now() + 30 * 86400 * 1000,
      larkScopes: ['contact:user.id:readonly'],
      larkBoundAt: Date.now(),
    });
    expect(user?.larkOpenId).toBe('ou_xyz');
    expect(user?.larkName).toBe('Alice Wang');
    expect(await storage.getUserByLarkOpenId('ou_xyz')).toMatchObject({ handle: 'alice' });
  });

  it('bindLarkAccount returns null on open_id conflict (different user)', async () => {
    const fields = {
      larkOpenId: 'ou_xyz',
      larkRefreshToken: 'rt',
      larkRefreshTokenExpiresAt: 0,
      larkScopes: [],
      larkBoundAt: 0,
    };
    await storage.bindLarkAccount('alice', fields);
    const result = await storage.bindLarkAccount('bob', fields);
    expect(result).toBeNull();
  });

  it('bindLarkAccount allows same user to re-bind same open_id (idempotent)', async () => {
    const fields = {
      larkOpenId: 'ou_xyz',
      larkRefreshToken: 'rt',
      larkRefreshTokenExpiresAt: 0,
      larkScopes: [],
      larkBoundAt: 0,
    };
    await storage.bindLarkAccount('alice', fields);
    const result = await storage.bindLarkAccount('alice', { ...fields, larkRefreshToken: 'rt-new' });
    expect(result?.larkRefreshToken).toBe('rt-new');
  });

  it('unbindLarkAccount clears all lark fields', async () => {
    await storage.bindLarkAccount('alice', {
      larkOpenId: 'ou_xyz',
      larkRefreshToken: 'rt',
      larkRefreshTokenExpiresAt: 0,
      larkScopes: [],
      larkBoundAt: 0,
    });
    const user = await storage.unbindLarkAccount('alice');
    expect(user?.larkOpenId).toBeUndefined();
    expect(user?.larkRefreshToken).toBeUndefined();
    expect(await storage.getUserByLarkOpenId('ou_xyz')).toBeNull();
  });

  it('unbinding then re-binding the same open_id to a different user works', async () => {
    const fields = {
      larkOpenId: 'ou_xyz',
      larkRefreshToken: 'rt',
      larkRefreshTokenExpiresAt: 0,
      larkScopes: [],
      larkBoundAt: 0,
    };
    await storage.bindLarkAccount('alice', fields);
    await storage.unbindLarkAccount('alice');
    const result = await storage.bindLarkAccount('bob', fields);
    expect(result?.handle).toBe('bob');
  });
});

describe('MemoryStorage — Matrix binding', () => {
  it('getUserByMatrixUserId returns null when no one is bound', async () => {
    const storage = new MemoryStorage();
    await storage.createUser({ handle: 'alice', secretKeyHash: 'h1', teamId: 't1' });
    expect(await storage.getUserByMatrixUserId('@alice:mtrx.shaperotator.xyz')).toBeNull();
  });

  it('bindMatrixAccount writes Matrix fields and returns updated user', async () => {
    const storage = new MemoryStorage();
    await storage.createUser({ handle: 'alice', secretKeyHash: 'h1', teamId: 't1' });

    const bound = await storage.bindMatrixAccount('alice', '@alice:mtrx.shaperotator.xyz', 123);

    expect(bound?.matrixUserId).toBe('@alice:mtrx.shaperotator.xyz');
    expect(bound?.matrixBoundAt).toBe(123);
    expect((await storage.getUserByMatrixUserId('@alice:mtrx.shaperotator.xyz'))?.handle).toBe('alice');
  });

  it('bindMatrixAccount returns null on Matrix ID conflict', async () => {
    const storage = new MemoryStorage();
    await storage.createUser({ handle: 'alice', secretKeyHash: 'h1', teamId: 't1' });
    await storage.createUser({ handle: 'bob', secretKeyHash: 'h2', teamId: 't1' });
    await storage.bindMatrixAccount('alice', '@alice:mtrx.shaperotator.xyz');

    expect(await storage.bindMatrixAccount('bob', '@alice:mtrx.shaperotator.xyz')).toBeNull();
    expect((await storage.getUser('bob'))?.matrixUserId).toBeUndefined();
  });

  it('bindMatrixAccount allows same user to re-bind same Matrix ID', async () => {
    const storage = new MemoryStorage();
    await storage.createUser({ handle: 'alice', secretKeyHash: 'h1', teamId: 't1' });
    await storage.bindMatrixAccount('alice', '@alice:mtrx.shaperotator.xyz', 1);

    const rebound = await storage.bindMatrixAccount('alice', '@alice:mtrx.shaperotator.xyz', 2);

    expect(rebound?.matrixUserId).toBe('@alice:mtrx.shaperotator.xyz');
    expect(rebound?.matrixBoundAt).toBe(2);
  });

  it('stores spark pair rooms by unordered team-scoped pair', async () => {
    const storage = new MemoryStorage();
    const room = await storage.setSparkPairRoom('shape', 'alice', 'bob', '!room:mtrx.test', 123);

    expect(room).toMatchObject({
      teamId: 'shape',
      pairKey: 'alice:bob',
      roomId: '!room:mtrx.test',
      createdAt: 123,
      updatedAt: 123,
    });
    await expect(storage.getSparkPairRoom('shape', 'bob', 'alice')).resolves.toMatchObject({ roomId: '!room:mtrx.test' });
    await expect(storage.getSparkPairRoom('other', 'bob', 'alice')).resolves.toBeNull();
  });
});

describe('MemoryStorage — secret_key rotation + grace', () => {
  let storage: MemoryStorage;
  const SEVEN_DAYS = 7 * 86400 * 1000;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 'T', createdBy: 'a', createdAt: Date.now() });
  });

  it('rotateSecretKey backs up old tag, returns new key, makes new key auth', async () => {
    const { hashSecretKey } = await import('./identity.js');
    await storage.createUser({ handle: 'alice', secretKeyHash: hashSecretKey('OLDKEY'), teamId: 't1' });

    const result = await storage.rotateSecretKey('alice');
    expect(result).not.toBeNull();
    const { newKey, user } = result!;
    expect(newKey).toBeTruthy();
    expect(newKey).not.toBe('OLDKEY');
    expect(user.previousSecretKeyHash).toBe(hashSecretKey('OLDKEY'));
    expect(user.previousSecretKeyExpiresAt).toBeGreaterThan(Date.now() + SEVEN_DAYS - 1000);
    expect(user.previousSecretKeyExpiresAt).toBeLessThan(Date.now() + SEVEN_DAYS + 1000);
    expect(user.secretKeyHash).toBe(hashSecretKey(newKey));
  });

  it('getUserByKeyHash falls back to previousSecretKeyHash within grace', async () => {
    const { hashSecretKey } = await import('./identity.js');
    await storage.createUser({ handle: 'alice', secretKeyHash: hashSecretKey('OLDKEY'), teamId: 't1' });
    await storage.rotateSecretKey('alice');

    const found = await storage.getUserByKeyHash(hashSecretKey('OLDKEY'));
    expect(found?.handle).toBe('alice');
  });

  it('getUserByKeyHash rejects previous tag after grace expires', async () => {
    const { hashSecretKey } = await import('./identity.js');
    await storage.createUser({ handle: 'alice', secretKeyHash: hashSecretKey('OLDKEY'), teamId: 't1' });
    await storage.rotateSecretKey('alice', -1000); // already expired

    expect(await storage.getUserByKeyHash(hashSecretKey('OLDKEY'))).toBeNull();
  });

  it('two consecutive rotations: oldest key invalid, prior key still in grace', async () => {
    const { hashSecretKey } = await import('./identity.js');
    await storage.createUser({ handle: 'alice', secretKeyHash: hashSecretKey('A'), teamId: 't1' });

    const r1 = await storage.rotateSecretKey('alice');
    const keyB = r1!.newKey;
    const r2 = await storage.rotateSecretKey('alice');
    const keyC = r2!.newKey;

    expect(await storage.getUserByKeyHash(hashSecretKey('A'))).toBeNull();
    expect((await storage.getUserByKeyHash(hashSecretKey(keyB)))?.handle).toBe('alice');
    expect((await storage.getUserByKeyHash(hashSecretKey(keyC)))?.handle).toBe('alice');
  });

  it('rotateSecretKey returns null for unknown handle', async () => {
    expect(await storage.rotateSecretKey('nobody')).toBeNull();
  });
});

describe('MemoryStorage — sessions', () => {
  let storage: MemoryStorage;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 'T', createdBy: 'a', createdAt: 0 });
    await storage.createUser({ handle: 'alice', secretKeyHash: 'h', teamId: 't1' });
  });

  it('createSession returns token + expiresAt; getSession returns the session', async () => {
    const { token, expiresAt } = await storage.createSession('alice', 60_000, 'curl/test');
    expect(token).toMatch(/^rs_/);
    expect(expiresAt).toBeGreaterThan(Date.now());
    const s = await storage.getSession(token);
    expect(s).toMatchObject({ token, handle: 'alice', userAgent: 'curl/test' });
  });

  it('createSession defaults to 30-day TTL when ttlMs not provided', async () => {
    const { expiresAt } = await storage.createSession('alice');
    const thirtyDays = 30 * 86400 * 1000;
    expect(expiresAt).toBeGreaterThan(Date.now() + thirtyDays - 1000);
    expect(expiresAt).toBeLessThan(Date.now() + thirtyDays + 1000);
  });

  it('getSession returns null for unknown token', async () => {
    expect(await storage.getSession('rs_nothing')).toBeNull();
  });

  it('getSession returns null and lazy-deletes expired session', async () => {
    const { token } = await storage.createSession('alice', -1000); // already expired
    expect(await storage.getSession(token)).toBeNull();
    // Subsequent lookups still null (and confirms internal map was cleaned)
    expect(await storage.getSession(token)).toBeNull();
  });

  it('touchSession refreshes expires_at (sliding expiry)', async () => {
    const { token, expiresAt: initial } = await storage.createSession('alice', 1000);
    await new Promise(r => setTimeout(r, 5));
    await storage.touchSession(token, 60_000);
    const s = await storage.getSession(token);
    expect(s).not.toBeNull();
    expect(s!.expiresAt).toBeGreaterThan(initial);
  });

  it('deleteSession revokes', async () => {
    const { token } = await storage.createSession('alice');
    await storage.deleteSession(token);
    expect(await storage.getSession(token)).toBeNull();
  });

  it('multiple sessions per handle (multi-device)', async () => {
    const a = await storage.createSession('alice', 60_000, 'browser-A');
    const b = await storage.createSession('alice', 60_000, 'browser-B');
    expect(a.token).not.toBe(b.token);
    expect((await storage.getSession(a.token))?.userAgent).toBe('browser-A');
    expect((await storage.getSession(b.token))?.userAgent).toBe('browser-B');
  });
});

describe('Team Memory', () => {
  let storage: MemoryStorage;
  beforeEach(() => { storage = new MemoryStorage(); });

  it('returns null when no memory has been saved for the team', async () => {
    expect(await storage.getTeamMemory('t1')).toBeNull();
  });

  it('first upsert: previousContent is null, fields populated', async () => {
    const m = await storage.upsertTeamMemory('t1', 'hello world', 'hx');
    expect(m.teamId).toBe('t1');
    expect(m.content).toBe('hello world');
    expect(m.previousContent).toBeNull();
    expect(m.updatedByHandle).toBe('hx');
    expect(m.updatedAt).toBeGreaterThan(0);
  });

  it('second upsert: previousContent captures the prior content', async () => {
    await storage.upsertTeamMemory('t1', 'v1', 'hx');
    const m = await storage.upsertTeamMemory('t1', 'v2', 'hx');
    expect(m.content).toBe('v2');
    expect(m.previousContent).toBe('v1');
  });

  it('rollback swaps content and previousContent (so a second rollback re-toggles)', async () => {
    await storage.upsertTeamMemory('t1', 'v1', 'hx');
    await storage.upsertTeamMemory('t1', 'v2', 'hx');
    const r1 = await storage.rollbackTeamMemory('t1', 'andrew');
    expect(r1!.content).toBe('v1');
    expect(r1!.previousContent).toBe('v2');
    expect(r1!.updatedByHandle).toBe('andrew');
    const r2 = await storage.rollbackTeamMemory('t1', 'andrew');
    expect(r2!.content).toBe('v2');
    expect(r2!.previousContent).toBe('v1');
  });

  it('rollback returns null when there is no previous version', async () => {
    await storage.upsertTeamMemory('t1', 'only', 'hx');
    expect(await storage.rollbackTeamMemory('t1', 'hx')).toBeNull();
  });

  it('rollback returns null when team has no memory at all', async () => {
    expect(await storage.rollbackTeamMemory('t1', 'hx')).toBeNull();
  });

  it('memories are isolated per team', async () => {
    await storage.upsertTeamMemory('t1', 'team-1-content', 'hx');
    await storage.upsertTeamMemory('t2', 'team-2-content', 'hx');
    expect((await storage.getTeamMemory('t1'))!.content).toBe('team-1-content');
    expect((await storage.getTeamMemory('t2'))!.content).toBe('team-2-content');
  });
});

// ── Handle reuse leak fix (P1) ────────────────────────────────────────
// Verifies anonymize-on-delete: a deleted user's handle is freed for
// re-registration without leaking entries/comments/notifications/follows.
// See docs/superpowers/specs/2026-05-14-handle-reuse-leak-fix-design.md.
describe('MemoryStorage — anonymize-on-delete', () => {
  let storage: MemoryStorage;

  beforeEach(async () => {
    storage = new MemoryStorage();
    // Three users on team T:
    //   alice — about to be deleted
    //   bob   — third party who comments on alice's stuff + follows alice
    //   carol — third party who alice follows
    await storage.createUser({
      handle: 'alice',
      secretKeyHash: hashSecretKey('alice-key'),
      teamId: 'T',
    });
    await storage.createUser({
      handle: 'bob',
      secretKeyHash: hashSecretKey('bob-key'),
      teamId: 'T',
    });
    await storage.createUser({
      handle: 'carol',
      secretKeyHash: hashSecretKey('carol-key'),
      teamId: 'T',
    });
  });

  it('rewrites entry author + entry.to[] + comment author on delete', async () => {
    // Alice writes an entry with bob in to[]; bob comments on her entry.
    const aliceEntry = await storage.addEntry({
      handle: 'alice',
      teamId: 'T',
      client: 'code',
      content: 'thoughts',
      summary: 'alice summary',
      tags: ['x'],
      timestamp: 100,
      to: ['@bob'],
    });
    await storage.addComment(aliceEntry.id, {
      id: 'c1',
      handle: 'bob',
      content: 'reply',
      timestamp: 101,
    });
    // Bob writes an entry that explicitly addresses alice via to[].
    const bobEntry = await storage.addEntry({
      handle: 'bob',
      teamId: 'T',
      client: 'code',
      content: 'cc alice',
      summary: 'bob to alice',
      tags: ['x'],
      timestamp: 102,
      to: ['@alice', '#some-channel'],
    });

    await storage.deleteUser('alice');

    // Author rewrite
    const after = await storage.getEntry(aliceEntry.id);
    expect(after).not.toBeNull();
    expect(after!.handle).toMatch(/^_deleted_[0-9a-f]{6}$/);
    expect(after!.handle).not.toBe('alice');

    // Comment by bob untouched (he wasn't deleted)
    expect(after!.comments?.[0].handle).toBe('bob');

    // Bob's entry: @alice in to[] rewritten; #some-channel left alone
    const bobAfter = await storage.getEntry(bobEntry.id);
    expect(bobAfter!.to).toEqual([
      expect.stringMatching(/^@_deleted_[0-9a-f]{6}$/),
      '#some-channel',
    ]);
  });

  it('rewrites comment author when the deleted user authored a comment on someone else’s entry', async () => {
    const carolEntry = await storage.addEntry({
      handle: 'carol',
      teamId: 'T',
      client: 'code',
      content: '...',
      summary: 'carol entry',
      tags: ['x'],
      timestamp: 200,
    });
    await storage.addComment(carolEntry.id, {
      id: 'c2',
      handle: 'alice',
      content: 'alice comment on carol',
      timestamp: 201,
    });

    await storage.deleteUser('alice');

    const after = await storage.getEntry(carolEntry.id);
    expect(after!.handle).toBe('carol'); // entry author untouched
    expect(after!.comments?.[0].handle).toMatch(/^_deleted_[0-9a-f]{6}$/);
  });

  it('rewrites notifications recipient + sender', async () => {
    await storage.addNotification({
      id: 'n1',
      recipientHandle: 'alice',
      teamId: 'T',
      type: 'mention',
      fromHandle: 'bob',
      preview: 'bob mentioned alice',
      read: false,
      timestamp: 300,
    });
    await storage.addNotification({
      id: 'n2',
      recipientHandle: 'bob',
      teamId: 'T',
      type: 'reply',
      fromHandle: 'alice',
      preview: 'alice replied to bob',
      read: false,
      timestamp: 301,
    });

    await storage.deleteUser('alice');

    // Alice's notifications no longer reachable under her old handle
    expect(await storage.getNotifications('alice')).toEqual([]);

    // Bob's inbox now shows fromHandle as placeholder
    const bobInbox = await storage.getNotifications('bob');
    expect(bobInbox).toHaveLength(1);
    expect(bobInbox[0].fromHandle).toMatch(/^_deleted_[0-9a-f]{6}$/);
  });

  it('rewrites follow-list entries on other users', async () => {
    await storage.updateUser('bob', {
      following: [{ handle: 'alice', note: 'leadership' }],
    });
    await storage.deleteUser('alice');

    const bob = await storage.getUser('bob');
    expect(bob!.following).toHaveLength(1);
    expect(bob!.following![0].handle).toMatch(/^_deleted_[0-9a-f]{6}$/);
    expect(bob!.following![0].note).toBe('leadership'); // note preserved
  });

  it('drops the user row and frees the handle for re-registration', async () => {
    await storage.deleteUser('alice');
    expect(await storage.getUser('alice')).toBeNull();
    expect(await storage.isHandleAvailable('alice')).toBe(true);

    // New user registers with the freed handle and inherits NOTHING
    await storage.createUser({
      handle: 'alice',
      secretKeyHash: hashSecretKey('new-alice-key'),
      teamId: 'T',
    });
    const aliceEntries = await storage.getEntriesByHandle('T', 'alice', 50);
    expect(aliceEntries).toHaveLength(0);
    const aliceInbox = await storage.getNotifications('alice');
    expect(aliceInbox).toEqual([]);
  });

  it('per-delete random suffix avoids conflating successive deletes of the same handle', async () => {
    // Alice writes an entry, gets deleted → placeholder #1
    const e1 = await storage.addEntry({
      handle: 'alice', teamId: 'T', client: 'code',
      content: 'first', summary: 'first', tags: ['x'], timestamp: 400,
    });
    await storage.deleteUser('alice');
    const placeholder1 = (await storage.getEntry(e1.id))!.handle;

    // New alice registers, writes an entry, gets deleted → placeholder #2
    await storage.createUser({
      handle: 'alice',
      secretKeyHash: hashSecretKey('alice-2-key'),
      teamId: 'T',
    });
    const e2 = await storage.addEntry({
      handle: 'alice', teamId: 'T', client: 'code',
      content: 'second', summary: 'second', tags: ['x'], timestamp: 402,
    });
    await storage.deleteUser('alice');
    const placeholder2 = (await storage.getEntry(e2.id))!.handle;

    // Two different deleted-alices have distinct placeholders so their
    // entries don't conflate in any "(deleted user)" cluster view.
    expect(placeholder1).toMatch(/^_deleted_[0-9a-f]{6}$/);
    expect(placeholder2).toMatch(/^_deleted_[0-9a-f]{6}$/);
    expect(placeholder1).not.toBe(placeholder2);
  });
});
