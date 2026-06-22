"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  getEntries,
  getTagStats,
  searchEntries,
  getTeamInfo,
  publishEntry,
  deleteEntry,
  getUnreadCount,
  getTagPresets,
  saveTagPreset,
  deleteTagPreset,
  getPresetTags,
  larkLogin,
  createSessionFromKey,
  deleteSession,
  getMeViaCookie,
  type RouterEntry,
  type TagStat,
  type TagPreset,
  type PresetTag,
} from "@/lib/api";
import EntryCard from "./components/EntryCard";
import TagBar from "./components/TagBar";
import SearchFloat from "./components/SearchFloat";
import FeedbackFloat from "./components/FeedbackFloat";
import Toast from "./components/Toast";
import ThemeToggle from "./components/ThemeToggle";
import LangToggle from "./components/LangToggle";
import ConfirmDialog from "./components/ConfirmDialog";
import Loading from "./components/Loading";
import Pagination from "./components/Pagination";
import { useI18n } from "@/lib/i18n";
import { useServerInfo } from "@/lib/server-info";
import { groupByLocalDate } from "@/lib/dateGroup";

export default function Dashboard() {
  const { t, lang } = useI18n();
  const { features } = useServerInfo();
  const [key, setKey] = useState("");
  const [currentHandle, setCurrentHandle] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [entries, setEntries] = useState<RouterEntry[]>([]);
  const [tags, setTags] = useState<TagStat[]>([]);
  const [presetTagSet, setPresetTagSet] = useState<Set<string>>(new Set());
  const [presetTagMap, setPresetTagMap] = useState<Map<string, string>>(new Map());
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [teamName, setTeamName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasFetchedOnce, setHasFetchedOnce] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [presets, setPresets] = useState<TagPreset[]>([]);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [deletingPresetId, setDeletingPresetId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifToast, setNotifToast] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("onboarding_banner_dismissed") === "1"
  );
  const [mcpUpdateNeeded, setMcpUpdateNeeded] = useState(false);
  const [mcpSchemaVersion, setMcpSchemaVersion] = useState("");
  const [tagMigrationNeeded, setTagMigrationNeeded] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalEntries, setTotalEntries] = useState(0);
  const [larkErr, setLarkErr] = useState("");
  const PAGE_SIZE = 50;
  const lastUnreadRef = useRef(-1);

  // Auto-login: URL param > localStorage > show login
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlKey = params.get("key");
    const urlTags = params.get("tags");
    const returnTo = params.get("return");
    const safeReturnTo = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : null;

    // ── Lark login callback handling (M2a.5: cookie-based, no key rotation) ──
    const larkLoginFlag = params.get("lark_login");
    const larkLoginHandle = params.get("handle");
    const larkError = params.get("error");

    if (larkLoginFlag === "1" && larkLoginHandle) {
      // Cookie was set by callback. Stash the handle for nice optimistic UI;
      // the cookie probe at the bottom will then run enterLoggedIn("").
      localStorage.setItem("router_handle", larkLoginHandle);
      window.history.replaceState({}, "", "/");
    } else if (larkError === "lark_not_bound") {
      setLarkErr(t("lark.errorNotBound"));
      window.history.replaceState({}, "", "/");
    } else if (larkError === "user_denied") {
      setLarkErr(t("lark.errorUserDenied"));
      window.history.replaceState({}, "", "/");
    } else if (larkError === "invalid_state") {
      setLarkErr(t("lark.errorInvalidState"));
      window.history.replaceState({}, "", "/");
    } else if (larkError === "lark_error") {
      const detail = params.get("detail") || "?";
      setLarkErr(t("lark.errorGeneric", { detail }));
      window.history.replaceState({}, "", "/");
    }

    const savedKey = localStorage.getItem("router_key");
    const activeKey = urlKey || savedKey;

    // M2a.5 silent migration: exchange the key for a session cookie so future
    // requests can rely on cookie alone. Covers both:
    //   - savedKey: existing localStorage user (legacy migration)
    //   - urlKey:   new user just registered, arrived via /?key=... — without
    //               this, their first dashboard visit lacks a cookie until
    //               the next refresh writes localStorage.
    const migrateKey = savedKey || urlKey;
    if (migrateKey) {
      createSessionFromKey(migrateKey).catch(() => {});
    }

    if (urlKey) {
      window.history.replaceState({}, "", "/");
    }

    if (urlTags) {
      setSelectedTags(urlTags.split(","));
    }

    // Bootstrap logged-in state, given a working auth source (key OR cookie).
    // If no localStorage key, we pass empty string — api.ts then relies on cookie.
    const enterLoggedIn = (effectiveKey: string) => {
      setKey(effectiveKey);
      const cachedHandle = localStorage.getItem("router_handle");
      if (cachedHandle) {
        setCurrentHandle(cachedHandle);
        setLoggedIn(true);
      }
      getTeamInfo(effectiveKey).then((info) => {
        if (info.team) {
          // Persist the key (only if non-empty — cookie-only sessions skip this)
          if (effectiveKey) localStorage.setItem("router_key", effectiveKey);
          setTeamName(info.team.name);
          fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/me${effectiveKey ? `?key=${effectiveKey}` : ""}`, { credentials: "include" })
            .then(r => r.json())
            .then(d => {
              if (d.handle) { setCurrentHandle(d.handle); localStorage.setItem("router_handle", d.handle); }
              if (d.isAdmin) setIsAdmin(true);
              // localStorage.router_key is a plaintext cache for the user's
              // own reference (so /settings can render commands with their
              // key). It's NOT involved in auth (cookie is). Don't auto-clear
              // it just because the user has a Lark binding — keep it as
              // memory of the last generated key. Cleared only on logout or
              // explicit rotation (which writes the new key in its place).
              if (d.mcpSchemaVersion) {
                const ver = String(d.mcpSchemaVersion);
                setMcpSchemaVersion(ver);
                const seen = localStorage.getItem("mcp_schema_version");
                if (seen === null) {
                  localStorage.setItem("mcp_schema_version", ver);
                } else if (seen !== ver) {
                  setMcpUpdateNeeded(true);
                }
              }
              // One-time "Channels → Tags" announcement, only for teams that
              // actually used the channel feature before. Dismissed in localStorage.
              if (d.tagMigrationRelevant &&
                  localStorage.getItem("tag_migration_announcement_dismissed") !== "1") {
                setTagMigrationNeeded(true);
              }
            });
          if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
          }

          getUnreadCount(effectiveKey).then(c => { lastUnreadRef.current = c; setUnreadCount(c); }).catch(() => {});
          const pollInterval = setInterval(() => {
            getUnreadCount(effectiveKey).then(count => {
              if (lastUnreadRef.current >= 0 && count > lastUnreadRef.current) {
                const diff = count - lastUnreadRef.current;
                const msg = `${diff} new notification${diff > 1 ? 's' : ''}`;
                setNotifToast(msg);
                if ('Notification' in window && Notification.permission === 'granted') {
                  new Notification('Teleport Router', { body: msg, icon: '/icon.png' });
                }
              }
              lastUnreadRef.current = count;
              setUnreadCount(count);
            }).catch(() => {});
          }, 15000);
          setLoggedIn(true);
          if (safeReturnTo) {
            window.location.href = safeReturnTo;
            return;
          }
          getTagPresets(effectiveKey).then(setPresets).catch(() => {});
          const initTags = urlTags ? urlTags.split(",") : [];
          fetchData(effectiveKey, initTags, null, null);
          return () => clearInterval(pollInterval);
        } else {
          localStorage.removeItem("router_key");
          localStorage.removeItem("router_handle");
          setLoggedIn(false);
          setCurrentHandle("");
        }
      }).catch((err: any) => {
        if (err?.authFailed) {
          localStorage.removeItem("router_key");
          localStorage.removeItem("router_handle");
          setLoggedIn(false);
          setCurrentHandle("");
        }
      }).finally(() => {
        setInitializing(false);
      });
    };

    if (activeKey && !loggedIn) {
      enterLoggedIn(activeKey);
    } else if (!loggedIn) {
      // M2a.5: no localStorage key, but we may have a session cookie from
      // a prior Lark login. Probe /api/me via cookie; if it succeeds, enter
      // logged-in state with empty key (api.ts uses cookie via credentials:include).
      getMeViaCookie().then(d => {
        if (d?.handle) {
          localStorage.setItem("router_handle", d.handle);
          enterLoggedIn("");
        } else {
          setInitializing(false);
        }
      }).catch(() => setInitializing(false));
    } else {
      setInitializing(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dismissBanner = () => {
    setBannerDismissed(true);
    localStorage.setItem("onboarding_banner_dismissed", "1");
  };

  const fetchData = useCallback(
    async (activeKey: string, activeTags: string[], search: string | null, author: string | null, page = 1) => {
      setLoading(true);
      const offset = (page - 1) * PAGE_SIZE;
      try {
        const [tagData, entryData, presetData] = await Promise.all([
          getTagStats(activeKey),
          search
            ? searchEntries(activeKey, search).then((d) => ({
                entries: d.results,
                total: d.count,
              }))
            : getEntries(activeKey, {
                tags: activeTags.length > 0 ? activeTags : undefined,
                author: author || undefined,
                limit: PAGE_SIZE,
                offset,
              }),
          getPresetTags(activeKey),
        ]);
        setTags(tagData);
        setPresetTagSet(new Set(presetData.map((p: PresetTag) => p.name)));
        setPresetTagMap(new Map(presetData.map((p: PresetTag) => [p.name, p.description])));
        // Clean up selected tags that no longer exist (e.g. all entries deleted)
        const validTagNames = new Set(tagData.map((t: TagStat) => t.tag));
        const cleaned = activeTags.filter(t => validTagNames.has(t));
        if (cleaned.length !== activeTags.length) {
          setSelectedTags(cleaned);
        }
        setEntries(entryData.entries);
        setTotalEntries(entryData.total ?? 0);
      } catch {
        setEntries([]);
      }
      setLoading(false);
      setHasFetchedOnce(true);
    },
    []
  );

  const [loginError, setLoginError] = useState("");

  const handleLogin = async () => {
    if (!key.trim()) return;
    setLoginError("");
    try {
      const info = await getTeamInfo(key.trim());
      if (info.team) {
        localStorage.setItem("router_key", key.trim());
        // Also set session cookie so subsequent reloads work via cookie
        // (fire-and-forget; UX shouldn't block on this)
        createSessionFromKey(key.trim()).catch(() => {});
        setTeamName(info.team.name);
        fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/me?key=${key.trim()}`)
          .then(r => r.json())
          .then(d => {
            if (d.handle) { setCurrentHandle(d.handle); localStorage.setItem("router_handle", d.handle); }
            if (d.isAdmin) setIsAdmin(true);
            // For new users logging in for the first time: silently store
            // the current MCP version so the banner never appears for them.
            if (d.mcpSchemaVersion) {
              const ver = String(d.mcpSchemaVersion);
              setMcpSchemaVersion(ver);
              const seen = localStorage.getItem("mcp_schema_version");
              if (seen === null) {
                localStorage.setItem("mcp_schema_version", ver);
              } else if (seen !== ver) {
                setMcpUpdateNeeded(true);
              }
            }
            if (d.tagMigrationRelevant &&
                localStorage.getItem("tag_migration_announcement_dismissed") !== "1") {
              setTagMigrationNeeded(true);
            }
          });
        setLoggedIn(true);
        const ret = new URLSearchParams(window.location.search).get("return");
        if (ret && ret.startsWith("/") && !ret.startsWith("//")) {
          window.location.href = ret;
          return;
        }
        getTagPresets(key.trim()).then(setPresets).catch(() => {});
        fetchData(key.trim(), [], null, null);
      } else {
        setLoginError(t('login.invalidKey'));
      }
    } catch {
      setLoginError(t('login.invalidKey'));
    }
  };

  const handleLarkLogin = async () => {
    setLarkErr("");
    try {
      const k = localStorage.getItem("router_key") || undefined;
      const { authorize_url } = await larkLogin({ callerKey: k });
      window.location.href = authorize_url;
    } catch (e: any) {
      if (e.message?.includes("503")) {
        setLarkErr(t("lark.loginUnavailable"));
      } else {
        setLarkErr(t("lark.loginFailed"));
      }
    }
  };

  const handleLogout = () => {
    // Revoke session cookie + DB row (fire-and-forget; failure shouldn't block UX)
    deleteSession();
    localStorage.removeItem("router_key");
    localStorage.removeItem("router_handle");
    setLoggedIn(false);
    setKey("");
    setCurrentHandle("");
    setEntries([]);
    setTags([]);
    setTeamName("");
  };

  const handleTagToggle = (tag: string) => {
    setIsSearching(false);
    setSearchQuery("");
    setAuthorFilter(null);
    setCurrentPage(1);
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    setSelectedTags(next);
    fetchData(key, next, null, null);
  };

  const handleSearch = (query: string) => {
    if (!query.trim()) return;
    setSearchQuery(query);
    setIsSearching(true);
    setSelectedTags([]);
    setAuthorFilter(null);
    setCurrentPage(1);
    fetchData(key, [], query.trim(), null);
  };

  const handleClearFilters = () => {
    setIsSearching(false);
    setSearchQuery("");
    setSelectedTags([]);
    setAuthorFilter(null);
    setCurrentPage(1);
    fetchData(key, [], null, null);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    fetchData(key, selectedTags, isSearching ? searchQuery : null, authorFilter, page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleApplyPreset = (p: TagPreset) => {
    setIsSearching(false);
    setSearchQuery("");
    setAuthorFilter(null);
    const isActive =
      selectedTags.length === p.tags.length &&
      p.tags.every((t) => selectedTags.includes(t));
    const next = isActive ? [] : p.tags;
    setSelectedTags(next);
    setCurrentPage(1);
    fetchData(key, next, null, null);
  };

  const handleSavePreset = async () => {
    const name = presetName.trim();
    if (!name || selectedTags.length < 2) return;
    try {
      const p = await saveTagPreset(key, name, selectedTags);
      setPresets(prev => [...prev, p]);
      setSavingPreset(false);
      setPresetName("");
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDeletePreset = (id: string) => setDeletingPresetId(id);

  const confirmDeletePreset = async () => {
    const id = deletingPresetId;
    if (!id) return;
    setDeletingPresetId(null);
    try {
      await deleteTagPreset(key, id);
      setPresets(prev => prev.filter(p => p.id !== id));
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleAuthorClick = (handle: string) => {
    window.location.href = `/profile?handle=${handle}`;
  };

  const handleAuthorFilter = (handle: string) => {
    setIsSearching(false);
    setSearchQuery("");
    setSelectedTags([]);
    setAuthorFilter(handle);
    setCurrentPage(1);
    fetchData(key, [], null, handle);
  };


  const handlePublish = async (entryId: string) => {
    try {
      await publishEntry(key, entryId);
      fetchData(key, selectedTags, isSearching ? searchQuery : null, authorFilter, currentPage);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDelete = async (entryId: string) => {
    try {
      await deleteEntry(key, entryId);
      fetchData(key, selectedTags, isSearching ? searchQuery : null, authorFilter, currentPage);
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Initializing
  if (initializing) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loading />
      </div>
    );
  }

  // Login
  if (!loggedIn) {
    return (
      <div className="fade-up flex-1 flex items-center justify-center px-4">
        <div className="bg-(--card) rounded-2xl shadow-sm border border-(--card-border) p-8 w-full max-w-sm">
          <div className="mb-6">
            <a href="/" className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
            <img src="/logo.png" alt="" width={24} height={24} className="shrink-0 -translate-y-0.5" />
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Router</h1>
          </a>
            <p className="text-sm text-neutral-500 mt-1">{t('login.subtitle')}</p>
          </div>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder={t('login.placeholder')}
            className="w-full text-sm px-4 py-3 rounded-xl border border-neutral-200 focus:outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100 mb-2 placeholder:text-neutral-400 transition-all"
          />
          {loginError && <p className="text-xs text-red-500 mb-3">{loginError}</p>}
          <button onClick={handleLogin}
            className="cursor-pointer w-full bg-(--accent) text-white text-sm font-medium py-3 rounded-xl hover:bg-(--accent-hover) transition-colors">
            {t('login.viewDashboard')}
          </button>
          {features.platforms.includes("lark") && (
            <div className="mt-3">
              <button onClick={handleLarkLogin}
                className="cursor-pointer w-full text-sm font-medium py-3 rounded-xl border border-neutral-200 hover:bg-neutral-50 transition-colors">
                {t("lark.loginButton")}
              </button>
            </div>
          )}
          {features.platforms.includes("lark") && larkErr && <p className="text-xs text-amber-600 mt-3">{larkErr}</p>}
          <div className="mt-6 pt-4 border-t border-neutral-100 text-center">
            <a href="/register" className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors">
              {t('login.noKeyYet')}
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard
  const hasMyEntries = entries.some(e => e.handle === currentHandle);
  const noFiltersActive = selectedTags.length === 0 && !searchQuery && !authorFilter;
  // Guard banner/empty-state behind hasFetchedOnce so they don't flash while the
  // initial request is still in flight. Also require noFiltersActive so neither
  // onboarding UI shows up on a filtered "no results" view — a filtered empty
  // page is NOT the welcome state.
  const showConnectBanner = hasFetchedOnce && !loading && noFiltersActive && !bannerDismissed && !hasMyEntries;
  const showEmptyState = hasFetchedOnce && !loading && entries.length === 0 && noFiltersActive;
  const showNoResults = hasFetchedOnce && !loading && entries.length === 0 && !noFiltersActive;

  return (
    <div className="fade-up flex-1 max-w-2xl mx-auto w-full px-4 sm:px-5 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-6 sm:mb-8 flex items-center justify-between">
        <div>
          <a href="/" className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
            <img src="/logo.png" alt="" width={24} height={24} className="shrink-0 -translate-y-0.5" />
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Router</h1>
          </a>
          {/* <p className="text-[13px] text-neutral-400 mt-0.5">{teamName}</p> */}
        </div>

        {/* Desktop nav.
            `whitespace-nowrap` + `shrink-0` on each item: Safari's flex-item
            min-width default differs from Chrome's, so when the row gets
            tight but still in md+ breakpoint, Safari was wrapping the link
            text into the notification icon (#8 user-test bug). Locking each
            item to its content width prevents the overlap; if total width
            ever exceeds the row, the parent's gap-1 keeps spacing intact
            and the row scrolls / overflows the header (acceptable degrade
            until we add a "More" menu). */}
        <nav className="hidden md:flex items-center gap-1">
          <a href="/notifications" className="relative whitespace-nowrap shrink-0 text-[12px] text-neutral-500 hover:text-neutral-700 px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 transition-all">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </a>
          <a href="/tags" className="whitespace-nowrap shrink-0 text-[12px] text-(--muted) hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-(--accent-light) transition-all">Tags</a>
          <a href="/members" className="whitespace-nowrap shrink-0 text-[12px] text-(--muted) hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-(--accent-light) transition-all">Members</a>
          <a href="/bookmarks" className="whitespace-nowrap shrink-0 text-[12px] text-(--muted) hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-(--accent-light) transition-all">Bookmarks</a>
          <a href="/settings#guide" className="whitespace-nowrap shrink-0 text-[12px] text-(--muted) hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-(--accent-light) transition-all">Guide</a>
          <a href="/settings" className="whitespace-nowrap shrink-0 text-[12px] text-neutral-500 hover:text-neutral-700 px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 transition-all">Settings</a>
          <a href="#" onClick={(e) => {
              e.preventDefault();
              fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/me?key=${key}`)
                .then(r => r.json())
                .then(d => { if (d.handle) window.location.href = `/profile?handle=${d.handle}`; });
            }}
            className="whitespace-nowrap shrink-0 text-[12px] text-neutral-500 hover:text-neutral-700 px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 transition-all">Profile</a>
          <LangToggle />
          <ThemeToggle />
          <button onClick={handleLogout} className="cursor-pointer whitespace-nowrap shrink-0 text-[12px] text-(--muted) hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-(--accent-light) transition-all">
            Logout
          </button>
        </nav>

        {/* Mobile nav toggle */}
        <div className="flex md:hidden items-center gap-2">
          <a href="/notifications" className="relative p-2 text-(--muted) hover:text-foreground">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </a>
          <LangToggle />
          <ThemeToggle />
          <button onClick={() => setMobileNavOpen(v => !v)}
            className="cursor-pointer p-2 text-(--muted) hover:text-foreground rounded-lg hover:bg-(--accent-light)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {mobileNavOpen
                ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
                : <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>
              }
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile nav dropdown */}
      {mobileNavOpen && (
        <nav className="md:hidden mb-4 bg-(--card) rounded-xl border border-(--card-border) overflow-hidden divide-y divide-(--card-border)">
          {[
            { href: "/tags", label: "Tags", icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" },
            { href: "/members", label: "Members", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75" },
            { href: "/bookmarks", label: "Bookmarks", icon: "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" },
            { href: "/settings#guide", label: "Guide", icon: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" },
            { href: "/settings", label: "Settings", icon: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" },
          ].map(item => (
            <a key={item.href} href={item.href}
              className="flex items-center gap-3 px-4 py-3 text-[13px] text-(--muted) hover:text-foreground hover:bg-(--accent-light) transition-all active:bg-(--accent-light)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60">
                <path d={item.icon} />
              </svg>
              {item.label}
            </a>
          ))}
          <a href="#" onClick={(e) => {
              e.preventDefault();
              fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/me?key=${key}`)
                .then(r => r.json())
                .then(d => { if (d.handle) window.location.href = `/profile?handle=${d.handle}`; });
            }}
            className="flex items-center gap-3 px-4 py-3 text-[13px] text-(--muted) hover:text-foreground hover:bg-(--accent-light) transition-all active:bg-(--accent-light)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
            Profile
          </a>
          <button onClick={() => { handleLogout(); setMobileNavOpen(false); }}
            className="cursor-pointer w-full flex items-center gap-3 px-4 py-3 text-[13px] text-red-400 hover:text-red-500 hover:bg-red-50 transition-all active:bg-red-50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Logout
          </button>
        </nav>
      )}

      {mcpUpdateNeeded && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
          <p className="text-xs text-amber-800">
            <strong>{t('dashboard.mcpUpdateTitle')}</strong> — {t('dashboard.mcpUpdateBodyPre')}<a href="/setup" className="underline font-medium">{t('dashboard.mcpUpdateBodyLink')}</a>{t('dashboard.mcpUpdateBodyPost')}
          </p>
          <button
            onClick={() => {
              localStorage.setItem("mcp_schema_version", mcpSchemaVersion);
              setMcpUpdateNeeded(false);
            }}
            className="cursor-pointer text-xs text-amber-600 hover:text-amber-800 font-medium shrink-0 ml-4">
            {t('dashboard.mcpUpdateDismiss')}
          </button>
        </div>
      )}

      {tagMigrationNeeded && (
        <div className="mb-4 bg-(--accent-light) border border-(--accent) rounded-xl p-4 flex items-center justify-between gap-4">
          <p className="text-xs text-(--muted) leading-relaxed">
            <span className="mr-1">🔀</span>
            <strong className="text-foreground">{t('dashboard.tagMigrationTitle')}</strong> — {t('dashboard.tagMigrationBody')}
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <a
              href="/tags"
              onClick={() => {
                localStorage.setItem("tag_migration_announcement_dismissed", "1");
                setTagMigrationNeeded(false);
              }}
              className="text-xs font-medium text-(--accent) hover:text-(--accent-hover) whitespace-nowrap"
            >
              {t('dashboard.tagMigrationCta')}
            </a>
            <button
              onClick={() => {
                localStorage.setItem("tag_migration_announcement_dismissed", "1");
                setTagMigrationNeeded(false);
              }}
              className="cursor-pointer text-xs text-(--muted) hover:text-foreground font-medium whitespace-nowrap"
            >
              {t('dashboard.tagMigrationDismiss')}
            </button>
          </div>
        </div>
      )}

      {showConnectBanner && (
        <div className="mb-6 bg-(--card) rounded-2xl border border-(--card-border) p-5 relative">
          <button
            onClick={dismissBanner}
            aria-label={t('common.close')}
            className="cursor-pointer absolute top-3 right-3 text-(--muted-light) hover:text-foreground text-lg leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-(--accent-light)">
            ×
          </button>
          <div className="flex items-start gap-3">
            <div className="text-2xl">👋</div>
            <div className="flex-1 pr-6">
              <h2 className="text-[14px] font-semibold text-foreground mb-1">{t('dashboard.welcomeTitle')}</h2>
              <p className="text-[12px] text-(--muted) leading-relaxed mb-3">
                {t('dashboard.welcomeBody')}
              </p>
              <a href="/settings#connect"
                className="inline-block text-[12px] font-medium bg-(--accent) text-white px-3 py-1.5 rounded-lg hover:bg-(--accent-hover) transition-colors">
                {t('dashboard.connectClaude')}
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Pinned tag presets — visually distinct from regular tags: filled accent-tinted */}
      {presets.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 pb-3 border-b border-dashed border-(--card-border)">
          <span className="text-[10px] uppercase tracking-[0.12em] text-(--muted-light) font-mono mr-1">{t('dashboard.pinned')}</span>
          {presets.map((p) => {
            const active =
              selectedTags.length === p.tags.length &&
              p.tags.every((t) => selectedTags.includes(t));
            return (
              <span key={p.id} className="group relative inline-flex items-center">
                <button
                  onClick={() => handleApplyPreset(p)}
                  className={`cursor-pointer text-[11px] font-medium pl-2.5 pr-6 py-1 rounded-full transition-all ${
                    active
                      ? "bg-(--accent) text-white shadow-sm"
                      : "bg-(--info) text-(--info-text) hover:brightness-95"
                  }`}
                  title={p.tags.map((t) => "#" + t).join(" ")}
                >
                  <span className="mr-1">★</span>
                  {p.name}
                </button>
                <button
                  onClick={() => handleDeletePreset(p.id)}
                  className={`cursor-pointer absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-[11px] leading-none opacity-0 group-hover:opacity-100 transition-opacity ${
                    active ? "text-white/70 hover:text-white hover:bg-white/15" : "text-(--info-text)/60 hover:text-(--danger) hover:bg-white/40"
                  }`}
                  aria-label={t('dashboard.deletePreset')}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="mb-6">
          <TagBar
            tags={tags}
            selected={selectedTags}
            onToggle={handleTagToggle}
            presetNames={presetTagSet}
            presetDescriptions={presetTagMap}
          />
          {selectedTags.length >= 2 && (
            <div className="mt-2">
              {savingPreset ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSavePreset();
                      if (e.key === "Escape") { setSavingPreset(false); setPresetName(""); }
                    }}
                    placeholder={t('dashboard.presetNameForCount', { n: selectedTags.length })}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-(--card-border) bg-(--card) focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) transition-all w-56"
                  />
                  <button
                    onClick={handleSavePreset}
                    disabled={!presetName.trim()}
                    className="cursor-pointer text-[11px] font-medium px-3 py-1 rounded-full bg-(--accent) text-white hover:bg-(--accent-hover) disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {t('common.save')}
                  </button>
                  <button
                    onClick={() => { setSavingPreset(false); setPresetName(""); }}
                    className="cursor-pointer text-[11px] text-(--muted) hover:text-foreground px-2 py-1 rounded transition-all"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setSavingPreset(true)}
                  className="cursor-pointer text-[11px] text-(--muted) hover:text-(--accent) px-2 py-1 rounded transition-all inline-flex items-center gap-1"
                >
                  <span>★</span> {t('dashboard.pinTheseTags', { n: selectedTags.length })}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filter indicator */}
      {(isSearching || authorFilter) && (
        <div className="mb-5 flex items-center gap-2 text-[13px] text-neutral-500">
          {isSearching && <span>{t('dashboard.resultsFor')} &ldquo;<strong className="text-neutral-700">{searchQuery}</strong>&rdquo;</span>}
          {authorFilter && <span>{t('dashboard.entriesBy')} <strong className="text-neutral-700">@{authorFilter}</strong></span>}
        </div>
      )}

      {/* Entries */}
      {loading ? (
        <Loading className="py-24" />
      ) : entries.length === 0 ? (
        showEmptyState ? (
          <div className="text-center py-20 max-w-md mx-auto">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-(--tag-bg) flex items-center justify-center text-(--muted)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-[14px] font-medium text-foreground mb-1">{t('dashboard.noEntriesYet')}</p>
            <p className="text-[12px] text-(--muted) mb-4 leading-relaxed">
              {t('dashboard.noEntriesBody')}
            </p>
            <ol className="text-left text-[12px] text-(--muted) inline-block mb-5 space-y-1">
              <li>1. {t('dashboard.step1')}</li>
              <li>2. {t('dashboard.step2')}</li>
              <li>3. {t('dashboard.step3')}</li>
            </ol>
            <div>
              <a href="/settings#connect"
                className="inline-block text-[12px] font-medium bg-(--accent) text-white px-4 py-2 rounded-lg hover:bg-(--accent-hover) transition-colors">
                {t('dashboard.connectClaude')}
              </a>
            </div>
          </div>
        ) : showNoResults ? (
          <div className="text-center py-24">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-(--tag-bg) flex items-center justify-center text-(--muted)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground">{t('dashboard.noResults')}</p>
            <p className="text-xs text-(--muted) mt-1">
              {selectedTags.length > 0 && <>{t('dashboard.filteredBy')} {selectedTags.map(tg => `#${tg}`).join(' ')}</>}
              {authorFilter && <> · @{authorFilter}</>}
              {searchQuery && <> · &ldquo;{searchQuery}&rdquo;</>}
            </p>
            <button
              onClick={() => {
                setSelectedTags([]);
                setAuthorFilter(null);
                setSearchQuery("");
                setIsSearching(false);
                fetchData(key, [], null, null);
              }}
              className="cursor-pointer mt-4 text-xs text-(--accent) hover:underline">
              {t('dashboard.clearFilters')}
            </button>
          </div>
        ) : null
      ) : (
        <div className="space-y-6">
          {groupByLocalDate(entries, lang, t).map((group) => (
            <section key={group.key}>
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
                  {group.label}
                </h2>
                <span className="flex-1 h-px bg-(--card-border)" />
              </div>
              <div className="space-y-4">
                {group.items.map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    currentHandle={currentHandle}
                    isAdmin={isAdmin}
                    onAuthorClick={handleAuthorClick}
                    onPublish={handlePublish}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </section>
          ))}
          {totalEntries > PAGE_SIZE && (
            <Pagination current={currentPage} total={Math.ceil(totalEntries / PAGE_SIZE)} onChange={handlePageChange} />
          )}
        </div>
      )}

      <SearchFloat
        onSearch={handleSearch}
        onAuthorSearch={handleAuthorFilter}
        onClear={handleClearFilters}
        hasActiveFilter={isSearching || selectedTags.length > 0 || !!authorFilter}
      />
      <FeedbackFloat />

      <ConfirmDialog
        open={!!deletingPresetId}
        title={t('dashboard.deletePresetTitle')}
        message={t('dashboard.deletePresetBody')}
        confirmText={t('common.delete')}
        onConfirm={confirmDeletePreset}
        onCancel={() => setDeletingPresetId(null)}
      />

      {/* Notification toast */}
      <Toast
        message={notifToast || ""}
        open={!!notifToast}
        onClose={() => setNotifToast(null)}
        duration={5000}
        variant="notification"
        onClick={() => { window.location.href = "/notifications"; }}
      />

    </div>
  );
}
