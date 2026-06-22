import { describe, it, expect } from 'vitest';
import {
  isTimelineEntry,
  isValidTimelineDays,
  filterTimelineEntries,
  TIMELINE_NODE_TAGS,
} from './timeline-tags.js';
import type { RouterEntry } from './storage.js';

describe('isTimelineEntry', () => {
  it('returns true when entry has a node tag', () => {
    expect(isTimelineEntry({ tags: ['decision'] })).toBe(true);
    expect(isTimelineEntry({ tags: ['milestone', 'frontend'] })).toBe(true);
    expect(isTimelineEntry({ tags: ['frontend', 'shipped'] })).toBe(true);
  });

  it('returns false when no tag is a node tag', () => {
    expect(isTimelineEntry({ tags: ['frontend', 'backend'] })).toBe(false);
    expect(isTimelineEntry({ tags: ['idea'] })).toBe(false);
  });

  it('returns false for empty / missing tags', () => {
    expect(isTimelineEntry({ tags: [] })).toBe(false);
    expect(isTimelineEntry({ tags: undefined as unknown as string[] })).toBe(false);
  });

  it('covers every node tag in the constant', () => {
    for (const tag of TIMELINE_NODE_TAGS) {
      expect(isTimelineEntry({ tags: [tag] })).toBe(true);
    }
  });
});

describe('isValidTimelineDays', () => {
  it('accepts 7, 30, 90', () => {
    expect(isValidTimelineDays(7)).toBe(true);
    expect(isValidTimelineDays(30)).toBe(true);
    expect(isValidTimelineDays(90)).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isValidTimelineDays(1)).toBe(false);
    expect(isValidTimelineDays(31)).toBe(false);
    expect(isValidTimelineDays('30')).toBe(false);
    expect(isValidTimelineDays(null)).toBe(false);
    expect(isValidTimelineDays(undefined)).toBe(false);
  });
});

function entry(partial: Partial<RouterEntry> & { timestamp: number; tags: string[] }): RouterEntry {
  return {
    id: 'id-' + partial.timestamp,
    handle: 'alice',
    teamId: 'team-a',
    client: 'code',
    content: 'c',
    summary: 's',
    role: 'frontend',
    ...partial,
  } as RouterEntry;
}

describe('filterTimelineEntries', () => {
  const now = 1_700_000_000_000;
  const day = 24 * 60 * 60 * 1000;

  it('keeps only entries with node tags', () => {
    const entries = [
      entry({ timestamp: now - day, tags: ['decision'] }),
      entry({ timestamp: now - day, tags: ['frontend'] }),
      entry({ timestamp: now - day, tags: ['shipped', 'backend'] }),
    ];
    const result = filterTimelineEntries(entries, 30, now);
    expect(result.map(e => e.tags)).toEqual([
      ['decision'],
      ['shipped', 'backend'],
    ]);
  });

  it('drops entries older than the days window', () => {
    const entries = [
      entry({ timestamp: now - 5 * day, tags: ['decision'] }),
      entry({ timestamp: now - 40 * day, tags: ['decision'] }),
    ];
    const result = filterTimelineEntries(entries, 30, now);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(now - 5 * day);
  });

  it('includes entries exactly at the days boundary', () => {
    const entries = [
      entry({ timestamp: now - 30 * day, tags: ['decision'] }),
    ];
    const result = filterTimelineEntries(entries, 30, now);
    expect(result).toHaveLength(1);
  });

  it('sorts by timestamp DESC', () => {
    const entries = [
      entry({ timestamp: now - 5 * day, tags: ['decision'] }),
      entry({ timestamp: now - 1 * day, tags: ['shipped'] }),
      entry({ timestamp: now - 10 * day, tags: ['retro'] }),
    ];
    const result = filterTimelineEntries(entries, 30, now);
    expect(result.map(e => e.timestamp)).toEqual([
      now - 1 * day,
      now - 5 * day,
      now - 10 * day,
    ]);
  });

  it('respects days=7 narrower window', () => {
    const entries = [
      entry({ timestamp: now - 5 * day, tags: ['decision'] }),
      entry({ timestamp: now - 10 * day, tags: ['decision'] }),
    ];
    expect(filterTimelineEntries(entries, 7, now)).toHaveLength(1);
  });
});
