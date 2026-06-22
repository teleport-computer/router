/**
 * Parse a time-range argument from `@bot /summarize <args>`.
 *
 * Fast path (zero LLM call):
 *   ""          → last 30m
 *   "30m"/"1h"/"2d" (regex)
 *   "today"/"今天"
 *   "yesterday"/"昨天"
 *   "since_last_summary"/"上次"
 *
 * Slow path:
 *   anything else → llmFallback (caller-injected so tests don't hit network)
 */

export interface TimeRange {
  start_ts: number;
  end_ts: number;
  interpretation: string;
  source: 'default' | 'keyword' | 'llm';
}

export interface ParseTimeRangeCtx {
  now: number;             // unix seconds
  lastSummaryTs?: number;
  llmFallback?: (query: string, now: number) => Promise<TimeRange>;
}

const SHANGHAI_OFFSET = 8 * 3600;

function shanghaiMidnight(unix: number): number {
  const local = unix + SHANGHAI_OFFSET;
  const dayStartLocal = Math.floor(local / 86400) * 86400;
  return dayStartLocal - SHANGHAI_OFFSET;
}

function rangeFromDuration(now: number, seconds: number, interpretation: string, source: TimeRange['source']): TimeRange {
  return { start_ts: now - seconds, end_ts: now, interpretation, source };
}

export async function parseTimeRange(query: string, ctx: ParseTimeRangeCtx): Promise<TimeRange> {
  const q = query.trim();
  if (!q) return rangeFromDuration(ctx.now, 30 * 60, 'Last 30 minutes', 'default');

  // English unit (m / h / d) + Chinese unit (分/分钟/时/小时/天/日) — fast path
  const dur = q.match(/^(\d+)\s*(m|h|d|分钟?|小时?|时|天|日)$/i);
  if (dur) {
    const n = parseInt(dur[1], 10);
    const unit = dur[2].toLowerCase();
    let sec: number;
    let label: string;
    if (unit === 'm' || unit === '分' || unit === '分钟') {
      sec = n * 60; label = `Last ${n}m`;
    } else if (unit === 'h' || unit === '时' || unit === '小时') {
      sec = n * 3600; label = `Last ${n}h`;
    } else { // 'd' / '天' / '日'
      sec = n * 86400; label = `Last ${n}d`;
    }
    return rangeFromDuration(ctx.now, sec, label, 'keyword');
  }

  const lower = q.toLowerCase();
  if (lower === 'today' || lower === '今天') {
    const start = shanghaiMidnight(ctx.now);
    return { start_ts: start, end_ts: ctx.now, interpretation: 'Today since 00:00', source: 'keyword' };
  }
  if (lower === 'yesterday' || lower === '昨天') {
    const todayStart = shanghaiMidnight(ctx.now);
    return { start_ts: todayStart - 86400, end_ts: todayStart, interpretation: 'All day yesterday', source: 'keyword' };
  }
  if (lower === 'since_last_summary' || lower === '上次') {
    if (!ctx.lastSummaryTs) return rangeFromDuration(ctx.now, 30 * 60, 'Last 30 minutes (no previous summary)', 'default');
    return { start_ts: ctx.lastSummaryTs, end_ts: ctx.now, interpretation: 'Since last summary', source: 'keyword' };
  }

  if (ctx.llmFallback) return ctx.llmFallback(q, ctx.now);
  return rangeFromDuration(ctx.now, 30 * 60, "Didn't understand range, defaulting to last 30 minutes", 'default');
}
