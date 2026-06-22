/**
 * M3b — Periodic auto-summary cron.
 *
 * Sister feature to `watch.ts` but inverted: watch is event-driven and silent
 * by default; this is clock-driven and always fires. Each chat owns a row in
 * `lark_auto_summary` with cadence (daily / weekly / hourly:N) and a fire
 * hour in Asia/Shanghai. The cron loop scans enabled rows once a minute,
 * decides whether each is due, runs the same summarize pipeline as
 * `/summarize`, and saves the entry into router (publishAt: 0 — bypasses
 * the staging window the way digest-cron does).
 *
 * Time-window inputs follow cadence: hourly:N → past N hours, daily → past
 * 24h, weekly → past 7 days.
 *
 * Bound chats archive into `binding.archiveChannelId ?? binding.channelId`.
 * Unbound chats save with no channel (entry.channel = null) — the row's
 * `setupByOpenId` is used to recover a teamId at fire time.
 *
 * After a successful run we always post a card back to the chat (the user
 * configured this — they want visibility), regardless of `pushEnabled`.
 * Push is for "router → group entry mirror"; this is the dedicated channel
 * for auto-summary output.
 */

import type { Storage, LarkAutoSummaryPrefs } from '../storage.js';
import type { LarkApiClient } from './api-client.js';
import { fetchChatHistory, fetchChatMemberNames, fetchUserNames } from './api-client.js';
import type { SummarizeArgs, SummaryResult } from './llm-summarize.js';
import { saveSummary } from './save-summary.js';
import { renderTagContextForLLM } from '../entry-prompts.js';
import { buildSummaryCard } from './card-builder.js';

const SHANGHAI_TZ = 'Asia/Shanghai';

export interface AutoSummaryDeps {
  storage: Storage;
  apiClient: LarkApiClient;
  summarize: (args: SummarizeArgs) => Promise<SummaryResult>;
  publicUrl: string;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  /** Test seam — defaults to Date.now(). */
  now?: () => number;
}

/**
 * Decide whether a periodic-summary row should fire at the given clock time.
 *
 * Pure function — no I/O. Exported so we can unit-test the time math without
 * spinning up a Lark API client.
 */
export function isAutoSummaryDue(prefs: LarkAutoSummaryPrefs, now: number): boolean {
  if (!prefs.enabled) return false;

  if (prefs.cadenceKind === 'hourly') {
    const N = prefs.cadenceValue ?? 6;
    if (!prefs.lastRunAt) return true;
    return now - prefs.lastRunAt >= N * 3600_000;
  }

  // daily / weekly: fire when local clock has passed fire_hour AND we haven't
  // fired today (daily) or this week (weekly).
  const local = shanghaiTimeParts(now);
  if (local.hour < prefs.fireHour) return false;

  const lastRun = prefs.lastRunAt;
  if (prefs.cadenceKind === 'daily') {
    if (!lastRun) return true;
    const lastLocal = shanghaiTimeParts(lastRun);
    return !sameLocalDate(local, lastLocal);
  }
  if (prefs.cadenceKind === 'weekly') {
    // Weekly always fires on Monday (ISO weekday 1) for simplicity.
    if (local.weekday !== 1) return false;
    if (!lastRun) return true;
    const lastLocal = shanghaiTimeParts(lastRun);
    return !sameLocalDate(local, lastLocal);
  }
  return false;
}

/** Time window the LLM should summarize, derived from cadence. */
export function autoSummaryWindow(prefs: LarkAutoSummaryPrefs, now: number): { startTs: number; endTs: number; interpretation: string } {
  // returned ts are unix seconds (matching fetchChatHistory's expectations).
  const endTs = Math.floor(now / 1000);
  if (prefs.cadenceKind === 'hourly') {
    const N = prefs.cadenceValue ?? 6;
    return { startTs: endTs - N * 3600, endTs, interpretation: `Past ${N}h · 过去 ${N} 小时` };
  }
  if (prefs.cadenceKind === 'daily') {
    return { startTs: endTs - 24 * 3600, endTs, interpretation: 'Past 24h · 过去 24 小时' };
  }
  return { startTs: endTs - 7 * 24 * 3600, endTs, interpretation: 'Past 7 days · 过去 7 天' };
}

interface ShanghaiParts { year: number; month: number; day: number; hour: number; weekday: number; }

function shanghaiTimeParts(unixMs: number): ShanghaiParts {
  // Intl gives us the calendar fields in the target timezone.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(new Date(unixMs));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const wkMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    // Intl 'hour' is 1-24 in en-US 24h; normalize 24 → 0 to keep [0,23].
    hour: (parseInt(get('hour'), 10) || 0) % 24,
    weekday: wkMap[get('weekday')] ?? 0,
  };
}

function sameLocalDate(a: ShanghaiParts, b: ShanghaiParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * Run one auto-summary for a single chat. Returns null on success, an error
 * message on a non-fatal skip (caller logs but keeps the cron loop alive).
 */
export async function runAutoSummaryOnce(
  prefs: LarkAutoSummaryPrefs,
  deps: AutoSummaryDeps,
): Promise<string | null> {
  const { storage, apiClient, summarize, publicUrl } = deps;
  const log = deps.log ?? ((lvl, m) => console[lvl === 'info' ? 'log' : lvl](`[lark-autosum] ${m}`));
  const now = (deps.now ?? Date.now)();

  // 1. Resolve teamId + chatName + destination channel.
  const binding = await storage.getLarkChatBinding(prefs.chatId);
  let teamId: string;
  let chatName: string;
  let destinationChannelId: string | undefined;
  let organizer: string;

  if (binding) {
    teamId = binding.teamId;
    chatName = binding.chatName;
    if (binding.archiveChannelId === '__none__') {
      destinationChannelId = undefined;
    } else {
      destinationChannelId = binding.archiveChannelId ?? binding.channelId;
    }
    organizer = `auto-summary (bound by @${binding.boundBy})`;
  } else {
    const setupOpenId = prefs.setupByOpenId;
    if (!setupOpenId) return 'no setup_by_open_id and no binding';
    const user = await storage.getUserByLarkOpenId(setupOpenId);
    if (!user) return 'setup user no longer linked';
    teamId = user.teamId;
    organizer = `auto-summary (set by @${user.handle})`;
    destinationChannelId = undefined;
    // Best-effort chat name lookup
    chatName = `Lark group (${prefs.chatId.slice(-8)})`;
    try {
      const info = await apiClient.get<{ name?: string }>(`/open-apis/im/v1/chats/${encodeURIComponent(prefs.chatId)}`);
      if (info?.name) chatName = info.name;
    } catch { /* keep fallback */ }
  }

  // 2. Pull history for the cadence window.
  const win = autoSummaryWindow(prefs, now);
  let history: Awaited<ReturnType<typeof fetchChatHistory>>;
  try {
    history = await fetchChatHistory(apiClient, { chatId: prefs.chatId, startTs: win.startTs, endTs: win.endTs, cap: 1000 });
  } catch (e: any) {
    return `fetchHistory failed: ${e?.message ?? e}`;
  }
  if (history.messages.length === 0) {
    log('info', `chat=${prefs.chatId} no messages in window, skipping`);
    return null;  // not an error — record run so we don't retry every minute
  }

  // 3. Resolve sender names. Tenant display name (chat-members → contact)
  //    is most reliable; mention-harvested names only as last resort.
  //    See summarize.ts for rationale.
  const senderIds = Array.from(new Set(history.messages.map(m => m.senderId)));
  const senderNames = new Map<string, string>();
  try {
    const memberNames = await fetchChatMemberNames(apiClient, prefs.chatId);
    for (const [k, v] of memberNames) senderNames.set(k, v);
  } catch { /* ignore */ }
  let unresolved = senderIds.filter(id => !senderNames.has(id));
  if (unresolved.length > 0) {
    try {
      const contactNames = await fetchUserNames(apiClient, unresolved);
      for (const [k, v] of contactNames) senderNames.set(k, v);
    } catch { /* ignore */ }
  }
  unresolved = senderIds.filter(id => !senderNames.has(id));
  for (const id of unresolved) {
    const name = history.mentionedNames.get(id);
    if (name) senderNames.set(id, name);
  }

  // 4. Run LLM.
  const tagContext = await renderTagContextForLLM(storage, teamId);
  const chatStyle = await storage.getLarkChatStyle(prefs.chatId);
  let result: SummaryResult;
  try {
    result = await summarize({
      messages: history.messages,
      chatName,
      interpretation: win.interpretation,
      resolveSender: id => senderNames.get(id) ?? `用户${id.slice(-6)}`,
      tagContext,
      style: chatStyle ?? undefined,
    });
  } catch (e: any) {
    return `LLM failed: ${e?.message ?? e}`;
  }

  // 5. Save as router entry (no staging — it's automated).
  const saved = await saveSummary({
    storage,
    teamId,
    destinationChannelId,
    organizer,
    chatName,
    interpretation: win.interpretation,
    summary: result,
  });
  log('info', `chat=${prefs.chatId} → entry=${saved.entry.id} channel=${destinationChannelId ?? '(none)'}`);

  // 6. Post summary card back to the chat with a "saved → URL" footer.
  try {
    const card = buildSummaryCard({
      summary: result,
      interpretation: `${win.interpretation} · auto-summary saved → ${publicUrl}/entry?id=${saved.entry.id}`,
      chatName,
    });
    await apiClient.post('/open-apis/im/v1/messages?receive_id_type=chat_id', {
      receive_id: prefs.chatId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    });
  } catch (e: any) {
    log('warn', `card post failed (entry already saved): ${e?.message ?? e}`);
  }

  return null;
}

/**
 * Start the periodic-summary cron loop. Runs every 60s, scans enabled rows,
 * fires the ones that are due. Returns the timer so callers can clearInterval
 * in tests / shutdown if needed.
 */
export function startAutoSummaryCron(deps: AutoSummaryDeps): NodeJS.Timeout {
  const log = deps.log ?? ((lvl, m) => console[lvl === 'info' ? 'log' : lvl](`[lark-autosum] ${m}`));
  log('info', 'Started');
  return setInterval(async () => {
    try {
      const now = (deps.now ?? Date.now)();
      const enabled = await deps.storage.listLarkAutoSummaryEnabled();
      const due = enabled.filter(p => isAutoSummaryDue(p, now));
      for (const prefs of due) {
        try {
          const err = await runAutoSummaryOnce(prefs, deps);
          if (err) log('warn', `chat=${prefs.chatId} skipped: ${err}`);
          // Always record run timestamp — even on no-op skips — so we don't
          // retry every minute. Errors that should be retried (transient
          // network) intentionally NOT covered; treat as "best effort".
          await deps.storage.recordLarkAutoSummaryRan(prefs.chatId, now);
        } catch (e: any) {
          log('error', `chat=${prefs.chatId} fatal: ${e?.message ?? e}`);
        }
      }
    } catch (e: any) {
      log('error', `cron scan failed: ${e?.message ?? e}`);
    }
  }, 60_000);
}
