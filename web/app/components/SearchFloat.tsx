"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

export default function SearchFloat({
  onSearch,
  onAuthorSearch,
  onClear,
  hasActiveFilter,
}: {
  onSearch: (query: string) => void;
  onAuthorSearch: (handle: string) => void;
  onClear: () => void;
  hasActiveFilter?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const handleSubmit = () => {
    const q = query.trim();
    if (!q) return;
    if (q.startsWith("@")) {
      const handle = q.slice(1).trim();
      if (handle) { onAuthorSearch(handle); setOpen(false); setQuery(""); }
      return;
    }
    onSearch(q);
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      {/* Backdrop — mobile only when open */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm sm:hidden animate-in fade-in duration-150" onClick={() => { setOpen(false); setQuery(""); }} />
      )}

      <div className={`fixed z-50 ${open
        ? 'inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-8 sm:right-8'
        : 'bottom-6 right-4 sm:bottom-8 sm:right-8'
      }`}>
        {open ? (
          <div ref={popRef} className="bg-(--card) rounded-t-2xl sm:rounded-2xl shadow-2xl border-t sm:border border-(--card-border) p-5 sm:w-80 animate-in slide-in-from-bottom duration-200">
            {/* Drag handle — mobile */}
            <div className="w-10 h-1 rounded-full bg-(--card-border) mx-auto mb-4 sm:hidden" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
                if (e.key === "Escape") { setOpen(false); setQuery(""); }
              }}
              placeholder={t("search.placeholder")}
              className="w-full text-sm px-4 py-3 sm:py-2.5 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) placeholder:text-(--muted-light) transition-all"
            />
            <p className="text-[11px] text-(--muted-light) mt-3 leading-relaxed">
              {t("search.hintPrefix")} <span className="font-medium text-(--muted)">{t("search.hintAtHandle")}</span> {t("search.hintSuffix")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-2">
            {hasActiveFilter && (
              <button onClick={onClear}
                className="h-8 px-3 rounded-full bg-(--card) border border-(--card-border) text-(--muted) shadow-md hover:border-(--accent) transition-all text-[11px] font-medium">
                {t("search.clearFilter")}
              </button>
            )}
            <button onClick={() => setOpen(true)}
              className="w-12 h-12 rounded-full bg-(--accent) text-white shadow-lg hover:shadow-xl hover:bg-(--accent-hover) transition-all flex items-center justify-center cursor-pointer"
              title={t("search.buttonTitle")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
