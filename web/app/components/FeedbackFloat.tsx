"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export default function FeedbackFloat() {
  const t = useT();
  const CATEGORIES = [
    { value: "bug", label: t("feedback.categoryBug") },
    { value: "idea", label: t("feedback.categoryIdea") },
    { value: "ux", label: t("feedback.categoryUX") },
    { value: "other", label: t("feedback.categoryOther") },
  ];
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("idea");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const submit = async () => {
    const text = content.trim();
    if (!text) return;
    setError("");
    setSubmitting(true);
    try {
      const page = typeof window !== "undefined"
        ? window.location.pathname.replace(/^\//, "").replace(/\//g, "-") || "home"
        : "";
      const key = localStorage.getItem("router_key") || "";
      const res = await fetch(`${API_URL}/api/feedback${key ? `?key=${key}` : ""}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, category, page }),
      });
      if (res.status === 401) {
        setError(t("feedback.loginFirst"));
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t("feedback.submitFailed"));
      }
      setSubmitted(true);
      setContent("");
      setTimeout(() => {
        setSubmitted(false);
        setOpen(false);
      }, 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("feedback.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Backdrop — mobile only */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm sm:hidden animate-in fade-in duration-150" onClick={() => setOpen(false)} />
      )}

      <div className={`fixed ${open
        ? 'z-50 inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-8 sm:right-24'
        : 'z-40 bottom-6 right-18 sm:bottom-8 sm:right-24'
      }`}>
        {open ? (
          <div ref={popRef} className="bg-(--card) rounded-t-2xl sm:rounded-2xl shadow-2xl border-t sm:border border-(--card-border) p-5 sm:w-96 animate-in slide-in-from-bottom duration-200">
            {/* Drag handle — mobile */}
            <div className="w-10 h-1 rounded-full bg-(--card-border) mx-auto mb-4 sm:hidden" />

            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">{t("feedback.title")}</h3>
              <button onClick={() => setOpen(false)} aria-label={t("feedback.closeAria")} className="cursor-pointer text-(--muted-light) hover:text-foreground text-xs">✕</button>
            </div>

            <div className="flex gap-1.5 mb-3">
              {CATEGORIES.map(c => (
                <button key={c.value}
                  onClick={() => setCategory(c.value)}
                  className={`cursor-pointer text-[11px] px-2.5 py-1.5 rounded-lg transition-colors ${
                    category === c.value
                      ? "bg-(--accent) text-white"
                      : "bg-(--tag-bg) text-(--muted) hover:bg-(--accent-light)"
                  }`}>
                  {c.label}
                </button>
              ))}
            </div>

            <textarea
              autoFocus
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder={t("feedback.placeholder")}
              rows={4}
              className="w-full text-sm px-3 py-3 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) placeholder:text-(--muted-light) resize-none"
            />

            {error && <p className="text-[11px] text-red-500 mt-2">{error}</p>}

            <div className="flex items-center justify-between mt-3">
              <p className="text-[11px] text-(--muted-light)">
                {t("feedback.sentToFeedback")}
              </p>
              <button
                onClick={submit}
                disabled={!content.trim() || submitting || submitted}
                className="cursor-pointer text-xs font-medium bg-(--accent) text-white px-4 py-2 rounded-lg hover:bg-(--accent-hover) disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {submitted ? t("feedback.sentShort") : submitting ? t("feedback.sendingShort") : t("feedback.submitBtn")}
              </button>
            </div>
          </div>
      ) : (
        <button onClick={() => setOpen(true)}
          className="w-12 h-12 rounded-full bg-(--card) border border-(--card-border) text-(--muted) shadow-lg hover:shadow-xl hover:border-(--accent) hover:text-foreground transition-all flex items-center justify-center cursor-pointer"
          title={t("feedback.buttonTitle")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}
      </div>
    </>
  );
}
