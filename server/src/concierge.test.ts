import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorage } from './storage.js';
import { computeUserRecap, renderRecap, MILESTONE_TAGS } from './concierge.js';

async function bootstrap(): Promise<MemoryStorage> {
  const storage = new MemoryStorage();
  await storage.createTeam({ id: 't1', name: 'T1', createdBy: 'hx', createdAt: 0 } as any);
  await storage.createUser({ handle: 'hx', secretKeyHash: 'h', teamId: 't1' } as any);
  await storage.createUser({ handle: 'andrew', secretKeyHash: 'h2', teamId: 't1' } as any);
  await storage.createUser({ handle: 'samantha', secretKeyHash: 'h3', teamId: 't1' } as any);
  await storage.createChannel({
    id: 'frontend', teamId: 't1', name: 'Frontend',
    joinRule: 'open', createdBy: 'hx', createdAt: 0,
    skills: [], subscribers: [{ handle: 'hx', role: 'member', joinedAt: 0 }],
  });
  return storage;
}

describe('computeUserRecap', () => {
  let storage: MemoryStorage;
  const NOW = 1_000_000_000_000;
  const HOUR = 60 * 60 * 1000;
  const SINCE = NOW - 24 * HOUR;

  beforeEach(async () => {
    storage = await bootstrap();
  });

  it('returns empty groups when no activity since', async () => {
    const recap = await computeUserRecap(storage, { handle: 'hx', teamId: 't1' }, { since: SINCE, now: NOW });
    expect(recap.totalItems).toBe(0);
    expect(recap.groups.mentioned).toEqual([]);
    expect(recap.groups.replied).toEqual([]);
    expect(recap.groups.milestones).toEqual([]);
    expect(recap.since).toBe(SINCE);
  });

  it('group: mentioned — picks up @handle in summary/content', async () => {
    await storage.addEntry({
      handle: 'andrew', teamId: 't1', client: 'code',
      content: 'hey @hx please review', summary: '@hx review request',
      tags: [], timestamp: NOW - HOUR,
    } as any);
    await storage.addEntry({
      handle: 'samantha', teamId: 't1', client: 'code',
      content: 'something else entirely', summary: 'unrelated',
      tags: [], timestamp: NOW - HOUR,
    } as any);
    const recap = await computeUserRecap(storage, { handle: 'hx', teamId: 't1' }, { since: SINCE, now: NOW });
    expect(recap.groups.mentioned.length).toBe(1);
    expect(recap.groups.mentioned[0].handle).toBe('andrew');
  });

  it('group: mentioned — also catches entries.to[]', async () => {
    await storage.addEntry({
      handle: 'andrew', teamId: 't1', client: 'code',
      content: 'fyi', summary: 'note',
      tags: [], timestamp: NOW - HOUR,
      to: ['@hx'],
    } as any);
    const recap = await computeUserRecap(storage, { handle: 'hx', teamId: 't1' }, { since: SINCE, now: NOW });
    expect(recap.groups.mentioned.length).toBe(1);
  });

  it('group: mentioned — excludes self-authored', async () => {
    await storage.addEntry({
      handle: 'hx', teamId: 't1', client: 'code',
      content: '@hx I should remember', summary: '@hx self note',
      tags: [], timestamp: NOW - HOUR,
    } as any);
    const recap = await computeUserRecap(storage, { handle: 'hx', teamId: 't1' }, { since: SINCE, now: NOW });
    expect(recap.groups.mentioned).toEqual([]);
  });

  it('group: subscribed_channels — picks up new entries in subscribed channels', async () => {
    await storage.addEntry({
      handle: 'andrew', teamId: 't1', client: 'code',
      content: 'frontend update', summary: 'shipped new feature',
      tags: [], timestamp: NOW - HOUR,
      channel: 'frontend',
    } as any);
    const recap = await computeUserRecap(storage, { handle: 'hx', teamId: 't1' }, { since: SINCE, now: NOW });
    expect(recap.groups.subscribed_channels.length).toBe(1);
    expect(recap.groups.subscribed_channels[0].channel).toBe('frontend');
  });

  it('group: subscribed_channels — excludes self-authored even if in subscribed channel', async () => {
    await storage.addEntry({
      handle: 'hx', teamId: 't1', client: 'code',
      content: 'my own work', summary: 'self note',
      tags: [], timestamp: NOW - HOUR,
      channel: 'frontend',
    } as any);
    const recap = await computeUserRecap(storage, { handle: 'hx', teamId: 't1' }, { since: SINCE, now: NOW });
    expect(recap.groups.subscribed_channels).toEqual([]);
  });

  it('group: milestones — picks up milestone-tagged team entries', async () => {
    await storage.addEntry({
      handle: 'andrew', teamId: 't1', client: 'code',
      content: 'we decided X', summary: 'decision: use Zustand',
      tags: ['decision', 'frontend'], timestamp: NOW - HOUR,
    } as any);
    await storage.addEntry({
      handle: 'andrew', teamId: 't1', client: 'code',
      content: 'shipping', summary: 'release v1',
      tags: ['shipped'], timestamp: NOW - HOUR,
    } as any);
    await storage.addEntry({
      handle: 'samantha', teamId: 't1', client: 'code',
      content: 'just a regular note', summary: 'no milestone',
      tags: ['note'], timestamp: NOW - HOUR,
    } as any);
    const recap = await computeUserRecap(storage, { handle: 'hx', teamId: 't1' }, { since: SINCE, now: NOW });
    expect(recap.groups.milestones.length).toBe(2);
    expect(recap.groups.milestones.every(i => i.tags.some(t => MILESTONE_TAGS.has(t)))).toBe(true);
  });

  it('per-group limit caps each group to perGroupLimit', async () => {
    for (let i = 0; i < 10; i++) {
      await storage.addEntry({
        handle: 'andrew', teamId: 't1', client: 'code',
        content: `decision number ${i}`, summary: `Decision ${i}`,
        tags: ['decision'], timestamp: NOW - HOUR + i,
      } as any);
    }
    const recap = await computeUserRecap(
      storage, { handle: 'hx', teamId: 't1' },
      { since: SINCE, now: NOW, perGroupLimit: 3 },
    );
    expect(recap.groups.milestones.length).toBe(3);
  });

  it('dedups entries appearing in multiple groups (mentioned > milestones)', async () => {
    // Entry mentions @hx AND is tagged 'decision' → should appear in mentioned only.
    await storage.addEntry({
      handle: 'andrew', teamId: 't1', client: 'code',
      content: 'we decided @hx will lead it', summary: '@hx leads new initiative',
      tags: ['decision'], timestamp: NOW - HOUR,
    } as any);
    const recap = await computeUserRecap(storage, { handle: 'hx', teamId: 't1' }, { since: SINCE, now: NOW });
    expect(recap.groups.mentioned.length).toBe(1);
    expect(recap.groups.milestones.length).toBe(0);
    expect(recap.totalItems).toBe(1);
  });

  it('uses lastConciergeSeenAt when no explicit since provided', async () => {
    const user = { handle: 'hx', teamId: 't1', lastConciergeSeenAt: NOW - 2 * HOUR };
    await storage.addEntry({
      handle: 'andrew', teamId: 't1', client: 'code',
      content: '@hx new', summary: '@hx new',
      tags: [], timestamp: NOW - HOUR, // after lastSeen
    } as any);
    await storage.addEntry({
      handle: 'andrew', teamId: 't1', client: 'code',
      content: '@hx old', summary: '@hx old',
      tags: [], timestamp: NOW - 5 * HOUR, // before lastSeen
    } as any);
    const recap = await computeUserRecap(storage, user, { now: NOW });
    expect(recap.since).toBe(NOW - 2 * HOUR);
    expect(recap.groups.mentioned.length).toBe(1);
    expect(recap.groups.mentioned[0].summary).toContain('new');
  });

  it('defaults to 7-day lookback for first-time user (no lastConciergeSeenAt)', async () => {
    const recap = await computeUserRecap(storage, { handle: 'hx', teamId: 't1' }, { now: NOW });
    const sevenDays = 7 * 24 * HOUR;
    expect(recap.since).toBe(NOW - sevenDays);
  });
});

describe('renderRecap', () => {
  const baseRecap = {
    since: 1_000_000_000_000,
    now: 1_000_086_400_000,
    totalItems: 0,
    groups: { mentioned: [], replied: [], subscribed_channels: [], milestones: [], related_topics: [] },
  };

  it('returns friendly "no activity" line when empty', () => {
    expect(renderRecap(baseRecap)).toBe('No new activity since your last brief.');
  });

  it('renders daily-brief groups with counts + items, and shows realtime mentions/replies as a footer count only', () => {
    const recap = {
      ...baseRecap,
      totalItems: 2,
      groups: {
        ...baseRecap.groups,
        mentioned: [{
          id: 'mnk1', handle: 'andrew', summary: 'review request',
          channel: null, tags: [], timestamp: 0,
          url: 'https://r.test/entry?id=mnk1',
        }],
        milestones: [{
          id: 'mnk2', handle: 'samantha', summary: 'shipped v1',
          channel: 'frontend', tags: ['shipped'], timestamp: 0,
          url: 'https://r.test/entry?id=mnk2',
        }],
      },
    };
    const out = renderRecap(recap);
    // Milestones (daily group) shown as full list
    expect(out).toContain('Team milestones (1)');
    expect(out).toContain('[@samantha #frontend]');
    expect(out).toContain('https://r.test/entry?id=mnk2');
    // Mentions shown as footer count, NOT as full list (they were realtime-pushed)
    expect(out).toContain('1 mention pushed in realtime');
    expect(out).not.toContain('@ you (1)');           // no full mention section
    expect(out).not.toContain('https://r.test/entry?id=mnk1');
  });

  it('skips empty daily groups in output but still renders realtime footer when only mention/reply present', () => {
    const recap = {
      ...baseRecap,
      totalItems: 1,
      groups: {
        ...baseRecap.groups,
        mentioned: [{
          id: 'x', handle: 'andrew', summary: 's', channel: null,
          tags: [], timestamp: 0, url: 'u',
        }],
      },
    };
    const out = renderRecap(recap);
    // No daily groups → header line still present (0 daily-brief items)
    expect(out).toContain('0 daily-brief items');
    // No daily group titles
    expect(out).not.toContain('Team milestones');
    expect(out).not.toContain('Subscribed channels');
    // Realtime footer present
    expect(out).toContain('1 mention pushed in realtime');
  });
});
