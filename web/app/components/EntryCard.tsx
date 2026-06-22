"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RouterEntry, CommentItem } from "@/lib/api";
import { toggleBookmark } from "@/lib/api";
import { displayHandle, isDeletedHandle } from "@/lib/display";
import ConfirmDialog from "./ConfirmDialog";
import Toast from "./Toast";
import { useI18n } from "@/lib/i18n";

// Shared markdown config:
// - Only explicit [text](url) markdown links render as clickable. Bare URLs
//   stay as plain text — the team explicitly wants this (prevents accidental
//   link-ification of things that happen to look like URLs).
// - External links open in a new tab so clicking one doesn't blow away the
//   dashboard's scroll / filter state.
const MD_COMPONENTS: Components = {
  a: ({ node: _node, href, children, ...rest }) => {
    const url = href || '';
    const isInternal = url.startsWith('/') || url.startsWith('#');
    return (
      <a
        href={url}
        target={isInternal ? undefined : '_blank'}
        rel={isInternal ? undefined : 'noopener noreferrer'}
        {...rest}
      >
        {children}
      </a>
    );
  },
  // GFM tables — wrap in a scrollable container so wide tables don't blow up
  // the card, and style cells to match the rest of the UI.
  table: ({ node: _node, children, ...rest }) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-[12px] border-collapse" {...rest}>
        {children}
      </table>
    </div>
  ),
  thead: ({ node: _node, children, ...rest }) => (
    <thead className="bg-(--tag-bg)" {...rest}>
      {children}
    </thead>
  ),
  th: ({ node: _node, children, ...rest }) => (
    <th className="border border-(--card-border) px-2 py-1 text-left font-medium" {...rest}>
      {children}
    </th>
  ),
  td: ({ node: _node, children, ...rest }) => (
    <td className="border border-(--card-border) px-2 py-1 align-top" {...rest}>
      {children}
    </td>
  ),
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 6) return `${hours}h ago`;
  // After 6 hours, switch to absolute time — the "8h ago / 19h ago" display
  // loses usefulness past mid-afternoon and users would rather see the clock.
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hh}:${mm}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (sameYear) return `${mon}-${day} ${hh}:${mm}`;
  return `${d.getFullYear()}-${mon}-${day}`;
}

const ROLE_STYLES: Record<string, string> = {
  frontend: "bg-sky-500/10 text-sky-500 ring-sky-500/30",
  backend: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/30",
  design: "bg-violet-500/10 text-violet-500 ring-violet-500/30",
  pm: "bg-amber-500/10 text-amber-500 ring-amber-500/30",
  infra: "bg-(--tag-bg) text-(--muted) ring-(--card-border)",
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

// Auth-aware fetch: appends ?key= if localStorage has one, otherwise relies on
// the cookie session (Lark re-login users have a cookie but no router_key).
function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const key = localStorage.getItem("router_key") || "";
  const sep = path.includes("?") ? "&" : "?";
  const url = `${API_URL}${path}${key ? `${sep}key=${key}` : ""}`;
  return fetch(url, { credentials: "include", ...init });
}

// Renders plain text with @handles and URLs turned into clickable elements.
// No markdown — just link detection + mention highlighting.
function CommentText({ text, onAuthorClick }: { text: string; onAuthorClick?: (handle: string) => void }) {
  // Split on @handles and URLs, preserving the delimiters as capture groups.
  const parts = text.split(/((?:https?:\/\/)[^\s<]+|@[a-zA-Z0-9_-]{1,30})/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.match(/^@([a-zA-Z0-9_-]{1,30})$/)) {
          const handle = part.slice(1);
          return (
            <button key={i} onClick={() => onAuthorClick?.(handle)}
              className="font-semibold text-(--accent) hover:underline cursor-pointer">
              {part}
            </button>
          );
        }
        if (part.match(/^https?:\/\//)) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer"
              className="text-(--accent) underline underline-offset-2 break-all hover:opacity-70">
              {part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export default function EntryCard({
  entry,
  currentHandle,
  isAdmin = false,
  onAuthorClick,
  onPublish,
  onDelete,
  isBookmarked,
  compact = false,
}: {
  entry: RouterEntry;
  currentHandle?: string;
  isAdmin?: boolean;
  onAuthorClick?: (handle: string) => void;
  onPublish?: (entryId: string) => void;
  onDelete?: (entryId: string) => void;
  isBookmarked?: boolean;
  compact?: boolean;
}) {
  const { t, lang } = useI18n();
  const isOwner = currentHandle ? entry.handle === currentHandle : false;
  const canManage = isOwner || isAdmin;
  const isDigest = entry.tags.includes('auto:digest');
  const digestSchedule = isDigest
    ? (entry.tags.includes('monthly') ? 'monthly' : 'weekly')
    : null;
  const [bookmarked, setBookmarked] = useState(isBookmarked || false);
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [showEditBox, setShowEditBox] = useState(false);
  const [editSummary, setEditSummary] = useState(entry.summary);
  const [editContent, setEditContent] = useState(entry.content || '');
  const [editTags, setEditTags] = useState(entry.tags.join(', '));
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Local copy mutated by in-card actions (hide toggle, inline edit). When the
  // parent passes a fresh `entry` reference — e.g. after publish-now flips
  // publishAt to null — sync the local copy too, otherwise the pending banner
  // computes from stale local state while the displayed time uses the new prop
  // and renders nonsense like "Publishes in -29637293 min".
  const [entryData, setEntryData] = useState(entry);
  useEffect(() => { setEntryData(entry); }, [entry]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  // Carry larkName/displayName so the dropdown can show a "who is this?"
  // subtitle and so the search matches against natural-name aliases too —
  // not just the canonical handle. See 2026-05-13-at-mention-llm spec.
  const [mentionUsers, setMentionUsers] = useState<Array<{ handle: string; subtitle?: string }>>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [comments, setComments] = useState<CommentItem[]>(entry.comments || []);
  const [copied, setCopied] = useState(false);
  const [copiedContent, setCopiedContent] = useState(false);
  const [shared, setShared] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [editError, setEditError] = useState("");
  const [commentError, setCommentError] = useState("");
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!actionsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [actionsOpen]);
  const [confirmAction, setConfirmAction] = useState<{ type: 'entry' | 'comment'; id: string } | null>(null);
  const isPending = entryData.publishAt && entryData.publishAt > Date.now();

  // Pick the translation matching the user's locale (en or zh) when a cached
  // translation exists. Falls back to the original silently if the translation
  // is still in flight or wasn't generated (same-language source).
  const entryTranslation = entryData.translations?.[lang];

  const handleBookmark = async () => {
    const key = localStorage.getItem("router_key") || "";
    const result = await toggleBookmark(key, entry.id);
    setBookmarked(result);
  };

  const handleToggleHidden = async () => {
    try {
      const res = await authedFetch(`/api/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: !entryData.hidden }),
      });
      if (res.ok) {
        const { entry: updated } = await res.json();
        setEntryData(updated);
      }
    } catch { /* */ }
  };

  const handleSaveEdit = async () => {
    if (!editSummary.trim()) return;
    setSubmitting(true);
    setEditError("");
    try {
      const tags = editTags.split(',').map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
      const res = await authedFetch(`/api/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: editSummary.trim(), content: editContent, tags }),
      });
      if (res.ok) {
        const { entry: updated } = await res.json();
        setEntryData(updated);
        setShowEditBox(false);
      } else {
        setEditError(t('entry.editFailed'));
        setTimeout(() => setEditError(""), 3000);
      }
    } catch {
      setEditError(t('entry.editFailed'));
      setTimeout(() => setEditError(""), 3000);
    }
    setSubmitting(false);
  };

  // Load team members for @mention autocomplete
  const loadMentionUsers = async (query: string) => {
    try {
      const res = await authedFetch(`/api/team`);
      const data = await res.json();
      type RawMember = { handle: string; displayName?: string; larkName?: string };
      const members: RawMember[] = data.members || [];
      const q = query.toLowerCase();
      // Match prefix against handle OR displayName OR larkName (any word).
      // Empty query returns the whole list.
      const filtered = q
        ? members.filter(m => {
            if (m.handle.toLowerCase().startsWith(q)) return true;
            if (m.displayName?.toLowerCase().startsWith(q)) return true;
            if (m.larkName) {
              for (const word of m.larkName.toLowerCase().split(/\s+/)) {
                if (word.startsWith(q)) return true;
              }
            }
            return false;
          })
        : members;
      setMentionUsers(
        filtered.slice(0, 5).map(m => ({
          handle: m.handle,
          subtitle: m.larkName || m.displayName,
        })),
      );
      setMentionIndex(0);
    } catch { /* */ }
  };

  const handleCommentChange = (value: string) => {
    setCommentText(value);
    // Detect @mention
    const cursorPos = value.length; // simplified: assumes cursor at end
    const textBeforeCursor = value.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1]);
      loadMentionUsers(mentionMatch[1]);
    } else {
      setMentionQuery(null);
      setMentionUsers([]);
    }
  };

  const insertMention = (handle: string) => {
    // Replace @partial with @handle
    const newText = commentText.replace(/@(\w*)$/, `@${handle} `);
    setCommentText(newText);
    setMentionQuery(null);
    setMentionUsers([]);
  };

  const handleSubmitComment = async () => {
    if (!commentText.trim()) return;
    setSubmitting(true);
    setCommentError("");
    try {
      const res = await authedFetch(`/api/entries/${entry.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: commentText.trim() }),
      });
      if (res.ok) {
        const { comment } = await res.json();
        setComments([...comments, comment]);
        setCommentText("");
        setShowCommentBox(false);
      } else {
        setCommentError(t('entry.commentFailed'));
        setTimeout(() => setCommentError(""), 3000);
      }
    } catch {
      setCommentError(t('entry.commentFailed'));
      setTimeout(() => setCommentError(""), 3000);
    }
    setSubmitting(false);
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      const res = await authedFetch(`/api/entries/${entry.id}/comments/${commentId}`, { method: "DELETE" });
      if (res.ok) setComments(comments.filter(c => c.id !== commentId));
    } catch { /* */ }
  };

  return (
    <article className={`rounded-2xl border p-4 sm:p-6 transition-all duration-200 ${
      isPending
        ? "bg-(--pending-bg) border-(--pending-border)"
        : isDigest
          ? "bg-(--accent-light) border-(--accent) border-l-4 hover:shadow-sm"
          : "bg-(--card) border-(--card-border) hover:border-(--accent) hover:shadow-sm"
    }`}>
      {/* Pending banner */}
      {isPending && (
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-(--pending-border)">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs font-medium text-(--pending-text)">
              {t('entry.publishesIn', { min: Math.ceil(((entryData.publishAt || 0) - Date.now()) / 60000) })}
            </span>
          </div>
          <div className="flex gap-2">
            {onPublish && (
              <button onClick={() => onPublish(entry.id)}
                className="text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2.5 py-1 rounded-md hover:bg-emerald-50 transition-colors">
                {t('entry.publishNow')}
              </button>
            )}
            {onDelete && (
              <button onClick={() => setConfirmAction({ type: 'entry', id: entry.id })}
                className="text-xs font-medium text-red-500 hover:text-red-600 px-2.5 py-1 rounded-md hover:bg-red-50 transition-colors">
                {t('common.delete')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-full bg-(--tag-bg) flex items-center justify-center text-xs font-semibold text-(--muted) shrink-0">
            {(entry.authorDisplayName || entry.handle)[0].toUpperCase()}
          </div>
          <button onClick={() => onAuthorClick?.(entry.handle)}
            className="flex items-baseline gap-1.5 hover:opacity-70 transition-opacity min-w-0 overflow-hidden">
            <span className="font-semibold text-[13px] text-foreground truncate shrink-0 max-w-30 sm:max-w-none">
              {entry.authorDisplayName || displayHandle(entry.handle)}
            </span>
            {entry.authorDisplayName && !isDeletedHandle(entry.handle) && (
              <span className="text-[11px] text-(--muted-light) hidden sm:inline shrink-0">@{entry.handle}</span>
            )}
          </button>
          {entry.authorRole && (
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset shrink-0 ${ROLE_STYLES[entry.authorRole] || "bg-(--tag-bg) text-(--muted) ring-(--card-border)"}`}>
              {entry.authorRole}
            </span>
          )}
          {isDigest && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset shrink-0 bg-(--accent-light) text-(--accent) ring-(--accent)/30 inline-flex items-center gap-1">
              <span>📊</span>
              <span>{t(digestSchedule === 'monthly' ? 'entry.digestBadgeMonthly' : 'entry.digestBadgeWeekly')}</span>
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] text-(--muted-light)">{timeAgo(entry.timestamp)}</span>
            {/* ··· menu toggle — all actions inside */}
            <div className="relative" ref={actionsRef}>
              <button onClick={() => setActionsOpen(v => !v)}
                className="cursor-pointer p-1.5 rounded-md text-(--muted-light) hover:text-(--muted) hover:bg-(--accent-light) transition-all"
                title={t('entry.actions')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                </svg>
              </button>
              {actionsOpen && (
                <div className="absolute right-0 top-full mt-1 bg-(--card) rounded-xl border border-(--card-border) shadow-xl py-1 min-w-40 w-max z-30 animate-in fade-in slide-in-from-top-1 duration-100">
                  <button onClick={() => { handleBookmark(); setActionsOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-(--muted) hover:text-foreground hover:bg-(--accent-light) transition-all">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill={bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                    {bookmarked ? t('entry.unbookmark') : t('entry.bookmark')}
                  </button>
                  <button onClick={() => { navigator.clipboard.writeText(entry.summary); setCopied(true); setActionsOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-(--muted) hover:text-foreground hover:bg-(--accent-light) transition-all">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    {t('entry.copySummary')}
                  </button>
                  <button onClick={() => {
                    // Match feed rendering: download the translated copy when
                    // the user is reading in English and a translation exists.
                    const text = entryTranslation
                      ? (entryTranslation.content || entryTranslation.summary)
                      : (entry.content || entry.summary).replace(/\\n/g, '\n');
                    const suffix = entryTranslation ? '_translated' : '';
                    const blob = new Blob([text], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `router_${entry.id}${suffix}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                    setActionsOpen(false);
                  }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-(--muted) hover:text-foreground hover:bg-(--accent-light) transition-all">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    {t('entry.download')}
                  </button>
                  {!isPending && (
                    <button onClick={() => {
                      const shareUrl = `${window.location.origin}/entry?id=${entry.id}`;
                      const text = entryData.oneliner ? `${entryData.oneliner} ${shareUrl}` : shareUrl;
                      navigator.clipboard.writeText(text);
                      setShared(true);
                      setActionsOpen(false);
                    }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-(--muted) hover:text-foreground hover:bg-(--accent-light) transition-all">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
                      {t('entry.shareLink')}
                    </button>
                  )}
                  {canManage && (
                    <>
                      <div className="border-t border-(--card-border) my-1" />
                      <button onClick={() => {
                          // Admin editing someone else's entry: confirm first.
                          if (!isOwner && isAdmin) {
                            if (!window.confirm(t('entry.adminEditConfirm', { handle: entry.handle }))) {
                              setActionsOpen(false);
                              return;
                            }
                          }
                          // Re-seed the edit form from the current entry state
                          // each time it opens — ensures we're editing the
                          // latest summary/content, not a stale initial value.
                          if (!showEditBox) {
                            setEditSummary(entryData.summary);
                            setEditContent(entryData.content || '');
                            setEditTags(entryData.tags.join(', '));
                          }
                          setShowEditBox(!showEditBox);
                          setActionsOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-(--muted) hover:text-foreground hover:bg-(--accent-light) transition-all whitespace-nowrap">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        {isOwner ? t('common.edit') : t('entry.adminEdit')}
                      </button>
                      {isOwner && (
                        <button onClick={() => { handleToggleHidden(); setActionsOpen(false); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-(--muted) hover:text-foreground hover:bg-(--accent-light) transition-all">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            {entryData.hidden
                              ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                              : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>
                            }
                          </svg>
                          {entryData.hidden ? t('entry.unhideEntry') : t('entry.hideEntry')}
                        </button>
                      )}
                      <button onClick={() => { setConfirmAction({ type: 'entry', id: entry.id }); setActionsOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-red-400 hover:text-red-500 hover:bg-red-50 transition-all whitespace-nowrap">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        {isOwner ? t('common.delete') : t('entry.adminDelete')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Hidden badge */}
      {entryData.hidden && (
        <div className="flex items-center gap-1.5 mb-3 text-xs text-amber-600">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
          <span className="font-medium">{t('entry.hiddenBadge')}</span>
        </div>
      )}

      {/* Edit form */}
      {showEditBox ? (
        <div className="mb-4 space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-(--muted) mb-1">{t('entry.editSummaryLabel')}</label>
            <textarea value={editSummary} onChange={(e) => setEditSummary(e.target.value)}
              rows={3}
              className="w-full text-[13px] px-3.5 py-2.5 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) resize-none transition-all" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-(--muted) mb-1">
              {t('entry.editContentLabel')} <span className="text-(--muted-light)">{t('entry.editContentHint')}</span>
            </label>
            <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)}
              rows={8}
              placeholder={t('entry.editContentPlaceholder')}
              className="w-full text-[13px] px-3.5 py-2.5 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) resize-y transition-all font-mono placeholder:text-(--muted-light)" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-(--muted) mb-1">{t('entry.editTagsLabel')}</label>
            <input type="text" value={editTags} onChange={(e) => setEditTags(e.target.value)}
              placeholder={t('entry.editTagsPlaceholder')}
              className="w-full text-[13px] px-3.5 py-2.5 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) transition-all" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => {
                setShowEditBox(false);
                setEditSummary(entryData.summary);
                setEditContent(entryData.content || '');
                setEditTags(entryData.tags.join(', '));
              }}
              className="text-xs text-(--muted-light) hover:text-(--muted) px-3 py-1.5 rounded-lg hover:bg-(--accent-light) transition-colors">
              {t('common.cancel')}
            </button>
            <button onClick={handleSaveEdit} disabled={!editSummary.trim() || submitting}
              className="text-xs font-medium bg-(--accent) text-white px-4 py-1.5 rounded-lg hover:bg-(--accent-hover) disabled:opacity-40 transition-colors">
              {submitting ? t('entry.saving') : t('common.save')}
            </button>
          </div>
          {editError && <p className="text-xs text-red-500 mt-2">{editError}</p>}
        </div>
      ) : (
        <>
          {/* Body — preview by default, full content when expanded.
              Both paths render markdown. "Show full" just swaps which text
              block is passed into <Markdown>, so the expand action is
              in-place (no navigation, no separate details element). */}
          {(() => {
            // Summary is plain text — just escape newlines so multi-line
            // summaries wrap properly but no markdown syntax is interpreted.
            // Content (shown on expand) renders as markdown.
            const summaryText = entryTranslation
              ? entryTranslation.summary
              : entryData.summary.replace(/\\n/g, '\n');
            const contentText = entryTranslation
              ? (entryTranslation.content || entryTranslation.summary)
              : (entryData.content || entryData.summary).replace(/\\n/g, '\n');
            const hasMore = !compact && contentText !== summaryText;
            return (
              <>
                <div
                  onClick={hasMore ? () => setExpanded(v => !v) : undefined}
                  className={`group/summary relative text-[16px] leading-[1.8] text-foreground mb-3 whitespace-pre-wrap ${hasMore ? 'cursor-pointer select-text' : ''}`}
                >
                  {summaryText}
                  {hasMore && (
                    <span className="ml-2 text-[11px] text-(--muted-light) opacity-0 group-hover/summary:opacity-100 transition-opacity select-none">
                      {expanded ? t('entry.hide') : t('entry.showFullContent')}
                    </span>
                  )}
                </div>
                {hasMore && expanded && (
                  <div className="mt-3 pt-3 border-t border-(--card-border) text-[16px] leading-[1.8] text-foreground prose prose-base max-w-none mb-3">
                    <Markdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{contentText}</Markdown>
                  </div>
                )}
                {(hasMore || !compact) && (
                  <div className="flex items-center gap-3 mb-4">
                    {hasMore && (
                    <button
                      onClick={() => setExpanded(v => !v)}
                      className="cursor-pointer text-xs text-(--muted) hover:text-(--accent) transition-colors select-none">
                      {expanded ? `▴ ${t('entry.hide')}` : `▾ ${t('entry.showFullContent')}`}
                    </button>
                    )}
                    {expanded && (
                      <>
                        <button
                          onClick={() => { navigator.clipboard.writeText(contentText); setCopiedContent(true); setTimeout(() => setCopiedContent(false), 2000); }}
                          className="cursor-pointer text-xs text-(--muted) hover:text-(--accent) transition-colors select-none flex items-center gap-1">
                          {copiedContent ? (
                            <span>✓</span>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                          )}
                          {copiedContent ? t('common.copied') : t('common.copy')}
                        </button>
                        <button
                          onClick={() => {
                            const blob = new Blob([contentText], { type: 'text/markdown' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `router_${entry.id}.md`;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="cursor-pointer text-xs text-(--muted-light) hover:text-(--muted) transition-colors select-none flex items-center gap-1">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                          {t('entry.download')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}

      {/* Tags + comment — every tag chip is a link to /tags/[tag]. To filter
          the feed by a tag, use the TagBar at the top of the homepage or pass
          ?tags=foo in the URL. Pre-migration entries that lived in the legacy
          entries.channel column have been backfilled into entries.tags by the
          tag-unification migration, so the value surfaces here as a regular tag. */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5 min-w-0">
          {entryData.tags.map((tag) => (
            <Link key={tag} href={`/tags/${encodeURIComponent(tag)}`}
              className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-(--tag-bg) text-(--tag-text) hover:opacity-80 transition-opacity">
              #{tag}
            </Link>
          ))}
        </div>
        <button onClick={() => setShowCommentBox(!showCommentBox)}
          className="cursor-pointer text-[11px] text-(--muted) hover:text-(--accent) transition-colors shrink-0 py-1">
          {showCommentBox ? t('common.cancel') : `${t('entry.comment')}${comments.length > 0 ? ` (${comments.length})` : ""}`}
        </button>
      </div>

      {/* Comments */}
      {comments.length > 0 && (
        <div className="mt-4 pt-4 border-t border-(--card-border) space-y-3">
          {comments.map((c) => {
            const displayed = c.translations?.[lang] || c.content;
            return (
            <div key={c.id} id={`comment-${c.id}`} className="group pl-4 py-2 border-l-2 border-(--card-border) hover:border-(--accent) transition-colors">
              <div className="flex items-center gap-2">
                {isDeletedHandle(c.handle) ? (
                  <span className="font-semibold text-[12px] text-(--muted-light) italic">(deleted user)</span>
                ) : (
                  <button onClick={() => onAuthorClick?.(c.handle)} className="cursor-pointer font-semibold text-[12px] text-foreground hover:text-(--accent) transition-colors">
                    @{c.handle}
                  </button>
                )}
                <span className="text-[11px] text-(--muted-light)">{timeAgo(c.timestamp)}</span>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => setConfirmAction({ type: 'comment', id: c.id })}
                    className="cursor-pointer text-[11px] text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all">
                    {t('common.delete')}
                  </button>
                </div>
              </div>
              <div className="text-[13px] text-foreground mt-1.5 max-w-none leading-relaxed whitespace-pre-wrap">
                <CommentText text={displayed} onAuthorClick={onAuthorClick} />
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Comment box */}
      {showCommentBox && (
        <div className="mt-4 pt-4 border-t border-(--card-border)">
          <div className="relative">
            <textarea autoFocus value={commentText}
              onChange={(e) => handleCommentChange(e.target.value)}
              onKeyDown={(e) => {
                if (mentionQuery !== null && mentionUsers.length > 0) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i: number) => Math.min(i + 1, mentionUsers.length - 1)); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
                  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(mentionUsers[mentionIndex].handle); return; }
                  if (e.key === "Escape") { setMentionQuery(null); setMentionUsers([]); return; }
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmitComment();
              }}
              placeholder={t('entry.commentPlaceholder')}
              rows={2}
              className="w-full text-[13px] px-3.5 py-2.5 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) resize-none placeholder:text-(--muted-light) transition-all" />

            {/* @mention autocomplete dropdown */}
            {mentionQuery !== null && mentionUsers.length > 0 && (
              <div className="absolute bottom-full left-0 mb-1 bg-(--card) rounded-xl border border-(--card-border) shadow-lg overflow-hidden w-56 z-10">
                {mentionUsers.map((m, i) => (
                  <button key={m.handle}
                    onClick={() => insertMention(m.handle)}
                    className={`w-full text-left px-3 py-2 text-[12px] transition-colors ${
                      i === mentionIndex ? "bg-(--accent-light) text-foreground" : "text-(--muted) hover:bg-background"
                    }`}>
                    <div>@{m.handle}</div>
                    {m.subtitle && (
                      <div className="text-[11px] text-(--muted-light) truncate">{m.subtitle}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-2.5">
            <button onClick={() => { setShowCommentBox(false); setCommentText(""); setMentionQuery(null); }}
              className="cursor-pointer text-xs text-(--muted) hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-(--accent-light) transition-colors">
              {t('common.cancel')}
            </button>
            <button onClick={handleSubmitComment} disabled={!commentText.trim() || submitting}
              className="cursor-pointer text-xs font-medium bg-(--accent) text-white px-4 py-1.5 rounded-lg hover:bg-(--accent-hover) disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {submitting ? t('entry.sending') : t('entry.comment')}
            </button>
          </div>
          {commentError && <p className="text-xs text-red-500 mt-2">{commentError}</p>}
        </div>
      )}
      <Toast message={t('entry.copyLinkToast')} open={copied} onClose={() => setCopied(false)} />
      <Toast message={t('entry.shareLinkToast')} open={shared} onClose={() => setShared(false)} />

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.type === 'entry'
          ? (!isOwner && isAdmin ? t('entry.adminDeleteConfirmTitle', { handle: entry.handle }) : t('entry.deleteConfirmTitle'))
          : t('entry.deleteCommentTitle')}
        message={confirmAction?.type === 'entry'
          ? (!isOwner && isAdmin ? t('entry.adminDeleteConfirmBody', { handle: entry.handle }) : t('entry.deleteConfirmBody'))
          : t('entry.deleteCommentBody')}
        onConfirm={() => {
          if (confirmAction?.type === 'entry') onDelete?.(confirmAction.id);
          if (confirmAction?.type === 'comment') handleDeleteComment(confirmAction.id);
          setConfirmAction(null);
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </article>
  );
}
