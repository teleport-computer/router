import type { RouterEntry } from './storage.js';

/**
 * Tags that promote an entry into the channel Timeline view.
 * Keep this list small — adding tags here makes Timeline noisier.
 */
export const TIMELINE_NODE_TAGS = [
  'decision',
  'milestone',
  'shipped',
  'release',
  'incident',
  'retro',
] as const;

const NODE_TAG_SET: ReadonlySet<string> = new Set(TIMELINE_NODE_TAGS);

export function isTimelineEntry(entry: Pick<RouterEntry, 'tags'>): boolean {
  if (!entry.tags || entry.tags.length === 0) return false;
  return entry.tags.some(t => NODE_TAG_SET.has(t));
}

export type TimelineDays = 7 | 30 | 90;

export const TIMELINE_DAYS_OPTIONS = [7, 30, 90] as const;

export function isValidTimelineDays(value: unknown): value is TimelineDays {
  return value === 7 || value === 30 || value === 90;
}

/**
 * Filter a list of entries down to "timeline entries":
 *  - have at least one node tag
 *  - timestamp falls within the last `days` days relative to `now`
 * Result is sorted by timestamp DESC.
 */
export function filterTimelineEntries(
  entries: RouterEntry[],
  days: TimelineDays,
  now: number = Date.now(),
): RouterEntry[] {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return entries
    .filter(e => e.timestamp >= cutoff && isTimelineEntry(e))
    .sort((a, b) => b.timestamp - a.timestamp);
}
