import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../storage.js';
import { listTeamTags, resolveTeamTag } from './tag-resolve.js';

async function seed() {
  const storage = new MemoryStorage();
  await storage.createTeam({ id: 't1', name: 'T1', createdBy: 'u', createdAt: 0 } as any);
  // Two explicit tag_configs (formerly "channels").
  await storage.upsertTagConfig('t1', 'router', { name: 'Router', createdBy: 'u', skills: [], subscribers: [] });
  await storage.upsertTagConfig('t1', 'design', { name: 'Design', createdBy: 'u', skills: [], subscribers: [] });
  // An entry-only tag — never registered as a tag_config.
  await storage.createUser({ key: 'k', teamId: 't1', handle: 'me', pseudonym: 'me', createdAt: 0 } as any);
  await storage.addEntry({
    handle: 'me', teamId: 't1', client: 'cli',
    content: 'note', summary: 'note',
    tags: ['wip'],
    timestamp: 0,
  } as any);
  return storage;
}

describe('listTeamTags', () => {
  it('returns merged set of tag_configs + entry-discovered tags, deduped + sorted', async () => {
    const storage = await seed();
    const tags = await listTeamTags(storage, 't1');
    expect(tags.map(t => t.id)).toEqual(['design', 'router', 'wip']);
    // Configs keep their custom display name; entry-only tag falls back to the slug.
    expect(tags.find(t => t.id === 'router')?.name).toBe('Router');
    expect(tags.find(t => t.id === 'wip')?.name).toBe('wip');
  });

  it('does NOT leak tags from another team', async () => {
    const storage = await seed();
    await storage.createTeam({ id: 't2', name: 'T2', createdBy: 'u', createdAt: 0 } as any);
    await storage.upsertTagConfig('t2', 'foreign', { name: 'foreign', createdBy: 'u', skills: [], subscribers: [] });
    const tags = await listTeamTags(storage, 't1');
    expect(tags.find(t => t.id === 'foreign')).toBeUndefined();
  });
});

describe('resolveTeamTag', () => {
  it('returns existing tag_config without modifying anything', async () => {
    const storage = await seed();
    const before = await storage.getTagConfig('t1', 'router');
    const resolved = await resolveTeamTag(storage, 't1', 'me', 'router');
    expect(resolved).toEqual({ id: 'router', teamId: 't1', name: 'Router' });
    // Created-at and other fields unchanged
    const after = await storage.getTagConfig('t1', 'router');
    expect(after?.createdAt).toBe(before?.createdAt);
  });

  it('auto-upserts a tag_config when the tag is only seen in entries', async () => {
    const storage = await seed();
    expect(await storage.getTagConfig('t1', 'wip')).toBeNull();
    const resolved = await resolveTeamTag(storage, 't1', 'me', 'wip');
    expect(resolved).toEqual({ id: 'wip', teamId: 't1', name: 'wip' });
    const created = await storage.getTagConfig('t1', 'wip');
    expect(created).not.toBeNull();
    expect(created?.createdBy).toBe('me');
    expect(created?.skills).toEqual([]);
    expect(created?.subscribers).toEqual([]);
  });

  it('returns null for a tag that does not exist anywhere in the team', async () => {
    const storage = await seed();
    expect(await resolveTeamTag(storage, 't1', 'me', 'nope')).toBeNull();
  });

  it('returns null for a tag that exists only in a different team', async () => {
    const storage = await seed();
    await storage.createTeam({ id: 't2', name: 'T2', createdBy: 'u', createdAt: 0 } as any);
    await storage.upsertTagConfig('t2', 'foreign', { name: 'foreign', createdBy: 'u', skills: [], subscribers: [] });
    expect(await resolveTeamTag(storage, 't1', 'me', 'foreign')).toBeNull();
    // And no row was created in t1
    expect(await storage.getTagConfig('t1', 'foreign')).toBeNull();
  });
});
