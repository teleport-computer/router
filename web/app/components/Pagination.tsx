"use client";

import { useT } from "@/lib/i18n";

export default function Pagination({
  current,
  total,
  onChange,
}: {
  current: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const t = useT();
  if (total <= 1) return null;

  // Build page numbers: always show first, last, current ± 1, with ellipsis
  const pages: (number | "...")[] = [];
  const add = (n: number) => { if (n >= 1 && n <= total && !pages.includes(n)) pages.push(n); };
  add(1);
  for (let i = current - 1; i <= current + 1; i++) add(i);
  add(total);
  // Insert ellipsis
  const withGaps: (number | "...")[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && (pages[i] as number) - (pages[i - 1] as number) > 1) withGaps.push("...");
    withGaps.push(pages[i]);
  }

  return (
    <div className="flex items-center justify-center gap-1 mt-6 mb-2">
      <button
        onClick={() => onChange(current - 1)}
        disabled={current <= 1}
        className="cursor-pointer text-[12px] px-2.5 py-1.5 rounded-lg border border-(--card-border) text-(--muted) hover:text-foreground hover:border-(--accent) disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        ‹
      </button>
      {withGaps.map((p, i) =>
        p === "..." ? (
          <span key={`gap-${i}`} className="text-[12px] text-(--muted-light) px-1">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`cursor-pointer text-[12px] min-w-[32px] py-1.5 rounded-lg border transition-all ${
              p === current
                ? "bg-(--accent) text-white border-transparent font-semibold"
                : "border-(--card-border) text-(--muted) hover:text-foreground hover:border-(--accent)"
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onChange(current + 1)}
        disabled={current >= total}
        className="cursor-pointer text-[12px] px-2.5 py-1.5 rounded-lg border border-(--card-border) text-(--muted) hover:text-foreground hover:border-(--accent) disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        ›
      </button>
    </div>
  );
}
