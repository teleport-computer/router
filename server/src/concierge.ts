/**
 * Concierge — per-user "since you were gone" recap.
 *
 * Pure function: pulls 5 groups of entries from storage and returns a
 * structured object. No LLM, no side effects. Caller (HTTP route, MCP
 * handler, weekly cron) decides what to do with the result.
 *
 * 5 groups by descending priority:
 *   - mentioned           — entries / comments that @ this handle
 *   - replied             — comments on this user's own entries
 *   - subscribed_channels — new entries in channels the user subscribes to
 *   - milestones          — team entries tagged with a milestone tag
 *   - related_topics      — new entries on tags the user used recently
 *
 * Each group capped to `perGroupLimit` (default 5). De-duped across groups
 * by entry id so a single entry doesn't show twice.
 */

import type { Storage, RouterEntry } from './storage.js';

export interface RecapItem {
  id: string;
  handle: string;          // author
  summary: string;         // truncated to ~160 chars
  channel: string | null;
  tags: string[];
  timestamp: number;
  url: string;
}

export interface ConciergeRecap {
  since: number;
  now: number;
  totalItems: number;
  groups: {
    mentioned: RecapItem[];
    replied: RecapItem[];
    subscribed_channels: RecapItem[];
    milestones: RecapItem[];
    related_topics: RecapItem[];
  };
}

export const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const DEFAULT_PER_GROUP = 5;
export const MILESTONE_TAGS = new Set(['decision', 'shipped', 'incident', 'milestone', 'release']);
export const RELATED_TOPIC_LOOKBACK_DAYS = 30;
export const SUMMARY_TRUNCATE = 160;

export interface ComputeRecapOptions {
  /** ms epoch; defaults to user.lastConciergeSeenAt or now - 7 days. */
  since?: number;
  /** Cap per group. Default 5. */
  perGroupLimit?: number;
  /** Override clock for tests. */
  now?: number;
  /** Public URL base for building entry links. */
  publicUrl?: string;
}

function toItem(e: RouterEntry, publicUrl: string): RecapItem {
  const summary = (e.summary ?? e.content ?? '').slice(0, SUMMARY_TRUNCATE);
  const base = publicUrl.replace(/\/$/, '');
  return {
    id: e.id,
    handle: e.handle,
    summary,
    channel: e.channel ?? null,
    tags: e.tags ?? [],
    timestamp: e.timestamp,
    url: `${base}/entry?id=${e.id}`,
  };
}

/**
 * Returns the user's top tags (by usage count) over the last N days.
 * Used to compute the related_topics group.
 */
async function topUserTags(
  storage: Storage,
  teamId: string,
  handle: string,
  windowMs: number,
  now: number,
  limit: number,
): Promise<string[]> {
  const since = now - windowMs;
  const recent = await storage.getEntriesByHandle(teamId, handle, 200, since);
  const counts = new Map<string, number>();
  for (const e of recent) {
    for (const t of e.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}

export async function computeUserRecap(
  storage: Storage,
  user: { handle: string; teamId: string; lastConciergeSeenAt?: number },
  opts: ComputeRecapOptions = {},
): Promise<ConciergeRecap> {
  const now = opts.now ?? Date.now();
  const since = opts.since ?? user.lastConciergeSeenAt ?? (now - DEFAULT_LOOKBACK_MS);
  const limit = opts.perGroupLimit ?? DEFAULT_PER_GROUP;
  const publicUrl = opts.publicUrl ?? '';
  const seenIds = new Set<string>();
  const handleLower = user.handle.toLowerCase();
  const mentionToken = `@${handleLower}`;

  // Pull all recent team entries once — used by mentioned + milestones.
  // searchEntries('@hx') doesn't work because tokenize drops short handles
  // (length ≤ 2) and strips the leading '@'.
  const recent = await storage.getEntriesSince(user.teamId, since, 200);

  // 1. mentioned — scan recent for @handle in summary/content/to[]
  const mentioned: RecapItem[] = [];
  for (const e of recent) {
    if (e.handle === user.handle) continue;
    const hay = `${e.summary ?? ''} ${e.content ?? ''}`.toLowerCase();
    const inText = hay.includes(mentionToken);
    const inTo = (e.to ?? []).some(t => t.replace(/^@/, '').toLowerCase() === handleLower);
    if (!inText && !inTo) continue;
    mentioned.push(toItem(e, publicUrl));
    seenIds.add(e.id);
    if (mentioned.length >= limit) break;
  }

  // 2. replied — comments on entries this user authored.
  // We pull recent authored entries and surface any whose comments crossed `since`.
  const replied: RecapItem[] = [];
  const myEntries = await storage.getEntriesByHandle(user.teamId, user.handle, 50, since - DEFAULT_LOOKBACK_MS);
  for (const e of myEntries) {
    if (seenIds.has(e.id)) continue;
    const fresh = (e.comments ?? []).filter(c => c.timestamp > since && c.handle !== user.handle);
    if (fresh.length === 0) continue;
    replied.push({
      ...toItem(e, publicUrl),
      summary: `${fresh.length} new ${fresh.length === 1 ? 'comment' : 'comments'}: ${fresh[0].content.slice(0, SUMMARY_TRUNCATE - 40)}`,
    });
    seenIds.add(e.id);
    if (replied.length >= limit) break;
  }

  // 3. subscribed_channels — new entries in channels user is subscribed to
  const subscribed_channels: RecapItem[] = [];
  const subs = await storage.getSubscribedChannels(user.handle);
  for (const ch of subs) {
    if (subscribed_channels.length >= limit) break;
    const chEntries = await storage.getChannelEntries(user.teamId, ch.id, 10);
    for (const e of chEntries) {
      if (seenIds.has(e.id)) continue;
      if (e.timestamp <= since) continue;
      if (e.handle === user.handle) continue;
      subscribed_channels.push(toItem(e, publicUrl));
      seenIds.add(e.id);
      if (subscribed_channels.length >= limit) break;
    }
  }

  // 4. milestones — team-wide entries tagged with milestone tags
  const milestones: RecapItem[] = [];
  for (const e of recent) {
    if (seenIds.has(e.id)) continue;
    const tags = e.tags ?? [];
    if (!tags.some(t => MILESTONE_TAGS.has(t.toLowerCase()))) continue;
    if (e.handle === user.handle) continue;
    milestones.push(toItem(e, publicUrl));
    seenIds.add(e.id);
    if (milestones.length >= limit) break;
  }

  // 5. related_topics — entries on user's top tags by OTHERS
  const related_topics: RecapItem[] = [];
  const topTags = await topUserTags(
    storage, user.teamId, user.handle,
    RELATED_TOPIC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000, now, 5,
  );
  if (topTags.length > 0) {
    const taggedRecent = await storage.getEntriesByTags(user.teamId, topTags, 50);
    for (const e of taggedRecent) {
      if (seenIds.has(e.id)) continue;
      if (e.timestamp <= since) continue;
      if (e.handle === user.handle) continue;
      related_topics.push(toItem(e, publicUrl));
      seenIds.add(e.id);
      if (related_topics.length >= limit) break;
    }
  }

  return {
    since,
    now,
    totalItems: mentioned.length + replied.length + subscribed_channels.length + milestones.length + related_topics.length,
    groups: { mentioned, replied, subscribed_channels, milestones, related_topics },
  };
}

/**
 * Compact human-readable rendering used by CLI / MCP / HTTP `router brief`.
 *
 * Daily-brief semantics (since 2026-05-12 LLM redesign): mentions and replies
 * fire via realtime notification-bridge as soon as they happen, so showing them
 * here would duplicate. We surface a count footer instead, and let the daily
 * sections (channels / milestones / related) own the "stuff you didn't get
 * pinged about" mental model.
 */
export function renderRecap(recap: ConciergeRecap): string {
  const dailyGroups: { key: keyof ConciergeRecap['groups']; label: string }[] = [
    { key: 'subscribed_channels', label: 'Subscribed channels' },
    { key: 'milestones', label: 'Team milestones' },
    { key: 'related_topics', label: 'Related to your topics' },
  ];
  const dailyItems = dailyGroups.reduce((sum, g) => sum + recap.groups[g.key].length, 0);
  const realtimeMentions = recap.groups.mentioned.length;
  const realtimeReplies = recap.groups.replied.length;

  if (dailyItems === 0 && realtimeMentions === 0 && realtimeReplies === 0) {
    return 'No new activity since your last brief.';
  }

  const lines: string[] = [];
  const sinceLabel = new Date(recap.since).toLocaleString();
  lines.push(`Activity since ${sinceLabel} (${dailyItems} daily-brief items):`);
  lines.push('');

  for (const g of dailyGroups) {
    const items = recap.groups[g.key];
    if (items.length === 0) continue;
    lines.push(`${g.label} (${items.length}):`);
    for (const it of items) {
      const channel = it.channel ? ` #${it.channel}` : '';
      lines.push(`  - [@${it.handle}${channel}] ${it.summary}`);
      lines.push(`    ${it.url}`);
    }
    lines.push('');
  }

  if (realtimeMentions > 0 || realtimeReplies > 0) {
    const parts: string[] = [];
    if (realtimeMentions > 0) parts.push(`${realtimeMentions} mention${realtimeMentions === 1 ? '' : 's'}`);
    if (realtimeReplies > 0) parts.push(`${realtimeReplies} repl${realtimeReplies === 1 ? 'y' : 'ies'}`);
    lines.push(`(Plus ${parts.join(' + ')} pushed in realtime — already in your inbox.)`);
  }

  return lines.join('\n').trimEnd();
}
