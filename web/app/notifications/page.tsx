"use client";

import { useState, useEffect } from "react";
import { getNotifications, markAllRead, markNotificationRead, type NotificationItem } from "@/lib/api";
import { displayHandle } from "@/lib/display";
import Loading from "../components/Loading";
import { useT } from "@/lib/i18n";

function useTimeAgo() {
  const t = useT();
  return (ts: number): string => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("timeAgo.justNow");
    if (mins < 60) return t("timeAgo.minutes", { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("timeAgo.hours", { n: hours });
    const days = Math.floor(hours / 24);
    return t("timeAgo.days", { n: days });
  };
}

export default function NotificationsPage() {
  const t = useT();
  const timeAgo = useTimeAgo();
  const TYPE_LABELS: Record<string, string> = {
    mention: t("notifications.mentionedYou"),
    comment: t("notifications.commentedYou"),
    reply: t("notifications.repliedYou"),
    // Both the legacy 'digest' (daily) type and the new 'weekly_brief' type
    // surface as "weekly brief" in the inbox — old rows keep their type column
    // value, but UI doesn't distinguish them.
    digest: t("notifications.weeklyBrief"),
    weekly_brief: t("notifications.weeklyBrief"),
  };
  const [key, setKey] = useState("");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  // null = checking; true = ?key= or cookie session valid; false = neither.
  // Lark re-login users have a cookie but no router_key, so localStorage
  // alone is not a reliable login signal.
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const savedKey = localStorage.getItem("router_key") || "";
    setKey(savedKey);
    const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
    const keyQuery = savedKey ? `?key=${savedKey}` : "";
    fetch(`${API_URL}/api/me${keyQuery}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setAuthed(true);
          loadNotifications(savedKey);
        } else {
          setAuthed(false);
          setLoading(false);
        }
      })
      .catch(() => { setAuthed(false); setLoading(false); });
  }, []);

  const loadNotifications = async (k: string) => {
    setLoading(true);
    const data = await getNotifications(k);
    setNotifications(data.notifications);
    setLoading(false);
  };

  const handleMarkAllRead = async () => {
    await markAllRead(key);
    setNotifications(notifications.map(n => ({ ...n, read: true })));
  };

  const handleClick = async (n: NotificationItem) => {
    if (!n.read) {
      await markNotificationRead(key, n.id);
      setNotifications(notifications.map(x => x.id === n.id ? { ...x, read: true } : x));
    }
    // Only entry-bound notifications have a target page; admin-status
    // notifications just mark as read and stay on this page.
    if (n.entryId) {
      window.location.href = `/entry?id=${n.entryId}`;
    }
  };

  if (authed === null) {
    return <Loading className="py-24" />;
  }

  if (!authed) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-neutral-400">{t("common.notLoggedIn")} <a href="/" className="underline">{t("common.dashboard")}</a></p>
      </div>
    );
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="fade-up flex-1 max-w-2xl mx-auto w-full px-4 sm:px-5 py-6 sm:py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground italic">{t("notifications.title")}</h1>
          {unreadCount > 0 && (
            <p className="text-[13px] text-neutral-400 mt-0.5">{t("notifications.unreadCount", { n: unreadCount })}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button onClick={handleMarkAllRead}
              className="text-[12px] text-neutral-500 hover:text-neutral-700 px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 transition-all">
              {t("notifications.markAllRead")}
            </button>
          )}
          <a href="/members" className="text-[12px] text-neutral-500 hover:text-neutral-700 px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 transition-all">{t("nav.members")}</a>
          <a href="/" className="text-[12px] text-neutral-500 hover:text-neutral-700 px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 transition-all">{t("common.dashboard")}</a>
        </div>
      </div>

      {loading ? (
        <Loading className="py-24" />
      ) : notifications.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-sm text-neutral-400">{t("notifications.emptyShort")}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {notifications.map((n) => (
            <button key={n.id} onClick={() => handleClick(n)}
              className={`w-full text-left p-4 rounded-xl border transition-all ${
                n.read
                  ? "bg-white border-neutral-100 hover:border-neutral-200"
                  : "bg-blue-50/50 border-blue-100 hover:border-blue-200"
              }`}>
              <div className="flex items-start gap-3">
                {!n.read && <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-neutral-700">
                    <strong>{displayHandle(n.fromHandle)}</strong>{" "}
                    <span className="text-neutral-500">{TYPE_LABELS[n.type] || n.type}</span>
                  </p>
                  <p className="text-[12px] text-neutral-400 mt-0.5 truncate">{n.preview}</p>
                  <p className="text-[11px] text-neutral-400 mt-1">{timeAgo(n.timestamp)}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
