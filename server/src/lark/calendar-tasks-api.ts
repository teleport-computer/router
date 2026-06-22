/**
 * Lark Calendar + Task API wrappers — all use user-token (asUser).
 * Tenant token can't see individual users' calendar/task data.
 *
 * Failure policy: every public function catches Lark errors and returns
 * `null` (or empty array) + console.warn. Callers (MCP inject, MCP tools)
 * must degrade gracefully — never throw across the call boundary, since
 * Lark scope/token issues should not crash MCP init or tool calls.
 *
 * See docs/superpowers/specs/2026-05-14-lark-calendar-tasks-design.md.
 */

import type { LarkApiClient } from './api-client.js';

// ───────── Types ─────────

export interface LarkCalendarEvent {
  event_id: string;
  summary: string;            // Lark calls the title "summary" (iCal convention)
  description?: string;
  start_ms: number;           // unix ms
  end_ms: number;             // unix ms
  attendee_open_ids: string[];
}

export interface LarkOpenTask {
  task_guid: string;          // Lark task v2 uses guid
  summary: string;
  description?: string;
  due_ms?: number;            // unix ms
  /** Lark task URL (applink, opens in Lark client). */
  url?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  due_ms?: number;
  assignee_open_id?: string;  // Lark open_id of assignee; null/undefined = unassigned
}

export interface CreateCalendarEventInput {
  title: string;
  description?: string;
  start_ms: number;
  end_ms: number;
  attendee_open_ids?: string[];
}

// ───────── Per-process cache: handle → primary calendar_id ─────────
// Lark calendar API requires a calendar_id (no `primary` keyword); each user
// has one primary calendar that doesn't change. Caching avoids an extra GET
// per inject. Cleared on process restart (acceptable; fresh fetch on next call).
const primaryCalendarCache = new Map<string, string>();

async function getPrimaryCalendarId(
  client: LarkApiClient,
  asUser: string,
): Promise<string | null> {
  const cached = primaryCalendarCache.get(asUser);
  if (cached) return cached;
  try {
    const data = await client.get<{ calendar_list?: Array<{ calendar_id: string; type: string }> }>(
      '/open-apis/calendar/v4/calendars',
      { page_size: '50' },
      { asUser },
    );
    const primary = (data.calendar_list ?? []).find(c => c.type === 'primary');
    if (!primary) {
      console.warn(`[lark-calendar] no primary calendar found for ${asUser}`);
      return null;
    }
    primaryCalendarCache.set(asUser, primary.calendar_id);
    return primary.calendar_id;
  } catch (e: any) {
    console.warn(`[lark-calendar] getPrimaryCalendarId(${asUser}) failed: ${e?.message ?? e}`);
    return null;
  }
}

// ───────── Read: events ─────────

/**
 * Fetch the user's own upcoming calendar events from now → now + withinDays.
 * Returns [] on any failure (no scope, no token, no calendar, network error).
 */
export async function getMyUpcomingEvents(
  client: LarkApiClient,
  asUser: string,
  withinDays: number,
): Promise<LarkCalendarEvent[]> {
  const calendarId = await getPrimaryCalendarId(client, asUser);
  if (!calendarId) return [];
  const nowSec = Math.floor(Date.now() / 1000);
  const endSec = nowSec + withinDays * 24 * 60 * 60;
  try {
    const data = await client.get<{ items?: any[] }>(
      `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        start_time: String(nowSec),
        end_time: String(endSec),
        page_size: '50',
      },
      { asUser },
    );
    return (data.items ?? []).map(rawCalendarEventToTyped).filter((e): e is LarkCalendarEvent => e !== null);
  } catch (e: any) {
    console.warn(`[lark-calendar] getMyUpcomingEvents(${asUser}) failed: ${e?.message ?? e}`);
    return [];
  }
}

function rawCalendarEventToTyped(raw: any): LarkCalendarEvent | null {
  if (!raw || !raw.event_id) return null;
  // Lark returns start_time/end_time as { timestamp: "1700000000" } (sec as string)
  const startSec = Number(raw.start_time?.timestamp);
  const endSec = Number(raw.end_time?.timestamp);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return null;
  return {
    event_id: String(raw.event_id),
    summary: String(raw.summary ?? ''),
    description: raw.description ? String(raw.description) : undefined,
    start_ms: startSec * 1000,
    end_ms: endSec * 1000,
    attendee_open_ids: Array.isArray(raw.attendees)
      ? raw.attendees.map((a: any) => String(a?.open_id ?? '')).filter(Boolean)
      : [],
  };
}

// ───────── Read: tasks ─────────

/**
 * Fetch the user's open (incomplete) tasks. The Lark API returns ALL
 * incomplete tasks; we filter in app code to the ones with due dates within
 * `withinDays`, plus any tasks with no due date (they stay in the "open
 * backlog" view but might not be on the user's plate).
 *
 * Returns [] on any failure.
 */
export async function getMyOpenTasks(
  client: LarkApiClient,
  asUser: string,
  withinDays: number,
): Promise<LarkOpenTask[]> {
  try {
    const data = await client.get<{ items?: any[] }>(
      '/open-apis/task/v2/tasks',
      {
        completed: 'false',
        page_size: '50',
      },
      { asUser },
    );
    const cutoffMs = Date.now() + withinDays * 24 * 60 * 60 * 1000;
    return (data.items ?? [])
      .map(rawTaskToTyped)
      .filter((t): t is LarkOpenTask => t !== null)
      .filter(t => t.due_ms === undefined || t.due_ms <= cutoffMs);
  } catch (e: any) {
    console.warn(`[lark-task] getMyOpenTasks(${asUser}) failed: ${e?.message ?? e}`);
    return [];
  }
}

function rawTaskToTyped(raw: any): LarkOpenTask | null {
  if (!raw || !raw.guid) return null;
  // Lark task v2: due is { timestamp: "<unix sec>" } (string sec)
  const dueSecRaw = raw.due?.timestamp;
  const dueSec = dueSecRaw !== undefined && dueSecRaw !== null && dueSecRaw !== '' ? Number(dueSecRaw) : undefined;
  return {
    task_guid: String(raw.guid),
    summary: String(raw.summary ?? ''),
    description: raw.description ? String(raw.description) : undefined,
    due_ms: dueSec !== undefined && Number.isFinite(dueSec) ? dueSec * 1000 : undefined,
    url: typeof raw.url === 'string' ? raw.url : undefined,
  };
}

// ───────── Write: task ─────────

/**
 * Create a task in the user's Lark task list. Returns the task guid + URL on
 * success, null on failure.
 */
export async function createTask(
  client: LarkApiClient,
  asUser: string,
  input: CreateTaskInput,
): Promise<{ task_guid: string; url?: string } | null> {
  try {
    const body: Record<string, unknown> = {
      summary: input.title,
    };
    if (input.description) body.description = input.description;
    if (input.due_ms !== undefined) {
      body.due = { timestamp: String(Math.floor(input.due_ms / 1000)), is_all_day: false };
    }
    if (input.assignee_open_id) {
      body.members = [{ id: input.assignee_open_id, id_type: 'open_id', role: 'assignee' }];
    }
    const data = await client.post<{ task?: { guid?: string; url?: string } }>(
      '/open-apis/task/v2/tasks',
      body,
      { asUser },
    );
    const guid = data.task?.guid;
    if (!guid) {
      console.warn(`[lark-task] createTask(${asUser}) returned no guid`);
      return null;
    }
    return { task_guid: guid, url: data.task?.url };
  } catch (e: any) {
    console.warn(`[lark-task] createTask(${asUser}) failed: ${e?.message ?? e}`);
    return null;
  }
}

// ───────── Write: calendar event ─────────

/**
 * Create a calendar event on the user's primary calendar. Returns event id
 * (and applink URL constructed from it) on success, null on failure.
 */
export async function createCalendarEvent(
  client: LarkApiClient,
  asUser: string,
  input: CreateCalendarEventInput,
): Promise<{ event_id: string; calendar_id: string } | null> {
  const calendarId = await getPrimaryCalendarId(client, asUser);
  if (!calendarId) return null;
  try {
    const body: Record<string, unknown> = {
      summary: input.title,
      start_time: { timestamp: String(Math.floor(input.start_ms / 1000)) },
      end_time: { timestamp: String(Math.floor(input.end_ms / 1000)) },
    };
    if (input.description) body.description = input.description;
    const data = await client.post<{ event?: { event_id?: string } }>(
      `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events`,
      body,
      { asUser },
    );
    const eventId = data.event?.event_id;
    if (!eventId) {
      console.warn(`[lark-calendar] createCalendarEvent(${asUser}) returned no event_id`);
      return null;
    }
    // Attendees are added via a separate call after the event exists
    if (input.attendee_open_ids && input.attendee_open_ids.length > 0) {
      try {
        await client.post(
          `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/attendees`,
          {
            attendees: input.attendee_open_ids.map(open_id => ({
              type: 'user',
              user_id: open_id,
              user_id_type: 'open_id',
            })),
          },
          { asUser },
        );
      } catch (e: any) {
        // Event was created, just attendee invite failed — log and continue
        console.warn(`[lark-calendar] add attendees to ${eventId} failed: ${e?.message ?? e}`);
      }
    }
    return { event_id: eventId, calendar_id: calendarId };
  } catch (e: any) {
    console.warn(`[lark-calendar] createCalendarEvent(${asUser}) failed: ${e?.message ?? e}`);
    return null;
  }
}

// ───────── Format: calendar + tasks → markdown block for MCP injection ─────────

/**
 * Format a per-user calendar + open-tasks snapshot as a markdown block to
 * inject into MCP `instructions`. Empty input → empty string.
 *
 * Time formatting: server doesn't know each user's timezone, so we hardcode
 * Asia/Shanghai (team is in China-time; matches weekly brief's choice).
 * Events are bucketed by today / tomorrow; later events get dropped from
 * the snapshot (caller passes only events within the desired window).
 */
export function formatCalendarHint(
  events: LarkCalendarEvent[],
  tasks: LarkOpenTask[],
): string {
  if (events.length === 0 && tasks.length === 0) return '';
  const tz = 'Asia/Shanghai';
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(now.getTime() + 86400000));

  const fmtTime = (ms: number): string =>
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
  const fmtDate = (ms: number): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

  const todayEvents: string[] = [];
  const tomorrowEvents: string[] = [];
  for (const e of [...events].sort((a, b) => a.start_ms - b.start_ms)) {
    const d = fmtDate(e.start_ms);
    const line = `${fmtTime(e.start_ms)}–${fmtTime(e.end_ms)}  ${e.summary || '(no title)'}`;
    if (d === today) todayEvents.push(line);
    else if (d === tomorrow) tomorrowEvents.push(line);
  }

  const taskLines = tasks.map(t => {
    const due = t.due_ms ? `[due ${fmtDate(t.due_ms)}]` : '[no due]';
    return `${due} ${t.summary || '(no title)'}`;
  });

  const sections: string[] = [];
  if (todayEvents.length > 0) sections.push(`Today's events:\n- ${todayEvents.join('\n- ')}`);
  if (tomorrowEvents.length > 0) sections.push(`Tomorrow's events:\n- ${tomorrowEvents.join('\n- ')}`);
  if (taskLines.length > 0) sections.push(`Open tasks (due within 14 days, or no due date):\n- ${taskLines.join('\n- ')}`);

  // Possible: input was non-empty but all events fell outside today/tomorrow
  // bucket → no sections to render → emit empty string (don't pollute MCP
  // instructions with a header + footer wrapping nothing).
  if (sections.length === 0) return '';

  return `═══ MY LARK CALENDAR + TASKS (live, refreshed each MCP connect; timezone: Asia/Shanghai) ═══

${sections.join('\n\n')}

(Use this as background to answer scheduling questions and surface conflicts. No tool call needed to read it. To CREATE a task or event, use router_create_lark_task / router_create_lark_calendar_event after explicit user confirmation.)

`;
}

// ───────── Test-only: clear in-process caches ─────────
/** @internal Clears the per-process primary-calendar cache. Test use only. */
export function _clearPrimaryCalendarCache(): void {
  primaryCalendarCache.clear();
}
