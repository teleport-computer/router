"use client";

import { useState, useEffect } from "react";
import { MCP_SKILL_INSTRUCTIONS, ROUTER_PERSONAL_TEMPLATE } from "@/lib/mcp-instructions";
import { useI18n } from "@/lib/i18n";
import { useServerInfo } from "@/lib/server-info";
import { rotateMcpCredential, larkAuthorize, larkUnbind, verifyMyKey, getNotificationPrefs, updateNotificationPrefs, type NotificationPrefs } from "@/lib/api";
import { useCliInstallCommand } from "@/lib/cli-install-command";
import Loading from "../components/Loading";
import ConfirmDialog from "../components/ConfirmDialog";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface LarkBinding {
  openId: string;
  name?: string;
  avatarUrl?: string;
  boundAt?: number;
  scopes?: string[];
}

interface UserInfo {
  handle: string;
  teamId: string;
  displayName?: string;
  bio?: string;
  email?: string;
  role?: string;
  isAdmin?: boolean;
  stagingDelayMs?: number;
  larkBinding?: LarkBinding;
}

export default function SettingsPage() {
  const { lang, setLang, t } = useI18n();
  const { features } = useServerInfo();
  const cliInstall = useCliInstallCommand();

  const DELAY_OPTIONS = [
    { label: t("settings.delayNone"), value: 0 },
    { label: t("settings.delay2min"), value: 2 * 60 * 1000 },
    { label: t("settings.delay15min"), value: 15 * 60 * 1000 },
    { label: t("settings.delay1h"), value: 60 * 60 * 1000 },
    { label: t("settings.delay4h"), value: 4 * 60 * 60 * 1000 },
    { label: t("settings.delay12h"), value: 12 * 60 * 60 * 1000 },
    { label: t("settings.delay1d"), value: 24 * 60 * 60 * 1000 },
  ];

  const [key, setKey] = useState("");
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedProfile, setSavedProfile] = useState(false);
  const [savedDelay, setSavedDelay] = useState(false);
  const [copied, setCopied] = useState("");
  const [connectTab, setConnectTab] = useState<"code" | "desktop" | "codex" | "cursor" | "others">("code");
  const [newMcpKey, setNewMcpKey] = useState("");
  const [mcpBusy, setMcpBusy] = useState(false);
  const [larkBusy, setLarkBusy] = useState(false);
  const [larkToast, setLarkToast] = useState<string | null>(null);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [pastedKey, setPastedKey] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteResult, setPasteResult] = useState<"" | "ok" | "wrong" | "error">("");
  const [larkPrefs, setLarkPrefs] = useState<NotificationPrefs | null>(null);
  const [larkPrefsBusy, setLarkPrefsBusy] = useState(false);

  // Form fields
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [stagingDelay, setStagingDelay] = useState(15 * 60 * 1000);
  const [notificationWebhook, setNotificationWebhook] = useState("");
  const [savedWebhook, setSavedWebhook] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    // M2a.5: cookie session also valid
    const savedKey = localStorage.getItem("router_key") || "";
    setKey(savedKey);
    const keyQuery = savedKey ? `?key=${savedKey}` : "";

    fetch(`${API_URL}/api/me${keyQuery}`, { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        if (data.handle) {
          setUser(data);
          setDisplayName(data.displayName || "");
          setBio(data.bio || "");
          setEmail(data.email || "");
          setRole(data.role || "");
          setStagingDelay(data.stagingDelayMs ?? 15 * 60 * 1000);
          setNotificationWebhook(data.notificationWebhook || "");
          // Sync server-stored language preference. IMPORTANT: read
          // localStorage directly instead of the closed-over `lang` state,
          // which still holds the initial DEFAULT_LANG at this point —
          // the Provider's own localStorage-loading effect may not have
          // fired yet, and the stale closure would clobber the user's
          // choice with the default.
          if (data.lang === 'en' || data.lang === 'zh') {
            setLang(data.lang);
          } else {
            const local = (() => {
              try { return localStorage.getItem('router_lang'); } catch { return null; }
            })();
            if (local === 'en' || local === 'zh') setLang(local);
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Lark IM notification preferences (independent of profile load — endpoint
    // is always available; returns larkBound:false when not bound).
    getNotificationPrefs()
      .then(setLarkPrefs)
      .catch(() => { /* silent — endpoint may be unavailable on lark-less deployments */ });

    // Handle Lark callback redirect query params (when /settings is the
    // redirect target after bind/unbind flows from this page)
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const err = params.get("error");
    if (status === "success") {
      setLarkToast(t("lark.settings.bindSuccess"));
      window.history.replaceState({}, "", "/settings");
    } else if (err === "conflict") {
      setLarkToast(t("lark.settings.bindConflict"));
      window.history.replaceState({}, "", "/settings");
    } else if (err === "user_denied") {
      setLarkToast(t("lark.settings.userDenied"));
      window.history.replaceState({}, "", "/settings");
    } else if (err) {
      const detail = params.get("detail");
      setLarkToast(detail ? t("lark.settings.bindGenericFailDetail", { error: err, detail }) : t("lark.settings.bindGenericFail", { error: err }));
      window.history.replaceState({}, "", "/settings");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading) return;
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    const targetId = hash === "#connect" ? "connect-claude" : hash.slice(1);
    if (targetId) {
      const el = document.getElementById(targetId);
      if (el) {
        requestAnimationFrame(() => {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    }
  }, [loading]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  };

  const saveProfile = async () => {
    setSaveError("");
    try {
      const res = await fetch(`${API_URL}/api/users/me${key ? `?key=${key}` : ""}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName || undefined,
          bio: bio || undefined,
          email: email || undefined,
          role: role || undefined,
        }),
      });
      if (res.ok) {
        setSavedProfile(true);
        setTimeout(() => setSavedProfile(false), 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || t("common.saveFailed"));
        setTimeout(() => setSaveError(""), 3000);
      }
    } catch {
      setSaveError(t("common.saveFailed"));
      setTimeout(() => setSaveError(""), 3000);
    }
  };

  const saveNotificationWebhook = async () => {
    setSaveError("");
    try {
      const res = await fetch(`${API_URL}/api/users/me${key ? `?key=${key}` : ""}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationWebhook: notificationWebhook.trim() }),
      });
      if (res.ok) {
        setSavedWebhook(true);
        setTimeout(() => setSavedWebhook(false), 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || t("common.saveFailed"));
        setTimeout(() => setSaveError(""), 3000);
      }
    } catch {
      setSaveError(t("common.saveFailed"));
      setTimeout(() => setSaveError(""), 3000);
    }
  };

  const saveLarkPref = async (k: 'mention' | 'comment' | 'reply' | 'digest', val: boolean) => {
    if (!larkPrefs) return;
    setLarkPrefsBusy(true);
    try {
      const next = await updateNotificationPrefs({ [k]: val });
      setLarkPrefs(next);
    } catch {
      // soft fail; don't toast — checkbox state simply won't reflect change
    } finally {
      setLarkPrefsBusy(false);
    }
  };

  const saveDelay = async () => {
    setSaveError("");
    try {
      const res = await fetch(`${API_URL}/api/users/me${key ? `?key=${key}` : ""}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stagingDelayMs: stagingDelay,
        }),
      });
      if (res.ok) {
        setSavedDelay(true);
        setTimeout(() => setSavedDelay(false), 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || t("common.saveFailed"));
        setTimeout(() => setSaveError(""), 3000);
      }
    } catch {
      setSaveError(t("common.saveFailed"));
      setTimeout(() => setSaveError(""), 3000);
    }
  };

  const origin = API_URL || (typeof window !== "undefined" ? window.location.origin : "");
  // M2a.5: cookie-only users have no localStorage key; if they just generated
  // a new credential via the rotation button, use that. Otherwise use the
  // localStorage key. If neither exists, show a placeholder so commands stay
  // copy-readable but obviously incomplete.
  const effectiveKey = newMcpKey || key;
  const keyForUrl = effectiveKey || t("lark.mcp.keyPlaceholder");
  // Streamable HTTP (modern MCP transport, since spec 2025-03) — used by
  // Claude Code (CLI + Desktop). Other clients (Codex / Cursor / Windsurf)
  // may not support it yet → those keep using the SSE URL below.
  // See /setup for the trailing-slash rationale (nginx regex match).
  const mcpUrl = `${origin}/mcp/?key=${keyForUrl}`;
  const mcpSseUrl = `${origin}/mcp/sse?key=${keyForUrl}`;
  const claudeCodeCommand = `claude mcp add router --transport http --scope user "${mcpUrl}"`;

  const skillInstructions = MCP_SKILL_INSTRUCTIONS;
  const personalTemplate = ROUTER_PERSONAL_TEMPLATE;

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Loading /></div>;
  }

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-(--muted-light)">{t("settings.notLoggedIn")} <a href="/" className="underline">{t("settings.goDashboard")}</a></p>
      </div>
    );
  }

  return (
    <div className="fade-up flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
          <p className="text-sm text-(--muted) mt-1">@{user.handle} &middot; {user.teamId}</p>
        </div>
        <div className="flex items-center gap-1">
          <a href="/members" className="text-[12px] text-(--muted) hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-(--accent-light) transition-all">{t("settings.membersLink")}</a>
          <a href="/" className="text-xs text-(--muted-light) hover:text-(--muted)">{t("settings.goDashboard")}</a>
        </div>
      </div>

      {/* ── Language ── */}
      {features.languages.length > 1 && (
        <section className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
          <h2 className="text-sm font-bold mb-2">{t("lang.label")}</h2>
          <div className="flex gap-2">
            {features.languages.map(code => (
              <button key={code} onClick={() => setLang(code)}
                className={`cursor-pointer text-sm px-4 py-2 rounded-lg border transition-colors ${lang === code ? "border-(--accent) bg-(--accent-light) text-foreground" : "border-(--card-border) text-(--muted) hover:border-(--accent)"}`}>
                {t(`lang.${code}`)}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Concierge entry ── */}
      <section className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
        <h2 className="text-sm font-bold mb-2">{t("concierge.sectionTitle")}</h2>
        <p className="text-xs text-(--muted) mb-4">{t("concierge.sectionDesc")}</p>
        <a
          href={`/settings/concierge${effectiveKey ? `?key=${encodeURIComponent(effectiveKey)}` : ""}`}
          className="cursor-pointer text-sm bg-(--accent) text-white px-4 py-2 rounded-lg hover:bg-(--accent-hover) transition-colors inline-block"
        >
          {t("concierge.sectionOpen")}
        </a>
      </section>

      {/* ── Team Memory entry ── */}
      <section className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
        <h2 className="text-sm font-bold mb-2">{t("memory.sectionTitle")}</h2>
        <p className="text-xs text-(--muted) mb-4">{t("memory.sectionDesc")}</p>
        <a
          href={`/settings/memory${effectiveKey ? `?key=${encodeURIComponent(effectiveKey)}` : ""}`}
          className="cursor-pointer text-sm bg-(--accent) text-white px-4 py-2 rounded-lg hover:bg-(--accent-hover) transition-colors inline-block"
        >
          {t("memory.sectionOpen")}
        </a>
      </section>

      {/* ── Profile ── */}
      <section className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
        <h2 className="text-sm font-bold mb-4">{t("settings.profile")}</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-(--muted) mb-1">{t("settings.displayName")}</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t("settings.displayNamePlaceholder")} className="w-full text-sm px-3 py-2 rounded-lg border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light)" />
          </div>

          <div>
            <label className="block text-xs font-medium text-(--muted) mb-1">{t("settings.bio")}</label>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)}
              placeholder={t("settings.bioPlaceholder")} rows={2}
              className="w-full text-sm px-3 py-2 rounded-lg border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) resize-none" />
          </div>

          <div>
            <label className="block text-xs font-medium text-(--muted) mb-1">{t("settings.email")}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={t("settings.emailPlaceholder")} className="w-full text-sm px-3 py-2 rounded-lg border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light)" />
          </div>

          <div>
            <label className="block text-xs font-medium text-(--muted) mb-1">{t("settings.role")}</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light)">
              <option value="">{t("settings.notSet")}</option>
              <option value="frontend">{t("settings.roleFrontend")}</option>
              <option value="backend">{t("settings.roleBackend")}</option>
              <option value="design">{t("settings.roleDesign")}</option>
              <option value="pm">{t("settings.rolePm")}</option>
              <option value="infra">{t("settings.roleInfra")}</option>
            </select>
          </div>

          <button onClick={saveProfile}
            className="cursor-pointer text-sm bg-(--accent) text-white px-4 py-2 rounded-lg hover:bg-(--accent-hover) transition-colors">
            {savedProfile ? t("common.saved") : t("settings.saveProfile")}
          </button>
          {saveError && <p className="text-xs text-red-500 mt-2">{saveError}</p>}
        </div>
      </section>

      {/* ── Privacy / Staging ── */}
      <section className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
        <h2 className="text-sm font-bold mb-2">{t("settings.publishingDelay")}</h2>
        <p className="text-xs text-(--muted) mb-4">
          {t("settings.publishingDelayHint")}
        </p>

        <select value={stagingDelay} onChange={(e) => { setStagingDelay(Number(e.target.value)); }}
          className="w-full text-sm px-3 py-2 rounded-lg border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) mb-3">
          {DELAY_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <button onClick={saveDelay}
          className="cursor-pointer text-sm bg-(--accent) text-white px-4 py-2 rounded-lg hover:bg-(--accent-hover) transition-colors">
          {savedDelay ? t("common.saved") : t("common.save")}
        </button>
      </section>

      {/* ── Personal Notification Webhook ── */}
      <section className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
        <h2 className="text-sm font-bold mb-2">{t("settings.personalWebhook")}</h2>
        <p className="text-xs text-(--muted) mb-3 leading-relaxed">
          {t("settings.personalWebhookHint")}
        </p>

        <details className="mb-3 text-xs text-(--muted)">
          <summary className="cursor-pointer hover:text-foreground font-medium">{t("settings.personalWebhookLarkHow")}</summary>
          <ol className="mt-2 pl-4 list-decimal space-y-1 leading-relaxed text-(--muted-light)">
            <li>{t("settings.personalWebhookLarkStep1")}</li>
            <li>{t("settings.personalWebhookLarkStep2")}</li>
            <li>{t("settings.personalWebhookLarkStep3")}</li>
            <li>{t("settings.personalWebhookLarkStep4")}</li>
          </ol>
        </details>

        <input type="url" value={notificationWebhook}
          onChange={(e) => setNotificationWebhook(e.target.value)}
          placeholder={t("settings.personalWebhookPlaceholder")}
          className="w-full text-sm px-3 py-2 rounded-lg border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) mb-3 font-mono" />

        <button onClick={saveNotificationWebhook}
          className="cursor-pointer text-sm bg-(--accent) text-white px-4 py-2 rounded-lg hover:bg-(--accent-hover) transition-colors">
          {savedWebhook ? t("common.saved") : t("common.save")}
        </button>
      </section>

      {/* ── Lark account binding (M2a.5c) ── */}
      {features.platforms.includes("lark") && (
      <section id="lark-binding" className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
        <h2 className="text-sm font-bold mb-2">{t("lark.settings.sectionTitle")}</h2>
        {user?.larkBinding ? (
          <>
            <div className="flex items-center gap-3 mb-4">
              {user.larkBinding.avatarUrl && (
                <img src={user.larkBinding.avatarUrl} alt="" className="w-10 h-10 rounded-full" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{user.larkBinding.name || t("lark.settings.noNameProvided")}</div>
                <div className="text-xs text-(--muted) font-mono break-all">{user.larkBinding.openId}</div>
              </div>
            </div>
            <div className="text-xs text-(--muted) mb-3">
              {t("lark.settings.boundAt", { time: user.larkBinding.boundAt ? new Date(user.larkBinding.boundAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US") : t("lark.settings.boundAtDash") })}
            </div>
            <button
              onClick={() => setConfirmUnbind(true)}
              disabled={larkBusy}
              className="cursor-pointer text-xs font-medium text-red-500 hover:text-red-600 disabled:opacity-40">
              {larkBusy ? t("lark.settings.unbindBusy") : t("lark.settings.unbindButton")}
            </button>
          </>
        ) : (
          <>
            <div className="text-xs text-(--muted) mb-4 leading-relaxed">
              <p className="mb-1">{t("lark.settings.benefits")}</p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li>{t("lark.settings.benefit1")}</li>
                <li>{t("lark.settings.benefit2")}</li>
                <li>{t("lark.settings.benefit3")}</li>
              </ul>
            </div>
            <button
              onClick={async () => {
                setLarkBusy(true);
                try {
                  const { authorize_url } = await larkAuthorize(key);
                  window.location.href = authorize_url;
                } catch (e: any) {
                  setLarkToast(e.message?.includes("503") ? t("lark.loginUnavailable") : t("lark.loginFailed"));
                  setLarkBusy(false);
                }
              }}
              disabled={larkBusy}
              className="cursor-pointer text-xs font-medium px-4 py-2 rounded-lg bg-(--accent) text-white hover:bg-(--accent-hover) disabled:opacity-50">
              {larkBusy ? t("lark.settings.connectBusy") : t("lark.settings.connectButton")}
            </button>
          </>
        )}
        {larkToast && (
          <div className="mt-3 text-xs text-neutral-600 bg-neutral-100 rounded-lg p-2.5">{larkToast}</div>
        )}
      </section>
      )}

      {/* ── Lark IM notification preferences ── */}
      {features.platforms.includes("lark") && larkPrefs && (
      <section className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
        <h2 className="text-sm font-bold mb-2">{t("settings.larkNotifTitle")}</h2>
        {!larkPrefs.larkBound && (
          <p className="text-xs text-(--muted) mb-3 leading-relaxed">
            {t("settings.larkNotifNotBound")}{" "}
            <a className="underline text-(--accent)" href="#lark-binding">
              {t("settings.larkNotifBindLink")}
            </a>
          </p>
        )}
        <div className={`space-y-2.5 ${!larkPrefs.larkBound ? "opacity-50 pointer-events-none" : ""}`}>
          {(["mention", "comment", "reply", "digest"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2.5 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={larkPrefs[k]}
                disabled={larkPrefsBusy || !larkPrefs.larkBound}
                onChange={(e) => saveLarkPref(k, e.target.checked)}
                className="w-4 h-4 cursor-pointer accent-(--accent)"
              />
              <span>{t(`settings.larkNotif_${k}`)}</span>
            </label>
          ))}
        </div>
      </section>
      )}

      {/* ── MCP credential rotation (M2a.5) ── */}
      <section id="mcp-credential" className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
        <h2 className="text-sm font-bold mb-2">{t("lark.mcp.sectionTitle")}</h2>
        <p className="text-xs text-(--muted) mb-3 leading-relaxed">{t("lark.mcp.intro")}</p>
        <div className="text-xs text-(--muted) leading-relaxed mb-3 bg-neutral-50 rounded-lg p-3 border border-neutral-200">
          <p className="font-medium text-foreground mb-1">{t("lark.mcp.whenToClickTitle")}</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>{t("lark.mcp.whenToClickItem1")}</li>
            <li>{t("lark.mcp.whenToClickItem2")}</li>
            <li>{t("lark.mcp.whenToClickItem3")}</li>
          </ul>
          <p className="font-medium text-foreground mt-2 mb-1">{t("lark.mcp.whenNotToClickTitle")}</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>{t("lark.mcp.whenNotToClickItem1")}</li>
          </ul>
        </div>
        {!key && !newMcpKey && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-xs text-blue-900 leading-relaxed mb-2">
              <strong>{t("lark.mcp.pasteTitle")}</strong>{t("lark.mcp.pasteHint")}
              <br />{t("lark.mcp.pasteBody")}
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={pastedKey}
                onChange={e => { setPastedKey(e.target.value); setPasteResult(""); }}
                placeholder={t("lark.mcp.pastePlaceholder")}
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-blue-200 bg-white font-mono focus:outline-none focus:border-blue-400" />
              <button
                onClick={async () => {
                  setPasteBusy(true);
                  setPasteResult("");
                  try {
                    const r = await verifyMyKey(pastedKey.trim(), key);
                    if (r.matches) {
                      localStorage.setItem("router_key", pastedKey.trim());
                      setKey(pastedKey.trim());
                      setPastedKey("");
                      setPasteResult("ok");
                    } else {
                      setPasteResult("wrong");
                    }
                  } catch {
                    setPasteResult("error");
                  } finally { setPasteBusy(false); }
                }}
                disabled={pasteBusy || !pastedKey.trim()}
                className="cursor-pointer text-xs font-medium px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                {pasteBusy ? t("lark.mcp.verifyBusy") : t("lark.mcp.verifyButton")}
              </button>
            </div>
            {pasteResult === "ok" && <p className="text-xs text-green-700 mt-2">{t("lark.mcp.verifyOk")}</p>}
            {pasteResult === "wrong" && <p className="text-xs text-red-600 mt-2">{t("lark.mcp.verifyWrong")}</p>}
            {pasteResult === "error" && <p className="text-xs text-red-600 mt-2">{t("lark.mcp.verifyError")}</p>}
          </div>
        )}
        {newMcpKey ? (
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs">
              <strong className="text-amber-800">{t("lark.mcp.saveKeyAlert")}</strong>
              <div className="mt-2 font-mono break-all bg-white border border-amber-200 rounded p-2">{newMcpKey}</div>
              <p className="mt-2 text-amber-700">{t("lark.mcp.graceWarn")}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { navigator.clipboard.writeText(newMcpKey); setCopied("mcpkey"); setTimeout(() => setCopied(""), 1500); }}
                className="cursor-pointer text-xs font-medium px-3 py-2 rounded-lg border border-neutral-200 hover:bg-neutral-50">
                {copied === "mcpkey" ? t("lark.mcp.copiedButton") : t("lark.mcp.copyButton")}
              </button>
              <button
                onClick={() => setNewMcpKey("")}
                className="cursor-pointer text-xs font-medium px-3 py-2 rounded-lg border border-neutral-200 hover:bg-neutral-50">
                {t("lark.mcp.closeButton")}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmRotate(true)}
            disabled={mcpBusy}
            className="cursor-pointer text-xs font-medium px-4 py-2 rounded-lg bg-(--accent) text-white hover:bg-(--accent-hover) disabled:opacity-50">
            {mcpBusy ? t("lark.mcp.rotateBusy") : t("lark.mcp.rotateButton")}
          </button>
        )}
      </section>

      {/* ── Connect via MCP ── */}
      <section id="connect-claude" className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
        <h2 className="text-sm font-bold mb-2">{t("settings.connectClaudeLegacy")}</h2>
        <p className="text-xs text-(--muted) mb-4">{t("settings.connectClaudeLegacyHint")}</p>

        {!effectiveKey && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 leading-relaxed">
            {t("lark.mcp.noKeyNotice").split("{link}").map((part, i, arr) => (
              <span key={i}>
                {part}
                {i < arr.length - 1 && (
                  <a href="#mcp-credential" className="underline font-medium">{t("lark.mcp.noKeyNoticeLink")}</a>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Tab switcher — 2 cols × 3 rows; Others spans full width */}
        <div className="grid grid-cols-2 gap-1 mb-4">
          <button onClick={() => setConnectTab("code")}
            className={`cursor-pointer text-xs font-medium py-2 rounded-md border transition-colors ${connectTab === "code" ? "bg-(--accent) text-white border-(--accent)" : "bg-(--card) text-(--muted) border-(--card-border) hover:bg-(--accent-light)"}`}>
            Claude Code
          </button>
          <button onClick={() => setConnectTab("desktop")}
            className={`cursor-pointer text-xs font-medium py-2 rounded-md border transition-colors ${connectTab === "desktop" ? "bg-(--accent) text-white border-(--accent)" : "bg-(--card) text-(--muted) border-(--card-border) hover:bg-(--accent-light)"}`}>
            Desktop / Web
          </button>
          <button onClick={() => setConnectTab("codex")}
            className={`cursor-pointer text-xs font-medium py-2 rounded-md border transition-colors ${connectTab === "codex" ? "bg-(--accent) text-white border-(--accent)" : "bg-(--card) text-(--muted) border-(--card-border) hover:bg-(--accent-light)"}`}>
            Codex
          </button>
          <button onClick={() => setConnectTab("cursor")}
            className={`cursor-pointer text-xs font-medium py-2 rounded-md border transition-colors ${connectTab === "cursor" ? "bg-(--accent) text-white border-(--accent)" : "bg-(--card) text-(--muted) border-(--card-border) hover:bg-(--accent-light)"}`}>
            Cursor
          </button>
          <button onClick={() => setConnectTab("others")}
            className={`col-span-2 cursor-pointer text-xs font-medium py-2 rounded-md border transition-colors ${connectTab === "others" ? "bg-(--accent) text-white border-(--accent)" : "bg-(--card) text-(--muted) border-(--card-border) hover:bg-(--accent-light)"}`}>
            {t("setup.mcpClientOthers")}
          </button>
        </div>

        {connectTab === "code" ? (
          <div>
            <p className="text-xs font-medium text-foreground mb-2">{t("settings.step1AddConnector")}</p>
            <div className="relative bg-gray-900 rounded-lg p-3 mb-4 font-mono text-xs text-green-400 break-all pr-16">
              {claudeCodeCommand}
              <button onClick={() => copyToClipboard(claudeCodeCommand, "cmd")}
                className="absolute top-2 right-2 text-xs px-2 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600">
                {copied === "cmd" ? t("common.copied") : t("common.copy")}
              </button>
            </div>

            <p className="text-xs text-(--muted) mt-3 mb-2">
              {t("settings.connectedOut")}
            </p>

            <details className="mt-2">
              <summary className="text-xs font-medium text-(--muted) cursor-pointer hover:text-foreground">
                {t("settings.personalizeTitle")}
              </summary>
              <p className="text-xs text-(--muted) mt-2 mb-2 leading-relaxed">
                {t("settings.personalizeBody")}
              </p>
              <div className="relative bg-background rounded-lg p-3 text-xs text-foreground border border-(--card-border) pr-16 max-h-80 overflow-auto">
                <pre className="whitespace-pre-wrap">{personalTemplate}</pre>
                <button onClick={() => copyToClipboard(personalTemplate, "tpl")}
                  className="cursor-pointer absolute top-2 right-2 text-xs px-2 py-1 bg-(--card) text-foreground border border-(--card-border) rounded hover:bg-(--accent-light)">
                  {copied === "tpl" ? t("common.copied") : t("common.copy")}
                </button>
              </div>

              <details className="mt-2">
                <summary className="text-[11px] text-(--muted) cursor-pointer hover:text-foreground">
                  {t("settings.showDefaultSkill")}
                </summary>
                <div className="relative bg-background rounded-lg p-3 mt-2 text-xs text-foreground border border-(--card-border) pr-16 max-h-60 overflow-auto">
                  <pre className="whitespace-pre-wrap">{skillInstructions}</pre>
                  <button onClick={() => copyToClipboard(skillInstructions, "skill")}
                    className="cursor-pointer absolute top-2 right-2 text-xs px-2 py-1 bg-(--card) text-foreground border border-(--card-border) rounded hover:bg-(--accent-light)">
                    {copied === "skill" ? t("common.copied") : t("common.copy")}
                  </button>
                </div>
              </details>
            </details>
          </div>
        ) : connectTab === "desktop" ? (
          <div>
            <p className="text-xs font-medium text-foreground mb-2">{t("settings.step1AddConnector")}</p>
            <p className="text-xs text-(--muted) mb-2">{t("settings.manualConfigTitle")}</p>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-(--muted) mb-1">{t("settings.nameLabel")}</label>
                <div className="bg-background rounded-lg px-3 py-2 text-sm border border-(--card-border) text-foreground font-mono">router</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-(--muted) mb-1">{t("settings.urlLabel")}</label>
                <div className="relative bg-background rounded-lg px-3 py-2 text-xs border border-(--card-border) text-foreground font-mono break-all pr-16">
                  {mcpUrl}
                  <button onClick={() => copyToClipboard(mcpUrl, "url")}
                    className="cursor-pointer absolute top-1.5 right-2 text-xs px-2 py-0.5 bg-(--card) text-foreground border border-(--card-border) rounded hover:bg-(--accent-light)">
                    {copied === "url" ? t("common.copied") : t("common.copy")}
                  </button>
                </div>
              </div>
            </div>

            <div className="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              <p className="font-medium mb-1">⚠ {t("setup.desktopMemoryNoteTitle")}</p>
              <p>{t("setup.desktopMemoryNoteBody")}</p>
            </div>

            <p className="text-xs text-(--muted) mb-2">
              {t("settings.connectedOut")}
            </p>

            <details className="mt-2">
              <summary className="text-xs font-medium text-(--muted) cursor-pointer hover:text-foreground">
                {t("settings.personalizeTitle")}
              </summary>
              <p className="text-xs text-(--muted) mt-2 mb-2 leading-relaxed">
                {t("settings.personalizeBody")}
              </p>
              <div className="relative bg-background rounded-lg p-3 text-xs text-foreground border border-(--card-border) pr-16 max-h-80 overflow-auto">
                <pre className="whitespace-pre-wrap">{personalTemplate}</pre>
                <button onClick={() => copyToClipboard(personalTemplate, "tpl2")}
                  className="cursor-pointer absolute top-2 right-2 text-xs px-2 py-1 bg-(--card) text-foreground border border-(--card-border) rounded hover:bg-(--accent-light)">
                  {copied === "tpl2" ? t("common.copied") : t("common.copy")}
                </button>
              </div>

              <details className="mt-2">
                <summary className="text-[11px] text-(--muted) cursor-pointer hover:text-foreground">
                  {t("settings.showDefaultSkill")}
                </summary>
                <div className="relative bg-background rounded-lg p-3 mt-2 text-xs text-foreground border border-(--card-border) pr-16 max-h-60 overflow-auto">
                  <pre className="whitespace-pre-wrap">{skillInstructions}</pre>
                  <button onClick={() => copyToClipboard(skillInstructions, "skill2")}
                    className="cursor-pointer absolute top-2 right-2 text-xs px-2 py-1 bg-(--card) text-foreground border border-(--card-border) rounded hover:bg-(--accent-light)">
                    {copied === "skill2" ? t("common.copied") : t("common.copy")}
                  </button>
                </div>
              </details>
            </details>
          </div>
        ) : connectTab === "codex" ? (
          <div>
            <p className="text-xs font-medium text-foreground mb-2">{t("settings.codexManualPath")}</p>
            <div className="relative bg-gray-900 rounded-lg p-3 mb-4 font-mono text-xs text-green-400 break-all pr-16">
              <pre className="whitespace-pre-wrap">{`[mcp_servers.router]
type = "http"
url = "${mcpUrl}"`}</pre>
              <button onClick={() => copyToClipboard(`[mcp_servers.router]\ntype = "http"\nurl = "${mcpUrl}"`, "codex")}
                className="absolute top-2 right-2 text-xs px-2 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600">
                {copied === "codex" ? t("common.copied") : t("common.copy")}
              </button>
            </div>
            <p className="text-xs text-(--muted) mb-2">{t("settings.codexAlsoFor")}</p>
            <p className="text-xs text-(--muted-light)">{t("settings.codexNote")}</p>
          </div>
        ) : connectTab === "cursor" ? (
          <div>
            <p className="text-xs font-medium text-foreground mb-2">{t("settings.cursorManualPath")}</p>
            <div className="relative bg-gray-900 rounded-lg p-3 mb-4 font-mono text-xs text-green-400 break-all pr-16">
              <pre className="whitespace-pre-wrap">{`{
  "mcpServers": {
    "router": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`}</pre>
              <button onClick={() => copyToClipboard(`{\n  "mcpServers": {\n    "router": {\n      "type": "http",\n      "url": "${mcpUrl}"\n    }\n  }\n}`, "cursor")}
                className="absolute top-2 right-2 text-xs px-2 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600">
                {copied === "cursor" ? t("common.copied") : t("common.copy")}
              </button>
            </div>
            <p className="text-xs text-(--muted) mb-2">{t("settings.cursorAlsoFor")}</p>
            <p className="text-xs text-(--muted-light)">{t("settings.cursorNote")}</p>
          </div>
        ) : connectTab === "others" ? (
          <div>
            <p className="text-xs font-medium text-foreground mb-2">{t("setup.othersManualPath")}</p>
            <div className="relative bg-gray-50 dark:bg-white/5 rounded-lg p-3 mb-3 text-xs border border-(--card-border) font-mono break-all pr-16">
              {mcpUrl}
              <button onClick={() => copyToClipboard(mcpUrl, "others")}
                className="absolute top-2 right-2 text-xs px-2 py-1 bg-(--card) border border-(--card-border) rounded hover:bg-(--accent-light)">
                {copied === "others" ? t("common.copied") : t("common.copy")}
              </button>
            </div>
            <p className="text-xs text-(--muted) mb-2">{t("setup.othersHint")}</p>
            <p className="text-xs text-(--muted-light)">
              <a href={t("setup.othersDocsUrl")} target="_blank" rel="noopener noreferrer" className="underline hover:text-(--accent)">
                {t("setup.othersDocsLink")} ↗
              </a>
            </p>
          </div>
        ) : null}

        {/* Legacy SSE — deprecated, only for clients without Streamable HTTP support */}
        <details className="mt-6 group">
          <summary className="text-xs text-(--muted-light) cursor-pointer hover:text-foreground select-none">
            {t("setup.legacySseSummary")}
          </summary>
          <div className="mt-2 p-3 rounded-lg border border-(--card-border) bg-black/2 dark:bg-white/2 text-xs text-(--muted) leading-relaxed">
            <p className="mb-2">{t("setup.legacySseBody")}</p>
            <div className="relative bg-black/5 dark:bg-white/5 rounded p-2.5 mb-1 font-mono text-xs break-all pr-16">
              {mcpSseUrl}
              <button
                type="button"
                onClick={() => copyToClipboard(mcpSseUrl, "sse-legacy")}
                className="cursor-pointer absolute top-1.5 right-2 text-xs px-2 py-0.5 bg-(--card) border border-(--card-border) rounded hover:bg-(--accent-light) transition-colors"
              >
                {copied === "sse-legacy" ? t("common.copied") : t("common.copy")}
              </button>
            </div>
          </div>
        </details>
      </section>

      {/* ── Router CLI ── */}
      <section id="connect-cli" className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
        <h2 className="text-sm font-bold mb-2">{t("settings.cliSectionTitle")}</h2>
        <p className="text-xs text-(--muted) mb-2">{t("settings.cliSectionHint")}</p>
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-xs text-blue-900 leading-relaxed">
          {t("settings.cliClientsTip")}
        </div>
        <div className="relative bg-gray-900 rounded-lg p-3 mb-4 font-mono text-xs text-green-400 break-all pr-16">
          <pre className="whitespace-pre-wrap">{cliInstall}</pre>
          <button
            onClick={() => copyToClipboard(cliInstall, "cli-cmd")}
            className="absolute top-2 right-2 text-xs px-2 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600">
            {copied === "cli-cmd" ? t("common.copied") : t("common.copy")}
          </button>
        </div>
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 leading-relaxed">
          <p className="font-medium mb-1">{t("settings.cliMcpMigrationTitle")}</p>
          <p className="mb-2">{t("settings.cliMcpMigrationBody")}</p>
          <div className="relative bg-amber-100 rounded p-2 font-mono text-xs text-amber-900 pr-16">
            <code>{t("settings.cliMcpMigrationCode")}</code>
            <button
              onClick={() => copyToClipboard(t("settings.cliMcpMigrationCode"), "cli-mcp-rm")}
              className="absolute top-1 right-1 text-xs px-2 py-0.5 bg-amber-200 text-amber-900 border border-amber-300 rounded hover:bg-amber-300">
              {copied === "cli-mcp-rm" ? t("common.copied") : t("common.copy")}
            </button>
          </div>
          <p className="mt-2 text-amber-800">{t("settings.cliMcpMigrationFootnote")}</p>
        </div>
        <p className="text-xs text-(--muted)">
          {t("settings.cliSyncSettingsLink")}
          <a href="/settings/sync" className="underline font-medium">{t("settings.cliSyncSettingsLinkLabel")}</a>
        </p>
      </section>

      {/* ── Invite Members ── */}
      {user.isAdmin && (
        <InviteSection apiUrl={API_URL} secretKey={key} onCopy={copyToClipboard} copied={copied} t={t} />
      )}

      {/* ── Secret Key ── */}
      <section className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
        <h2 className="text-sm font-bold mb-2">{t("settings.secretKey")}</h2>
        <p className="text-xs text-(--muted) mb-3">{t("settings.secretKeyHint")}</p>
        {key ? (
          <div className="relative bg-background rounded-lg p-3 font-mono text-xs break-all border border-(--card-border) text-foreground pr-16">
            {key}
            <button onClick={() => copyToClipboard(key, "key")}
              className="cursor-pointer absolute top-2 right-2 text-xs px-2 py-1 bg-(--card) text-foreground border border-(--card-border) rounded hover:bg-(--accent-light)">
              {copied === "key" ? t("common.copied") : t("common.copy")}
            </button>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 leading-relaxed">
            <p className="font-medium mb-2">{t("settings.secretKeyEmpty")}</p>
            <p className="mb-2">{t("settings.secretKeyEmptyHint")}</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                {t("settings.secretKeyEmptyOpt1Pre")}
                <a href="#mcp-credential" className="underline font-medium">{t("settings.secretKeyEmptyOpt1Link")}</a>
                {t("settings.secretKeyEmptyOpt1Post")}
              </li>
              <li>{t("settings.secretKeyEmptyOpt2")}</li>
              <li>
                {t("settings.secretKeyEmptyOpt3Pre")}
                <code className="font-mono bg-amber-100 px-1 rounded">{t("settings.secretKeyEmptyOpt3Code")}</code>
                {t("settings.secretKeyEmptyOpt3Post")}
              </li>
            </ul>
          </div>
        )}
      </section>

      {/* ── API Docs ── */}
      <a href="/api" target="_blank"
        className="block text-center text-xs text-(--muted-light) hover:text-(--accent) mb-6 transition-colors">
        API Documentation →
      </a>

      {/* ── Usage Guide ── */}
      <section id="guide" className="bg-(--card) rounded-xl border border-(--card-border) p-6 scroll-mt-8">
        <h2 className="text-sm font-bold mb-1">{t("settings.guideTitle")}</h2>
        <p className="text-xs text-(--muted) mb-5">{t("settings.guideSubtitle")}</p>

        {/* Scenario 1 */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded">1</span>
            <h3 className="text-sm font-semibold text-foreground">{t("settings.scenario1Title")}</h3>
          </div>
          <p className="text-xs text-(--muted) leading-relaxed mb-2">
            {t("settings.scenario1Body")}
          </p>
          <div className="bg-background border border-(--card-border) rounded-lg p-3 text-xs text-foreground space-y-1">
            <div>{t("settings.scenario1Phrase1")}</div>
            <div>{t("settings.scenario1Phrase2")}</div>
            <div>{t("settings.scenario1Phrase3")}</div>
          </div>
        </div>

        {/* Scenario 2 */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded">2</span>
            <h3 className="text-sm font-semibold text-foreground">{t("settings.scenario2Title")}</h3>
          </div>
          <p className="text-xs text-(--muted) leading-relaxed mb-2">
            {t("settings.scenario2Body")}
          </p>
          <ul className="text-xs text-(--muted) space-y-1 pl-4 list-disc">
            <li>{t("settings.scenario2Signal1")}</li>
            <li>{t("settings.scenario2Signal2")}</li>
            <li>{t("settings.scenario2Signal3")}</li>
            <li>{t("settings.scenario2Signal4")}</li>
          </ul>
          <p className="text-xs text-(--muted-light) mt-2">
            {t("settings.scenario2Hint")}
          </p>
        </div>

        {/* Scenario 3 */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded">3</span>
            <h3 className="text-sm font-semibold text-foreground">{t("settings.scenario3Title")}</h3>
          </div>
          <ol className="text-xs text-(--muted) leading-relaxed space-y-1.5 pl-4 list-decimal">
            <li>{t("settings.scenario3Step1")}</li>
            <li>{t("settings.scenario3Step2")}</li>
            <li>{t("settings.scenario3Step3")}</li>
            <li>{t("settings.scenario3Step4")}</li>
          </ol>
        </div>

        {/* Scenario 4 */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold bg-gray-100 text-gray-700 px-2 py-0.5 rounded">4</span>
            <h3 className="text-sm font-semibold text-foreground">{t("settings.scenario4Title")}</h3>
          </div>
          <ul className="text-xs text-(--muted) space-y-1 pl-4 list-disc leading-relaxed">
            <li>{t("settings.scenario4Body1")}</li>
            <li>{t("settings.scenario4Body2")}</li>
            <li>{t("settings.scenario4Body3")}</li>
          </ul>
        </div>

        {/* Browse & manage */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-semibold text-foreground">{t("settings.browseTitle")}</h3>
          </div>
          <ul className="text-xs text-(--muted) space-y-1 pl-4 list-disc leading-relaxed">
            <li><a href="/" className="underline text-(--accent)">{t("nav.dashboard")}</a> — {t("settings.browseDashboard")}</li>
            <li><a href="/members" className="underline text-(--accent)">{t("nav.members")}</a> — {t("settings.browseMembers")}</li>
            <li><a href="/tags" className="underline text-(--accent)">{t("nav.channels")}</a> — {t("settings.browseChannels")}</li>
            <li>{t("settings.browseStaging")}</li>
          </ul>
        </div>
      </section>

      {/* Confirm dialogs (replace native confirm()) */}
      <ConfirmDialog
        open={confirmUnbind}
        title={t("lark.settings.unbindButton")}
        message={t("lark.settings.unbindConfirm")}
        confirmText={t("lark.settings.unbindButton")}
        danger={true}
        onConfirm={async () => {
          setConfirmUnbind(false);
          setLarkBusy(true);
          try {
            await larkUnbind(key);
            setUser(u => u ? { ...u, larkBinding: undefined } : u);
            setLarkToast(t("lark.settings.unbindSuccess"));
          } catch {
            setLarkToast(t("lark.settings.unbindFailed"));
          } finally { setLarkBusy(false); }
        }}
        onCancel={() => setConfirmUnbind(false)}
      />
      <ConfirmDialog
        open={confirmRotate}
        title={t("lark.mcp.rotateButton")}
        message={t("lark.mcp.rotateConfirm")}
        confirmText={t("lark.mcp.rotateButton")}
        danger={true}
        onConfirm={async () => {
          setConfirmRotate(false);
          setMcpBusy(true);
          try {
            const r = await rotateMcpCredential(key);
            setNewMcpKey(r.secret_key);
            localStorage.setItem("router_key", r.secret_key);
          } catch (e: any) {
            setLarkToast(t("lark.mcp.rotateFailed", { msg: e.message || "" }));
          } finally { setMcpBusy(false); }
        }}
        onCancel={() => setConfirmRotate(false)}
      />
    </div>
  );
}

function InviteSection({ apiUrl, secretKey, onCopy, copied, t }: {
  apiUrl: string; secretKey: string; onCopy: (text: string, label: string) => void; copied: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [maxUses, setMaxUses] = useState("10");
  const [expiresDays, setExpiresDays] = useState("7");
  const [generating, setGenerating] = useState(false);
  const [inviteError, setInviteError] = useState("");

  const generate = async () => {
    setGenerating(true);
    setInviteError("");
    try {
      const res = await fetch(`${apiUrl}/api/invite/generate${secretKey ? `?key=${secretKey}` : ""}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_uses: parseInt(maxUses) || undefined,
          expires_days: parseInt(expiresDays) || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) setInviteCode(data.invite_code);
      else {
        setInviteError(data.error || t("settings.generateFailed"));
        setTimeout(() => setInviteError(""), 3000);
      }
    } catch {
      setInviteError(t("settings.generateFailed"));
      setTimeout(() => setInviteError(""), 3000);
    }
    setGenerating(false);
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const inviteLink = inviteCode ? `${origin}/register?invite=${inviteCode}` : "";

  return (
    <section className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
      <h2 className="text-sm font-bold mb-2">{t("settings.inviteMembersTitle")}</h2>
      <p className="text-xs text-(--muted) mb-4">{t("settings.inviteMembersHint")}</p>

      {inviteCode ? (
        <div>
          <p className="text-xs font-medium text-foreground mb-2">{t("settings.inviteLinkLabel")}</p>
          <div className="relative bg-background rounded-lg p-3 mb-3 font-mono text-xs break-all border border-(--card-border) text-foreground pr-16">
            {inviteLink}
            <button onClick={() => onCopy(inviteLink, "invitelink")}
              className="cursor-pointer absolute top-2 right-2 text-xs px-2 py-1 bg-(--card) text-foreground border border-(--card-border) rounded hover:bg-(--accent-light)">
              {copied === "invitelink" ? t("common.copied") : t("common.copy")}
            </button>
          </div>
          <details className="mb-3">
            <summary className="text-[11px] text-(--muted) cursor-pointer hover:text-foreground">{t("settings.rawInviteCode")}</summary>
            <div className="relative bg-background rounded-lg p-2 mt-2 font-mono text-xs break-all border border-(--card-border) text-foreground pr-16">
              {inviteCode}
              <button onClick={() => onCopy(inviteCode, "invite")}
                className="cursor-pointer absolute top-1.5 right-2 text-xs px-2 py-0.5 bg-(--card) text-foreground border border-(--card-border) rounded hover:bg-(--accent-light)">
                {copied === "invite" ? t("common.copied") : t("common.copy")}
              </button>
            </div>
          </details>
          <button onClick={() => setInviteCode(null)} className="text-xs text-(--muted-light) hover:text-(--muted)">
            {t("settings.generateAnother")}
          </button>
        </div>
      ) : (
        <div>
          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-(--muted) mb-1">{t("settings.maxUses")}</label>
              <input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-lg border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light)" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-(--muted) mb-1">{t("settings.expiresDays")}</label>
              <input type="number" value={expiresDays} onChange={(e) => setExpiresDays(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-lg border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light)" />
            </div>
          </div>
          <button onClick={generate} disabled={generating}
            className="cursor-pointer text-sm bg-(--accent) text-white px-4 py-2 rounded-lg hover:bg-(--accent-hover) disabled:opacity-50 transition-colors">
            {generating ? t("settings.generating") : t("settings.generateInvite")}
          </button>
          {inviteError && <p className="text-xs text-red-500 mt-2">{inviteError}</p>}
        </div>
      )}
    </section>
  );
}
