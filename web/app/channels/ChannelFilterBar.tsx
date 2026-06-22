"use client";

import { useMemo } from "react";
import type { RouterEntry } from "@/lib/api";
import { useT } from "@/lib/i18n";

export type TimeRange = 'all' | '7d' | '30d' | '90d';
export type SortOrder = 'newest' | 'oldest';
export type DigestFilter = 'all' | 'only' | 'hide';

export interface FilterState {
  tags: string[];         // selected tag names (empty = no tag filter)
  timeRange: TimeRange;
  sort: SortOrder;
  digest: DigestFilter;
}

export const DEFAULT_FILTER_STATE: FilterState = {
  tags: [],
  timeRange: 'all',
  sort: 'newest',
  digest: 'all',
};

export default function ChannelFilterBar({
  entries,
  value,
  onChange,
}: {
  entries: RouterEntry[];
  value: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const t = useT();

  // Build the tag universe from the current channel's entries.
  // Hide the system-prefixed ones (auto:*, channel:*) — users filter digests
  // via the dedicated Type control, not via tag.
  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      for (const tag of e.tags ?? []) {
        if (tag.startsWith('auto:') || tag.startsWith('channel:') || tag === 'weekly' || tag === 'monthly') continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  }, [entries]);

  const toggleTag = (tag: string) => {
    const has = value.tags.includes(tag);
    onChange({ ...value, tags: has ? value.tags.filter(x => x !== tag) : [...value.tags, tag] });
  };

  const clearAll = () => onChange(DEFAULT_FILTER_STATE);

  const timeRanges: TimeRange[] = ['all', '7d', '30d', '90d'];
  const digestOptions: DigestFilter[] = ['all', 'only', 'hide'];

  const hasAnyFilter =
    value.tags.length > 0 ||
    value.timeRange !== 'all' ||
    value.sort !== 'newest' ||
    value.digest !== 'all';

  return (
    <div className="mb-3 p-3 rounded-xl border border-(--card-border) bg-(--card) space-y-2.5">
      {/* Time range + Sort + Digest type (single row, wraps on mobile) */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-(--muted)">{t('channels.filter.timeLabel')}:</span>
        {timeRanges.map(r => (
          <button
            key={r}
            type="button"
            onClick={() => onChange({ ...value, timeRange: r })}
            className={`cursor-pointer px-2 py-0.5 rounded-md border transition-colors ${
              value.timeRange === r
                ? 'bg-(--accent) text-white border-(--accent)'
                : 'border-(--card-border) hover:border-(--accent)'
            }`}
          >
            {t(`channels.filter.time.${r}`)}
          </button>
        ))}

        <span className="text-(--muted) ml-2">{t('channels.filter.sortLabel')}:</span>
        <button
          type="button"
          onClick={() => onChange({ ...value, sort: value.sort === 'newest' ? 'oldest' : 'newest' })}
          className="cursor-pointer px-2 py-0.5 rounded-md border border-(--card-border) hover:border-(--accent) transition-colors"
        >
          {t(`channels.filter.sort.${value.sort}`)}
        </button>

        <span className="text-(--muted) ml-2">{t('channels.filter.typeLabel')}:</span>
        {digestOptions.map(d => (
          <button
            key={d}
            type="button"
            onClick={() => onChange({ ...value, digest: d })}
            className={`cursor-pointer px-2 py-0.5 rounded-md border transition-colors ${
              value.digest === d
                ? 'bg-(--accent) text-white border-(--accent)'
                : 'border-(--card-border) hover:border-(--accent)'
            }`}
          >
            {t(`channels.filter.type.${d}`)}
          </button>
        ))}

        {hasAnyFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="cursor-pointer ml-auto text-(--muted-light) hover:text-foreground underline underline-offset-2"
          >
            {t('channels.filter.clear')}
          </button>
        )}
      </div>

      {/* Tag chips */}
      {availableTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-(--muted)">{t('channels.filter.tags')}:</span>
          {availableTags.map(tag => {
            const active = value.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`cursor-pointer px-2 py-0.5 rounded-full border transition-colors font-mono ${
                  active
                    ? 'bg-(--accent) text-white border-(--accent)'
                    : 'border-(--card-border) hover:border-(--accent) text-(--muted)'
                }`}
              >
                #{tag}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Apply a FilterState to an entry list. Pure function, easy to test if needed.
 * AND across control groups, OR within tag selection.
 */
export function applyFilters(entries: RouterEntry[], f: FilterState): RouterEntry[] {
  let out = entries;

  if (f.timeRange !== 'all') {
    const days = f.timeRange === '7d' ? 7 : f.timeRange === '30d' ? 30 : 90;
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    out = out.filter(e => e.timestamp >= since);
  }

  if (f.tags.length > 0) {
    out = out.filter(e => (e.tags ?? []).some(t => f.tags.includes(t)));
  }

  if (f.digest === 'only') {
    out = out.filter(e => (e.tags ?? []).includes('auto:digest'));
  } else if (f.digest === 'hide') {
    out = out.filter(e => !(e.tags ?? []).includes('auto:digest'));
  }

  out = [...out].sort((a, b) =>
    f.sort === 'newest' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp
  );

  return out;
}
