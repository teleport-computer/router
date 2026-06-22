// Group entries by local calendar day. Header uses progressive fallback:
// today → yesterday → weekday (within 7d) → month-day (same year) → full date.
// Time zone is always the browser's local zone — server timestamps are UTC ms,
// toDateString() / getFullYear() etc. read in local zone.

import type { Lang } from "./i18n";

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type HasTimestamp = { timestamp: number };

export type DateGroup<T> = {
  key: string;
  label: string;
  items: T[];
};

export function groupByLocalDate<T extends HasTimestamp>(
  items: T[],
  lang: Lang,
  t: (key: string, vars?: Record<string, string | number>) => string,
): DateGroup<T>[] {
  const now = new Date();
  const today = startOfLocalDay(now);
  const yesterday = today - 24 * 60 * 60 * 1000;
  const weekAgo = today - 6 * 24 * 60 * 60 * 1000;

  const buckets = new Map<string, { label: string; items: T[] }>();
  for (const item of items) {
    const d = new Date(item.timestamp);
    const dayStart = startOfLocalDay(d);
    const key = String(dayStart);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { label: labelFor(d, dayStart, { today, yesterday, weekAgo, now, lang, t }), items: [] };
      buckets.set(key, bucket);
    }
    bucket.items.push(item);
  }
  return [...buckets.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([key, { label, items }]) => ({ key, label, items }));
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function labelFor(
  d: Date,
  dayStart: number,
  ctx: {
    today: number;
    yesterday: number;
    weekAgo: number;
    now: Date;
    lang: Lang;
    t: (key: string, vars?: Record<string, string | number>) => string;
  },
): string {
  if (dayStart === ctx.today) return ctx.t("dateGroup.today");
  if (dayStart === ctx.yesterday) return ctx.t("dateGroup.yesterday");
  if (dayStart >= ctx.weekAgo) return ctx.t(`dateGroup.weekday.${d.getDay()}`);
  if (d.getFullYear() === ctx.now.getFullYear()) {
    if (ctx.lang === "en") return ctx.t("dateGroup.monthDay", { mon: EN_MONTHS[d.getMonth()], d: d.getDate() });
    return ctx.t("dateGroup.monthDay", { m: d.getMonth() + 1, d: d.getDate() });
  }
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
