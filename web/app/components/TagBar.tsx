"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TagStat } from "@/lib/api";
import { useT } from "@/lib/i18n";

export default function TagBar({
  tags,
  selected,
  onToggle,
  presetNames,
  presetDescriptions,
}: {
  tags: TagStat[];
  selected: string[];
  onToggle: (tag: string) => void;
  presetNames: Set<string>;
  presetDescriptions: Map<string, string>;
}) {
  const t = useT();

  const containerRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState<number | null>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Pin active tags to the front so they remain visible even when the bar is
  // collapsed to a single row, and so the "currently filtering by" set reads
  // as a group rather than scattered highlights.
  const orderedTags = useMemo(() => {
    if (selected.length === 0) return tags;
    const selectedSet = new Set(selected);
    const active: TagStat[] = [];
    const rest: TagStat[] = [];
    for (const t of tags) (selectedSet.has(t.tag) ? active : rest).push(t);
    return [...active, ...rest];
  }, [tags, selected]);

  // Measure: figure out the height of a single row by reading the first child,
  // then compare full scrollHeight to that to decide whether to show the
  // toggle. Re-measures on container resize (window resize, sidebar open, etc).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const first = el.firstElementChild as HTMLElement | null;
      if (!first) {
        setOverflows(false);
        return;
      }
      const h = first.offsetHeight;
      setRowHeight(h);
      // +4 tolerance for sub-pixel rounding; gap is between rows so the second
      // row's top is `h + gap` below the first row's top.
      setOverflows(el.scrollHeight > h + 4);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [orderedTags.length]);

  const collapsed = overflows && !expanded;

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        style={collapsed && rowHeight ? { maxHeight: rowHeight } : undefined}
        className={`flex flex-wrap gap-2 items-center ${collapsed ? "overflow-hidden" : ""}`}
      >
        {orderedTags.map(({ tag, count }) => {
          const isActive = selected.includes(tag);
          const isPreset = presetNames.has(tag);
          const description = presetDescriptions.get(tag);
          return (
            <div key={tag} className="relative group">
              <button
                onClick={() => onToggle(tag)}
                className={`cursor-pointer text-[12px] font-medium px-3 py-1.5 rounded-full border transition-all duration-150 ${
                  isActive
                    ? "bg-(--tag-active-bg) text-(--tag-active-text) border-transparent shadow-sm"
                    : isPreset
                      ? "bg-(--tag-bg) text-(--tag-text) border-(--card-border) border-solid hover:border-(--accent) hover:shadow-sm"
                      : "bg-(--tag-bg) text-(--tag-text) border-(--card-border) border-dashed hover:border-(--accent) hover:shadow-sm"
                }`}
              >
                #{tag}
                <span className="ml-1.5 text-[10px] tabular-nums text-neutral-400">{count}</span>
              </button>
              {description && (
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 px-2.5 py-1.5 text-[11px] text-white bg-neutral-800 rounded-lg shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-10">
                  {description}
                </div>
              )}
            </div>
          );
        })}
        {orderedTags.length > 0 && (
          <a
            href="/settings/tags"
            className="cursor-pointer text-[11px] px-2.5 py-1.5 rounded-full text-(--muted-light) hover:text-(--accent) transition-all flex items-center gap-1"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {t("tags.manage")}
          </a>
        )}
      </div>
      {overflows && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="cursor-pointer text-[11px] text-(--muted) hover:text-(--accent) transition-colors"
        >
          {expanded ? `▴ ${t("tags.showLess")}` : `▾ ${t("tags.showMore")}`}
        </button>
      )}
    </div>
  );
}
