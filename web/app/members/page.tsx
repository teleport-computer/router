"use client";

import { useState, useEffect } from "react";
import { getTeamMembers, deleteTeamMember, setMemberAdmin, type MemberWithActivity } from "@/lib/api";
import Loading from "../components/Loading";
import ConfirmDialog from "../components/ConfirmDialog";
import { useT } from "@/lib/i18n";

const ROLE_STYLES: Record<string, string> = {
  frontend: "bg-sky-500/10 text-sky-500 ring-sky-500/30",
  backend: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/30",
  design: "bg-violet-500/10 text-violet-500 ring-violet-500/30",
  pm: "bg-amber-500/10 text-amber-500 ring-amber-500/30",
  infra: "bg-(--tag-bg) text-(--muted) ring-(--card-border)",
};

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
    if (days < 30) return t("timeAgo.days", { n: days });
    return new Date(ts).toLocaleDateString();
  };
}

export default function MembersPage() {
  const t = useT();
  const timeAgo = useTimeAgo();
  const [key, setKey] = useState("");
  const [members, setMembers] = useState<MemberWithActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentHandle, setCurrentHandle] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<{ handle: string; displayName?: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [confirmAdminToggle, setConfirmAdminToggle] = useState<{ handle: string; displayName?: string; nextIsAdmin: boolean } | null>(null);
  const [togglingAdmin, setTogglingAdmin] = useState(false);
  // null = checking; Lark re-login uses cookie session, so localStorage `router_key`
  // is NOT a reliable login signal. Treat /api/me as the source of truth.
  const [authed, setAuthed] = useState<boolean | null>(null);

  const adminCount = members.filter(m => m.isAdmin).length;

  useEffect(() => {
    const savedKey = localStorage.getItem("router_key") || "";
    setKey(savedKey);
    const keyQuery = savedKey ? `?key=${savedKey}` : "";
    fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/me${keyQuery}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setAuthed(true);
          setIsAdmin(!!d.isAdmin);
          setCurrentHandle(d.handle || "");
          getTeamMembers(savedKey)
            .then(setMembers)
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
        } else {
          setAuthed(false);
          setLoading(false);
        }
      })
      .catch(() => { setAuthed(false); setLoading(false); });
  }, []);

  const handleRemove = async () => {
    if (!confirmRemove) return;
    setRemoving(true);
    setError("");
    try {
      await deleteTeamMember(key, confirmRemove.handle);
      setMembers(m => m.filter(x => x.handle !== confirmRemove.handle));
      setConfirmRemove(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRemoving(false);
    }
  };

  const handleToggleAdmin = async () => {
    if (!confirmAdminToggle) return;
    setTogglingAdmin(true);
    setError("");
    try {
      await setMemberAdmin(key, confirmAdminToggle.handle, confirmAdminToggle.nextIsAdmin);
      setMembers(m => m.map(x =>
        x.handle === confirmAdminToggle.handle ? { ...x, isAdmin: confirmAdminToggle.nextIsAdmin } : x
      ));
      setConfirmAdminToggle(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTogglingAdmin(false);
    }
  };

  if (authed === null || (authed && loading)) {
    return <div className="flex-1 flex items-center justify-center"><Loading /></div>;
  }

  if (!authed) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-(--muted)">{t("common.notLoggedIn")} <a href="/" className="underline">{t("common.dashboard")}</a></p>
      </div>
    );
  }

  return (
    <div className="fade-up flex-1 max-w-2xl mx-auto w-full px-4 sm:px-5 py-6 sm:py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground italic">{t("members.title")}</h1>
          <p className="text-[13px] text-(--muted-light) mt-0.5">
            {members.length} {members.length === 1 ? t("members.personSingular") : t("members.personPlural")}
          </p>
        </div>
        <a href="/" className="text-[12px] text-(--muted) hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-(--accent-light) transition-all">{t("common.dashboard")}</a>
      </div>

      {error && <div className="mb-4 p-3 bg-red-500/10 text-red-500 text-[12px] rounded-xl">{error}</div>}

      {members.length === 1 ? (
        <div className="text-center py-24">
          <p className="text-sm text-(--muted)">{t("members.onlyOneHere")}</p>
          <p className="text-xs text-(--muted-light) mt-1">{t("members.inviteFromSettingsBefore")} <a href="/settings" className="underline">{t("members.settingsLink")}</a>.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {members.map((m) => (
            <div key={m.handle} className="bg-(--card) rounded-2xl border border-(--card-border) p-5 relative">
              {isAdmin && m.handle !== currentHandle && (
                <div className="absolute top-4 right-4 flex items-center gap-1">
                  {m.isAdmin ? (
                    <button
                      onClick={() => setConfirmAdminToggle({ handle: m.handle, displayName: m.displayName, nextIsAdmin: false })}
                      disabled={adminCount <= 1}
                      title={adminCount <= 1 ? t("members.lastAdminHint") : undefined}
                      className="cursor-pointer text-[11px] text-(--muted) hover:text-foreground px-2 py-1 rounded-md hover:bg-(--accent-light) transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                      {t("members.demoteAdmin")}
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmAdminToggle({ handle: m.handle, displayName: m.displayName, nextIsAdmin: true })}
                      className="cursor-pointer text-[11px] text-amber-600 hover:text-amber-700 px-2 py-1 rounded-md hover:bg-amber-50 transition-colors">
                      {t("members.promoteAdmin")}
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmRemove({ handle: m.handle, displayName: m.displayName })}
                    className="cursor-pointer text-[11px] text-red-400 hover:text-red-600 px-2 py-1 rounded-md hover:bg-red-50 transition-colors">
                    {t("members.removeMember")}
                  </button>
                </div>
              )}
              <button
                onClick={() => window.location.href = `/profile?handle=${m.handle}`}
                className="cursor-pointer flex items-start gap-3 w-full text-left mb-3 group">
                {m.larkBinding?.avatarUrl ? (
                  <img
                    src={m.larkBinding.avatarUrl}
                    alt={m.larkBinding.name || m.displayName || m.handle}
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-(--tag-bg) flex items-center justify-center text-sm font-semibold text-(--muted) shrink-0">
                    {(m.displayName || m.handle)[0].toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-semibold text-foreground group-hover:opacity-70 transition-opacity">
                      {m.displayName || `@${m.handle}`}
                    </span>
                    {m.displayName && (
                      <span className="text-[11px] text-(--muted-light)">@{m.handle}</span>
                    )}
                    {m.larkBinding?.name && m.larkBinding.name !== m.displayName && (
                      <span className="text-[11px] font-medium px-1.5 py-0.5 bg-blue-500/10 text-blue-500 rounded ring-1 ring-inset ring-blue-500/30">
                        Lark: {m.larkBinding.name}
                      </span>
                    )}
                    {m.role && (
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset ${ROLE_STYLES[m.role] || "bg-(--tag-bg) text-(--muted) ring-(--card-border)"}`}>
                        {m.role}
                      </span>
                    )}
                    {m.isAdmin && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 bg-amber-500/10 text-amber-500 rounded">{t("members.adminBadge")}</span>
                    )}
                  </div>
                  <p className="text-[12px] text-(--muted) mt-1">
                    {m.bio || <span className="text-(--muted-light)">{t("members.noBioYet")}</span>}
                  </p>
                </div>
              </button>

              <div className="border-t border-(--card-border) pt-3">
                <p className="text-[11px] font-medium text-(--muted-light) mb-2">{t("members.recentActivity")}</p>
                {m.recentEntries.length === 0 ? (
                  <p className="text-[12px] text-(--muted-light)">{t("members.noActivity")}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {m.recentEntries.map((e) => (
                      <li key={e.id}>
                        <button
                          onClick={() => window.location.href = `/entry?id=${e.id}`}
                          className="cursor-pointer text-left w-full text-[12px] text-foreground hover:text-(--accent) transition-colors line-clamp-2">
                          {e.summary}
                          <span className="ml-1.5 text-[10px] text-(--muted-light)">{timeAgo(e.timestamp)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmRemove}
        title={t("members.removeConfirmTitle", { handle: confirmRemove?.displayName || confirmRemove?.handle || "" })}
        message={t("members.removeConfirmBody")}
        confirmText={removing ? t("common.loading") : t("members.removeMember")}
        onCancel={() => !removing && setConfirmRemove(null)}
        onConfirm={handleRemove}
      />

      <ConfirmDialog
        open={!!confirmAdminToggle}
        title={confirmAdminToggle?.nextIsAdmin
          ? t("members.promoteConfirmTitle", { handle: confirmAdminToggle.displayName || confirmAdminToggle.handle })
          : t("members.demoteConfirmTitle", { handle: confirmAdminToggle?.displayName || confirmAdminToggle?.handle || "" })}
        message={confirmAdminToggle?.nextIsAdmin
          ? t("members.promoteConfirmBody")
          : t("members.demoteConfirmBody")}
        confirmText={togglingAdmin
          ? t("common.loading")
          : (confirmAdminToggle?.nextIsAdmin ? t("members.promoteAdmin") : t("members.demoteAdmin"))}
        danger={!confirmAdminToggle?.nextIsAdmin}
        onCancel={() => !togglingAdmin && setConfirmAdminToggle(null)}
        onConfirm={handleToggleAdmin}
      />
    </div>
  );
}
