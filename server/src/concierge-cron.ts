/**
 * Concierge weekly brief cron — fires once per week at Monday 10:00 Asia/Shanghai
 * (= Monday 02:00 UTC since China has no DST). For each opted-in user, computes
 * a 7-day recap, optionally synthesizes LLM team-overview + personal-callout,
 * and pushes a custom Lark IM card.
 *
 * Two scoping rules:
 *   - lastConciergeSeenAt is updated ONLY here (spec §5.4)
 *   - Mentions/replies do NOT count as "weekly-brief content" — they're already
 *     pushed in realtime via notification-bridge. Skip threshold is based
 *     purely on channels / milestones / related groups.
 *
 * Recap window is a fixed 7 days back from now (NOT since lastConciergeSeenAt) —
 * keeps prompt size predictable even if a user is offline for multiple weeks.
 *
 * LLM is optional (callLLM dep). Without it, falls back to a structured
 * channel-list rendering — no LLM = degraded but functional.
 */

import { randomBytes } from 'node:crypto';
import type { Storage, RouterUser, RouterEntry } from './storage.js';
import { computeUserRecap } from './concierge.js';
import { synthesizeTeamOverview, synthesizePersonalCallout, type LLMCaller } from './concierge-llm.js';
import { buildWeeklyBriefCard, type DigestCardItem } from './lark/card-builder.js';
import type { LarkApiClient } from './lark/api-client.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
const USER_RECENT_LOOKBACK_DAYS = 7;
const USER_RECENT_ENTRY_LIMIT = 10;

/**
 * China = UTC+8 with no DST → Monday 10:00 Beijing == Monday 02:00 UTC.
 * Compute ms until the next Monday 02:00 UTC boundary.
 *
 * JS `getUTCDay()`: 0=Sun, 1=Mon, …, 6=Sat.
 */
export function msUntilNextMonday10amBeijing(): number {
  const now = new Date();
  const target = new Date();
  target.setUTCHours(2, 0, 0, 0);
  // Days to advance: 0 if it's Monday before 02:00 UTC, otherwise wrap around.
  const todayDow = target.getUTCDay();
  let daysAhead = (1 - todayDow + 7) % 7; // 0..6, where 0 means "today is Monday"
  if (daysAhead === 0 && target.getTime() <= now.getTime()) {
    daysAhead = 7; // already past Monday 02:00 UTC → next Monday
  }
  target.setUTCDate(target.getUTCDate() + daysAhead);
  return target.getTime() - now.getTime();
}

export interface RunConciergeForUserDeps {
  storage: Pick<Storage, 'getEntriesSince' | 'getEntriesByHandle' | 'getEntriesByTags' | 'getSubscribedChannels' | 'getChannelEntries' | 'updateUser' | 'addNotification'>;
  apiClient: LarkApiClient;
  user: RouterUser;
  publicUrl: string;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  /** Optional LLM caller — when provided, generates personalized callout for this user. */
  callLLM?: LLMCaller;
  /** Pre-computed team-wide LLM team-overview (shared across all users in the team). */
  teamOverviewMd?: string | null;
  /** Pre-computed team-wide entries from the last 7 days (used as input for personal callout LLM). */
  teamEntriesWeek?: RouterEntry[];
  /**
   * When true: compute the recap + return what the outcome WOULD be, but skip
   * all I/O side effects (no LLM personal callout, no inbox notification, no
   * Lark push, no lastConciergeSeenAt update). Used by the admin run-now
   * endpoint with `?dryRun=1` so admins can verify the cron's targeting
   * without triggering double-pushes.
   */
  dryRun?: boolean;
}

export type ConciergeRunOutcome = 'opted-out' | 'empty-skip' | 'pushed' | 'error';

function formatWeekLabel(weekStart: Date): string {
  // Format like "Week of May 7" — Monday of the recap window.
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'Asia/Shanghai' };
  return `Week of ${new Intl.DateTimeFormat('en-US', opts).format(weekStart)}`;
}

function recapItemsToCard(items: Array<{ summary: string; url: string }>): DigestCardItem[] {
  return items.map(it => ({ summary: it.summary, url: it.url }));
}

export async function runConciergeForUser(deps: RunConciergeForUserDeps): Promise<ConciergeRunOutcome> {
  const log = deps.log ?? ((lvl, m) => console[lvl === 'info' ? 'log' : lvl](`[concierge-cron] ${m}`));
  const { user } = deps;

  if (user.conciergeRecapEnabled === false) {
    return 'opted-out';
  }

  let recap;
  try {
    recap = await computeUserRecap(
      deps.storage as Storage,
      { handle: user.handle, teamId: user.teamId, lastConciergeSeenAt: user.lastConciergeSeenAt },
      { publicUrl: deps.publicUrl },
    );
  } catch (e: any) {
    log('warn', `@${user.handle}: recap failed: ${e?.message ?? e}`);
    return 'error';
  }

  // Daily-brief skip threshold: only count channels + milestones + related.
  // Mentions/replies are pushed real-time via notification-bridge — counting
  // them here would cause "useless brief" cards (just a footer "you got pinged").
  const weeklyItems =
    recap.groups.subscribed_channels.length +
    recap.groups.milestones.length +
    recap.groups.related_topics.length;
  if (weeklyItems === 0) {
    return 'empty-skip';
  }

  // Dry-run short-circuit: we know the user passed the empty-skip threshold
  // (i.e. would receive a brief). Skip the LLM + dispatch and report 'pushed'
  // as the simulated outcome.
  if (deps.dryRun) {
    return 'pushed';
  }

  // Optionally synthesize a per-user LLM callout from this user's recent work
  // vs. the team's last-7-day entries. Falls back to null on any failure (card
  // simply omits the "For you" section).
  let personalCalloutMd: string | null = null;
  if (deps.callLLM && deps.teamEntriesWeek && deps.teamEntriesWeek.length > 0) {
    try {
      const sinceMs = Date.now() - USER_RECENT_LOOKBACK_DAYS * ONE_DAY_MS;
      const userRecent = await deps.storage.getEntriesByHandle(
        user.teamId,
        user.handle,
        USER_RECENT_ENTRY_LIMIT,
        sinceMs,
      );
      personalCalloutMd = await synthesizePersonalCallout(
        deps.callLLM,
        user.handle,
        userRecent,
        deps.teamEntriesWeek,
      );
    } catch (e: any) {
      log('warn', `@${user.handle}: personal callout failed: ${e?.message ?? e}`);
      // proceed with null — card just skips that section
    }
  }

  try {
    // 1. Write inbox notification (so user has it on web inbox even if Lark fails)
    //    NOTE: storage.addNotification is wrapped at server.ts:501 to auto-call
    //    pushNotificationToLark. Since 'weekly_brief' is intentionally NOT in
    //    PUSHED_TYPES, the wrapper writes to inbox but does NOT push Lark for
    //    brief types — we handle Lark push directly below with the right card.
    await deps.storage.addNotification({
      id: `n-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
      recipientHandle: user.handle,
      teamId: user.teamId,
      type: 'weekly_brief',
      fromHandle: 'router',
      preview: `Weekly brief: ${weeklyItems} items`,
      read: false,
      timestamp: recap.now,
      // entryId / commentId omitted — brief is not entry-bound
    });

    // 2. Push Lark IM card directly (notification-bridge handles mention/comment/reply
    //    cards but the weekly brief needs its own card layout — push here to apiClient)
    if (user.larkOpenId) {
      // Check user prefs (default true for digest pref — same key still gates this)
      const prefDigest = user.larkNotificationPrefs?.digest;
      if (prefDigest === false) {
        // user opted out of Lark brief push specifically
        log('info', `@${user.handle}: brief pref off — skip Lark push, inbox written`);
      } else {
        const weekStart = new Date(Date.now() - SEVEN_DAYS_MS);
        const card = buildWeeklyBriefCard({
          dateLabel: formatWeekLabel(weekStart),
          publicUrl: deps.publicUrl,
          teamOverviewMd: deps.teamOverviewMd ?? null,
          personalCalloutMd,
          milestones: recapItemsToCard(recap.groups.milestones),
          realtimeMentionsCount: recap.groups.mentioned.length,
          realtimeRepliesCount: recap.groups.replied.length,
          // Fallback list used only if teamOverviewMd is null (LLM unavailable / failed)
          fallbackChannelEntries: recapItemsToCard(recap.groups.subscribed_channels),
        });
        // Fire-and-forget — Lark API + token refresh can take 1-3s per user.
        // At <10 users this didn't matter; at 50+ users the serial wait
        // dominates wall-clock cron time (5+ minutes). Inbox write above is
        // still awaited (that's the durable record); Lark push is a delivery
        // mechanism that's safe to background. Errors are logged.
        deps.apiClient.post(
          '/open-apis/im/v1/messages?receive_id_type=open_id',
          {
            receive_id: user.larkOpenId,
            msg_type: 'interactive',
            content: JSON.stringify(card),
          },
        ).catch((e: any) => {
          log('warn', `@${user.handle}: Lark push failed (inbox notification still wrote): ${e?.message ?? e}`);
        });
      }
    }

    // 3. Update lastSeen — ONLY here in cron path (spec §5.4)
    await deps.storage.updateUser(user.handle, { lastConciergeSeenAt: recap.now });

    return 'pushed';
  } catch (e: any) {
    log('warn', `@${user.handle}: dispatch failed: ${e?.message ?? e}`);
    return 'error';
  }
}

export interface RunConciergeForAllUsersDeps {
  storage: Pick<Storage, 'getAllUsers' | 'getEntriesSince' | 'getEntriesByHandle' | 'getEntriesByTags' | 'getSubscribedChannels' | 'getChannelEntries' | 'updateUser' | 'addNotification'>;
  apiClient: LarkApiClient;
  publicUrl: string;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  /** Optional LLM caller — when provided, generates team overview (1 call/team) + per-user callout (1 call/user). */
  callLLM?: LLMCaller;
  /** Dry-run: compute targeting + return stats only (no LLM, no inbox, no Lark, no lastSeen update). See RunConciergeForUserDeps.dryRun. */
  dryRun?: boolean;
}

export interface ConciergeRunStats {
  total: number;
  pushed: number;
  emptySkip: number;
  optedOut: number;
  errors: number;
}

export async function runConciergeForAllUsers(deps: RunConciergeForAllUsersDeps): Promise<ConciergeRunStats> {
  const log = deps.log ?? ((lvl, m) => console[lvl === 'info' ? 'log' : lvl](`[concierge-cron] ${m}`));
  const stats: ConciergeRunStats = { total: 0, pushed: 0, emptySkip: 0, optedOut: 0, errors: 0 };

  const users = await deps.storage.getAllUsers();
  stats.total = users.length;
  log('info', `start: ${users.length} users to process`);

  // Group users by teamId so we can compute team-level data (entries-today,
  // LLM team overview) ONCE per team rather than once per user.
  const byTeam = new Map<string, RouterUser[]>();
  for (const u of users) {
    const list = byTeam.get(u.teamId) ?? [];
    list.push(u);
    byTeam.set(u.teamId, list);
  }

  for (const [teamId, teamUsers] of byTeam.entries()) {
    // ── Team-level data (computed once per team) ─────────────────
    let teamEntriesWeek: RouterEntry[] = [];
    let teamOverviewMd: string | null = null;
    try {
      teamEntriesWeek = await deps.storage.getEntriesSince(teamId, Date.now() - SEVEN_DAYS_MS);
    } catch (e: any) {
      log('warn', `team ${teamId}: getEntriesSince failed: ${e?.message ?? e}`);
      // Proceed with empty array — runConciergeForUser will skip personal callout
      // and the card will fall back to per-user channel list.
    }

    // Skip the team-overview LLM in dry-run (saves the cost while previewing)
    if (deps.callLLM && teamEntriesWeek.length > 0 && !deps.dryRun) {
      try {
        teamOverviewMd = await synthesizeTeamOverview(deps.callLLM, teamEntriesWeek);
      } catch (e: any) {
        log('warn', `team ${teamId}: team-overview LLM failed: ${e?.message ?? e}`);
        // teamOverviewMd stays null → buildWeeklyBriefCard falls back to per-user channel list
      }
    }

    log('info', `team ${teamId}: ${teamUsers.length} users, ${teamEntriesWeek.length} entries this week, overview=${teamOverviewMd ? 'LLM' : teamEntriesWeek.length === 0 ? 'no-content' : deps.dryRun ? 'dry-run-skip-llm' : 'fallback-list'}`);

    // ── Per-user dispatch ─────────────────────────────────────────
    for (const user of teamUsers) {
      const outcome = await runConciergeForUser({
        storage: deps.storage,
        apiClient: deps.apiClient,
        user,
        publicUrl: deps.publicUrl,
        log,
        callLLM: deps.callLLM,
        teamOverviewMd,
        teamEntriesWeek,
        dryRun: deps.dryRun,
      });
      if (outcome === 'pushed') stats.pushed++;
      else if (outcome === 'empty-skip') stats.emptySkip++;
      else if (outcome === 'opted-out') stats.optedOut++;
      else stats.errors++;
    }
  }

  log('info', `done: pushed=${stats.pushed} emptySkip=${stats.emptySkip} optedOut=${stats.optedOut} errors=${stats.errors}`);
  return stats;
}

/**
 * Schedule the weekly concierge run. Uses recursive setTimeout instead of
 * setInterval so we always schedule based on the next Monday 10am Beijing
 * boundary (resilient to drift, server restarts, missed fires).
 *
 * Returns a stop function for tests / shutdown.
 */
export function startConciergeCron(deps: RunConciergeForAllUsersDeps): () => void {
  if (process.env.CONCIERGE_CRON_DISABLED === '1') {
    console.log('[concierge-cron] DISABLED via CONCIERGE_CRON_DISABLED env var');
    return () => {};
  }

  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  function scheduleNext() {
    if (stopped) return;
    const delay = msUntilNextMonday10amBeijing();
    const targetTime = new Date(Date.now() + delay);
    console.log(`[concierge-cron] next fire at ${targetTime.toISOString()} (in ${Math.round(delay / 60000)} min)`);
    timer = setTimeout(async () => {
      try {
        await runConciergeForAllUsers(deps);
      } catch (e: any) {
        console.warn(`[concierge-cron] runAll failed: ${e?.message ?? e}`);
      } finally {
        scheduleNext();
      }
    }, delay);
  }

  scheduleNext();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
