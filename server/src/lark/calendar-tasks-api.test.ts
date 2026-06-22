import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getMyUpcomingEvents,
  getMyOpenTasks,
  createTask,
  createCalendarEvent,
  formatCalendarHint,
  _clearPrimaryCalendarCache,
} from './calendar-tasks-api.js';
import type { LarkApiClient } from './api-client.js';

function makeMockClient(): { client: LarkApiClient; get: any; post: any; patch: any } {
  const get = vi.fn();
  const post = vi.fn();
  const patch = vi.fn();
  return { client: { get, post, patch }, get, post, patch };
}

beforeEach(() => {
  _clearPrimaryCalendarCache();
});

describe('getMyUpcomingEvents', () => {
  it('looks up primary calendar then fetches events as user', async () => {
    const { client, get } = makeMockClient();
    get.mockResolvedValueOnce({ calendar_list: [{ calendar_id: 'cal_123', type: 'primary' }] });
    get.mockResolvedValueOnce({
      items: [{
        event_id: 'evt_1',
        summary: 'Standup',
        description: 'Daily',
        start_time: { timestamp: '1800000000' },
        end_time: { timestamp: '1800001800' },
        attendees: [{ open_id: 'ou_a' }, { open_id: 'ou_b' }],
      }],
    });

    const out = await getMyUpcomingEvents(client, 'hx', 2);
    expect(out).toEqual([{
      event_id: 'evt_1',
      summary: 'Standup',
      description: 'Daily',
      start_ms: 1800000000 * 1000,
      end_ms: 1800001800 * 1000,
      attendee_open_ids: ['ou_a', 'ou_b'],
    }]);
    // First call: list calendars (with asUser)
    expect(get).toHaveBeenNthCalledWith(1,
      '/open-apis/calendar/v4/calendars',
      { page_size: '50' },
      { asUser: 'hx' },
    );
    // Second call: fetch events (with asUser)
    expect(get.mock.calls[1][0]).toBe('/open-apis/calendar/v4/calendars/cal_123/events');
    expect(get.mock.calls[1][2]).toEqual({ asUser: 'hx' });
  });

  it('caches primary calendar id across calls', async () => {
    const { client, get } = makeMockClient();
    get.mockResolvedValueOnce({ calendar_list: [{ calendar_id: 'cal_xyz', type: 'primary' }] });
    get.mockResolvedValue({ items: [] });

    await getMyUpcomingEvents(client, 'hx', 1);
    await getMyUpcomingEvents(client, 'hx', 1);

    const listCalls = get.mock.calls.filter((c: any[]) => c[0] === '/open-apis/calendar/v4/calendars');
    expect(listCalls.length).toBe(1);
  });

  it('returns [] when no primary calendar found', async () => {
    const { client, get } = makeMockClient();
    get.mockResolvedValueOnce({ calendar_list: [{ calendar_id: 'cal_1', type: 'shared' }] });
    const out = await getMyUpcomingEvents(client, 'hx', 1);
    expect(out).toEqual([]);
  });

  it('returns [] when calendar list call throws', async () => {
    const { client, get } = makeMockClient();
    get.mockRejectedValueOnce(new Error('403 forbidden — scope missing'));
    const out = await getMyUpcomingEvents(client, 'hx', 1);
    expect(out).toEqual([]);
  });

  it('returns [] when events fetch throws (calendar list ok)', async () => {
    const { client, get } = makeMockClient();
    get.mockResolvedValueOnce({ calendar_list: [{ calendar_id: 'cal_1', type: 'primary' }] });
    get.mockRejectedValueOnce(new Error('500'));
    const out = await getMyUpcomingEvents(client, 'hx', 1);
    expect(out).toEqual([]);
  });

  it('skips events with malformed timestamps', async () => {
    const { client, get } = makeMockClient();
    get.mockResolvedValueOnce({ calendar_list: [{ calendar_id: 'cal_1', type: 'primary' }] });
    get.mockResolvedValueOnce({
      items: [
        { event_id: 'good', summary: 'OK', start_time: { timestamp: '100' }, end_time: { timestamp: '200' } },
        { event_id: 'bad', summary: 'No times' },
      ],
    });
    const out = await getMyUpcomingEvents(client, 'hx', 1);
    expect(out).toHaveLength(1);
    expect(out[0].event_id).toBe('good');
  });
});

describe('getMyOpenTasks', () => {
  it('fetches open tasks and filters by due window', async () => {
    const { client, get } = makeMockClient();
    const nowMs = Date.now();
    get.mockResolvedValueOnce({
      items: [
        { guid: 't1', summary: 'within', due: { timestamp: String(Math.floor((nowMs + 3 * 86400000) / 1000)) } },
        { guid: 't2', summary: 'too far', due: { timestamp: String(Math.floor((nowMs + 30 * 86400000) / 1000)) } },
        { guid: 't3', summary: 'no due' },
      ],
    });

    const out = await getMyOpenTasks(client, 'hx', 14);

    expect(get).toHaveBeenCalledWith(
      '/open-apis/task/v2/tasks',
      { completed: 'false', page_size: '50' },
      { asUser: 'hx' },
    );
    const guids = out.map(t => t.task_guid).sort();
    expect(guids).toEqual(['t1', 't3']);
  });

  it('returns [] on api error', async () => {
    const { client, get } = makeMockClient();
    get.mockRejectedValueOnce(new Error('boom'));
    expect(await getMyOpenTasks(client, 'hx', 14)).toEqual([]);
  });
});

describe('createTask', () => {
  it('posts task as user with all fields populated', async () => {
    const { client, post } = makeMockClient();
    post.mockResolvedValueOnce({ task: { guid: 'new_task_xyz', url: 'https://applink' } });

    const out = await createTask(client, 'hx', {
      title: 'Otter spec',
      description: 'Write the v2 spec',
      due_ms: 1800000000000,
      assignee_open_id: 'ou_amiller',
    });

    expect(out).toEqual({ task_guid: 'new_task_xyz', url: 'https://applink' });
    expect(post).toHaveBeenCalledWith(
      '/open-apis/task/v2/tasks',
      {
        summary: 'Otter spec',
        description: 'Write the v2 spec',
        due: { timestamp: '1800000000', is_all_day: false },
        members: [{ id: 'ou_amiller', id_type: 'open_id', role: 'assignee' }],
      },
      { asUser: 'hx' },
    );
  });

  it('omits optional fields when not provided', async () => {
    const { client, post } = makeMockClient();
    post.mockResolvedValueOnce({ task: { guid: 'g1' } });
    await createTask(client, 'hx', { title: 'Only title' });
    expect(post).toHaveBeenCalledWith(
      '/open-apis/task/v2/tasks',
      { summary: 'Only title' },
      { asUser: 'hx' },
    );
  });

  it('returns null on api error', async () => {
    const { client, post } = makeMockClient();
    post.mockRejectedValueOnce(new Error('rate limited'));
    expect(await createTask(client, 'hx', { title: 'x' })).toBeNull();
  });

  it('returns null when api returns no guid', async () => {
    const { client, post } = makeMockClient();
    post.mockResolvedValueOnce({ task: {} });
    expect(await createTask(client, 'hx', { title: 'x' })).toBeNull();
  });
});

describe('createCalendarEvent', () => {
  it('looks up primary calendar then posts event then invites attendees', async () => {
    const { client, get, post } = makeMockClient();
    get.mockResolvedValueOnce({ calendar_list: [{ calendar_id: 'cal_p', type: 'primary' }] });
    post.mockResolvedValueOnce({ event: { event_id: 'evt_new' } });
    post.mockResolvedValueOnce({});

    const out = await createCalendarEvent(client, 'hx', {
      title: 'Design review',
      start_ms: 1800000000000,
      end_ms: 1800003600000,
      attendee_open_ids: ['ou_liko'],
    });

    expect(out).toEqual({ event_id: 'evt_new', calendar_id: 'cal_p' });
    expect(post).toHaveBeenNthCalledWith(1,
      '/open-apis/calendar/v4/calendars/cal_p/events',
      {
        summary: 'Design review',
        start_time: { timestamp: '1800000000' },
        end_time: { timestamp: '1800003600' },
      },
      { asUser: 'hx' },
    );
    expect(post).toHaveBeenNthCalledWith(2,
      '/open-apis/calendar/v4/calendars/cal_p/events/evt_new/attendees',
      { attendees: [{ type: 'user', user_id: 'ou_liko', user_id_type: 'open_id' }] },
      { asUser: 'hx' },
    );
  });

  it('event survives even if attendee invite fails', async () => {
    const { client, get, post } = makeMockClient();
    get.mockResolvedValueOnce({ calendar_list: [{ calendar_id: 'cal_p', type: 'primary' }] });
    post.mockResolvedValueOnce({ event: { event_id: 'evt_x' } });
    post.mockRejectedValueOnce(new Error('attendee api 500'));

    const out = await createCalendarEvent(client, 'hx', {
      title: 't', start_ms: 1, end_ms: 2,
      attendee_open_ids: ['ou_a'],
    });

    expect(out?.event_id).toBe('evt_x');
  });

  it('returns null when no primary calendar', async () => {
    const { client, get } = makeMockClient();
    get.mockResolvedValueOnce({ calendar_list: [] });
    expect(await createCalendarEvent(client, 'hx', { title: 't', start_ms: 1, end_ms: 2 })).toBeNull();
  });

  it('returns null when event create fails', async () => {
    const { client, get, post } = makeMockClient();
    get.mockResolvedValueOnce({ calendar_list: [{ calendar_id: 'cal_p', type: 'primary' }] });
    post.mockRejectedValueOnce(new Error('500'));
    expect(await createCalendarEvent(client, 'hx', { title: 't', start_ms: 1, end_ms: 2 })).toBeNull();
  });
});

describe('formatCalendarHint', () => {
  // Pin "today" so the date bucketing is deterministic across the test run.
  // Asia/Shanghai noon → date is unambiguous.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T04:00:00Z')); // 12:00 in Asia/Shanghai
  });
  afterEach(() => vi.useRealTimers());

  const todayMs = (h: number, m: number): number => {
    // 2026-05-14 in Asia/Shanghai: utcDate at the time-of-day, minus the +8 offset
    return Date.UTC(2026, 4, 14, h - 8, m);
  };
  const tomorrowMs = (h: number, m: number): number => Date.UTC(2026, 4, 15, h - 8, m);
  const dueOnlyDate = (year: number, month: number, day: number): number =>
    Date.UTC(year, month - 1, day, -8, 0); // midnight Shanghai of that day

  it('returns empty string when both empty', () => {
    expect(formatCalendarHint([], [])).toBe('');
  });

  it('formats today + tomorrow events sorted by start time', () => {
    const out = formatCalendarHint(
      [
        // Out-of-order on purpose
        { event_id: 'e2', summary: 'Tomorrow standup', start_ms: tomorrowMs(10, 0), end_ms: tomorrowMs(10, 30), attendee_open_ids: [] },
        { event_id: 'e1', summary: 'Today review', start_ms: todayMs(15, 0), end_ms: todayMs(16, 0), attendee_open_ids: [] },
        { event_id: 'e0', summary: 'Earlier today', start_ms: todayMs(9, 30), end_ms: todayMs(10, 0), attendee_open_ids: [] },
      ],
      [],
    );
    // Today bucket has the two today events in time order
    expect(out).toContain("Today's events:");
    expect(out.indexOf('09:30–10:00  Earlier today')).toBeLessThan(out.indexOf('15:00–16:00  Today review'));
    // Tomorrow bucket separately
    expect(out).toContain("Tomorrow's events:\n- 10:00–10:30  Tomorrow standup");
  });

  it('formats tasks with due date or [no due]', () => {
    const out = formatCalendarHint(
      [],
      [
        { task_guid: 't1', summary: 'Otter spec', due_ms: dueOnlyDate(2026, 5, 19) },
        { task_guid: 't2', summary: 'Wandering thought' /* no due */ },
      ],
    );
    expect(out).toContain('[due 2026-05-19] Otter spec');
    expect(out).toContain('[no due] Wandering thought');
  });

  it('omits sections that have no items', () => {
    // Today only — no tomorrow events, no tasks
    const out = formatCalendarHint(
      [{ event_id: 'e1', summary: 'meeting', start_ms: todayMs(14, 0), end_ms: todayMs(15, 0), attendee_open_ids: [] }],
      [],
    );
    expect(out).toContain("Today's events:");
    expect(out).not.toContain("Tomorrow's events:");
    expect(out).not.toContain('Open tasks');
  });

  it('falls back to "(no title)" for empty summary', () => {
    const out = formatCalendarHint(
      [{ event_id: 'e1', summary: '', start_ms: todayMs(10, 0), end_ms: todayMs(10, 30), attendee_open_ids: [] }],
      [{ task_guid: 't1', summary: '' }],
    );
    expect(out).toContain('10:00–10:30  (no title)');
    expect(out).toContain('[no due] (no title)');
  });

  it('skips events outside today/tomorrow bucket', () => {
    const dayAfterTomorrowMs = Date.UTC(2026, 4, 16, 6, 0); // 14:00 Shanghai on day-after
    const out = formatCalendarHint(
      [{ event_id: 'far', summary: 'Future thing', start_ms: dayAfterTomorrowMs, end_ms: dayAfterTomorrowMs + 3600_000, attendee_open_ids: [] }],
      [],
    );
    expect(out).toBe(''); // no today/tomorrow event AND no tasks → empty
  });

  it('always includes the section header + caller-instruction footer when non-empty', () => {
    const out = formatCalendarHint(
      [],
      [{ task_guid: 't1', summary: 'X' }],
    );
    expect(out).toContain('═══ MY LARK CALENDAR + TASKS');
    expect(out).toContain('router_create_lark_task');
    expect(out).toContain('router_create_lark_calendar_event');
  });
});
