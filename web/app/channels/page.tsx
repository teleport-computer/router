"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  getChannels,
  getChannel,
  getChannelEntries,
  getChannelTimeline,
  createChannel,
  deleteChannel,
  addChannelSkill,
  updateChannelSkill,
  removeChannelSkill,
  publishEntry,
  deleteEntry,
  type Channel,
  type RouterEntry,
  type Skill,
  type TimelineDays,
} from "@/lib/api";
import EntryCard from "../components/EntryCard";
import Loading from "../components/Loading";
import ConfirmDialog from "../components/ConfirmDialog";
import Toast from "../components/Toast";
import SkillForm, { type SkillFormValues } from "./SkillForm";
import ChannelFilterBar, { applyFilters, DEFAULT_FILTER_STATE, type FilterState } from "./ChannelFilterBar";
import LarkBindingsPanel from "./LarkBindingsPanel";
import { useT } from "@/lib/i18n";
import { useServerInfo } from "@/lib/server-info";

type Tab = 'entries' | 'timeline' | 'skills' | 'lark';

// Mirrors server/src/timeline-tags.ts — keep in sync.
const TIMELINE_NODE_TAGS: ReadonlySet<string> = new Set(['decision', 'milestone', 'shipped', 'release', 'incident', 'retro']);

export default function ChannelsPage() {
  const t = useT();
  const { features } = useServerInfo();
  const [key, setKey] = useState("");
  const [currentHandle, setCurrentHandle] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [channelEntries, setChannelEntries] = useState<RouterEntry[]>([]);
  const [timelineEntries, setTimelineEntries] = useState<RouterEntry[]>([]);
  const [timelineDays, setTimelineDays] = useState<TimelineDays>(30);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [channelLoading, setChannelLoading] = useState(false);
  const [error, setError] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const [activeTab, setActiveTab] = useState<Tab>('entries');
  const [showSkillForm, setShowSkillForm] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [confirmDeleteChannel, setConfirmDeleteChannel] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTER_STATE);
  const [toast, setToast] = useState<{ open: boolean; message: string }>({ open: false, message: "" });
  const [runningDigest, setRunningDigest] = useState<string | null>(null); // skill.id being run
  const [isAdmin, setIsAdmin] = useState(false);
  // null = checking; true = ?key= or cookie session valid; false = neither
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    // Hash unification: when the URL targets a specific channel by id, jump
    // straight to its tag-detail page. Old `?id=feedling` bookmarks resolve
    // to `/tags/feedling`. The bare `/channels` page stays as the admin
    // skill / Lark binding console.
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const targetId = params.get('id');
      if (targetId) {
        window.location.replace(`/tags/${encodeURIComponent(targetId)}`);
        return;
      }
    }
    // M2a.5: ?key= preferred, cookie session is the fallback. The presence
    // of localStorage `router_key` is NOT a reliable login signal — Lark
    // re-login sets a cookie but no key. Treat /api/me as the source of truth.
    const savedKey = localStorage.getItem("router_key") || "";
    const savedHandle = localStorage.getItem("router_handle");
    setKey(savedKey);
    if (savedHandle) setCurrentHandle(savedHandle);
    const keyQuery = savedKey ? `?key=${savedKey}` : "";
    fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/me${keyQuery}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setAuthed(true);
          if (d.isAdmin) setIsAdmin(true);
          if (d.handle && !savedHandle) setCurrentHandle(d.handle);
          loadChannels(savedKey);
        } else {
          setAuthed(false);
        }
      })
      .catch(() => setAuthed(false));
  }, []);

  const loadChannels = async (k: string) => {
    setLoading(true);
    try {
      const list = await getChannels(k);
      setChannels(list || []);
      if (list && list.length > 0) {
        // Restore from URL ?id=xxx if it matches an existing channel,
        // otherwise fall back to first non-feedback channel.
        const urlId = new URLSearchParams(window.location.search).get('id');
        const urlMatch = urlId ? list.find(c => c.id === urlId) : null;
        const defaultPick = urlMatch || list.find(c => c.id !== 'feedback') || list[0];
        selectChannel(defaultPick.id, k);
      }
    } catch {
      setError(t("channels.errorLoadChannels"));
    }
    setLoading(false);
  };

  const selectChannel = async (id: string, k?: string) => {
    setFilters(DEFAULT_FILTER_STATE);
    const activeKey = k || key;
    setChannelLoading(true);
    try {
      const [ch, entries] = await Promise.all([
        getChannel(activeKey, id),
        getChannelEntries(activeKey, id),
      ]);
      setSelectedChannel(ch);
      setChannelEntries(entries);
      setActiveTab('entries');
      const url = new URL(window.location.href);
      if (url.searchParams.get('id') !== id) {
        url.searchParams.set('id', id);
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      setError(t("channels.errorLoadChannel"));
    }
    setChannelLoading(false);
  };

  useEffect(() => {
    if (!key || !selectedChannel || activeTab !== 'timeline') return;
    let cancelled = false;
    setTimelineLoading(true);
    getChannelTimeline(key, selectedChannel.id, timelineDays)
      .then(list => { if (!cancelled) setTimelineEntries(list); })
      .catch(() => { if (!cancelled) setTimelineEntries([]); })
      .finally(() => { if (!cancelled) setTimelineLoading(false); });
    return () => { cancelled = true; };
  }, [key, selectedChannel?.id, activeTab, timelineDays]);

  const handlePublish = async (entryId: string) => {
    try {
      await publishEntry(key, entryId);
      if (selectedChannel) selectChannel(selectedChannel.id);
    } catch (e: any) { alert(e.message); }
  };

  const handleDeleteEntry = async (entryId: string) => {
    try {
      await deleteEntry(key, entryId);
      if (selectedChannel) selectChannel(selectedChannel.id);
    } catch (e: any) { alert(e.message); }
  };

  const handleCreate = async () => {
    setError("");
    try {
      await createChannel(key, { id: newId, name: newName, description: newDesc || undefined });
      setShowCreate(false);
      setNewId(""); setNewName(""); setNewDesc("");
      await loadChannels(key);
    } catch (e: any) { setError(e.message); }
  };

  const handleSubmitSkill = async (values: SkillFormValues) => {
    if (!selectedChannel) return;
    if (editingSkill) {
      await updateChannelSkill(key, selectedChannel.id, editingSkill.name, {
        description: values.description,
        instructions: values.instructions,
        exposeAs: values.exposeAs,
        triggers: values.triggers,
        effects: values.effects,
        ...(values.digestConfig ? { digestConfig: values.digestConfig } : {}),
      });
    } else {
      await addChannelSkill(key, selectedChannel.id, values);
    }
    setShowSkillForm(false);
    setEditingSkill(null);
    await selectChannel(selectedChannel.id);
  };

  const handleRemoveSkill = async (name: string) => {
    if (!selectedChannel) return;
    await removeChannelSkill(key, selectedChannel.id, name);
    await selectChannel(selectedChannel.id);
  };

  if (authed === null || (authed && loading)) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loading />
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-(--muted-light)">{t("channels.notLoggedIn")} <a href="/" className="underline">{t("channels.dashboardLink")}</a></p>
      </div>
    );
  }

  return (
    <div className="fade-up flex-1 max-w-2xl mx-auto w-full px-4 sm:px-5 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground italic">{t("channels.title")}</h1>
        </div>
        <nav className="flex items-center gap-1">
          <button onClick={() => setShowCreate(true)}
            className="text-[12px] font-medium bg-(--accent) text-white px-3 py-1.5 rounded-lg hover:bg-(--accent-hover) transition-colors">
            {t("channels.createHeader")}
          </button>
          <a href="/members" className="text-[12px] text-(--muted) hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-(--accent-light) transition-all">{t("nav.members")}</a>
          <a href="/" className="text-[12px] text-(--muted) hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-(--accent-light) transition-all">{t("nav.dashboard")}</a>
        </nav>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-[12px] rounded-xl">{error}</div>}

      {/* Create channel form */}
      {showCreate && (
        <div className="mb-6 bg-(--card) rounded-2xl border border-(--card-border) p-5">
          <h2 className="text-[13px] font-semibold mb-4">{t("channels.createChannelTitle")}</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[11px] font-medium text-(--muted) mb-1">{t("channels.channelId")}</label>
              <input type="text" value={newId}
                onChange={(e) => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder={t("channels.channelIdPlaceholder")} maxLength={30}
                className="w-full text-[13px] px-3 py-2 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) transition-all" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-(--muted) mb-1">{t("channels.displayName")}</label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder={t("channels.displayNamePlaceholderShort")}
                className="w-full text-[13px] px-3 py-2 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) transition-all" />
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-[11px] font-medium text-(--muted) mb-1">{t("channels.description")}</label>
            <input type="text" value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
              placeholder={t("channels.descriptionPlaceholderAbout")}
              className="w-full text-[13px] px-3 py-2 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) transition-all" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={!newId || !newName}
              className="text-[12px] font-medium bg-(--accent) text-white px-4 py-2 rounded-lg hover:bg-(--accent-hover) disabled:opacity-40 transition-colors">{t("common.create")}</button>
            <button onClick={() => setShowCreate(false)} className="text-[12px] text-(--muted-light) px-4 py-2 cursor-pointer">{t("common.cancel")}</button>
          </div>
        </div>
      )}

      {/* Channel tabs — text-style nav, visually distinct from tag pills */}
      {channels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-6 border-b border-(--card-border) pb-1">
          {[...channels]
            .sort((a, b) => {
              if (a.id === 'feedback' && b.id !== 'feedback') return 1;
              if (b.id === 'feedback' && a.id !== 'feedback') return -1;
              return 0;
            })
            .map((ch) => {
              const isActive = selectedChannel?.id === ch.id;
              return (
                <button key={ch.id} onClick={() => selectChannel(ch.id)}
                  className={`cursor-pointer text-[13px] font-mono px-3 py-2 relative transition-colors duration-200 active:scale-95 ${
                    isActive
                      ? "text-purple-600 dark:text-purple-400 font-semibold"
                      : "text-(--muted) hover:text-foreground"
                  }`}>
                  #{ch.id}
                  <span className={`absolute bottom-0 left-1 right-1 h-0.5 rounded-full transition-all duration-300 ${
                    isActive
                      ? "bg-purple-500 dark:bg-purple-400 opacity-100 scale-x-100"
                      : "bg-transparent opacity-0 scale-x-0"
                  }`} />
                </button>
              );
            })}
        </div>
      )}

      {/* Channel content */}
      {channelLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loading />
        </div>
      ) : selectedChannel ? (
        <div className="animate-in fade-in duration-200">
          {/* Channel header */}
          <div className="bg-(--card) rounded-2xl border border-(--card-border) p-5 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-semibold">#{selectedChannel.id} <span className="font-normal text-(--muted)">— {selectedChannel.name}</span></h2>
                {selectedChannel.description && <p className="text-[12px] text-(--muted) mt-0.5">{selectedChannel.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button onClick={() => setConfirmDeleteChannel(true)}
                    className="cursor-pointer text-[11px] text-(--muted-light) hover:text-red-500 px-3 py-1.5 rounded-lg border border-(--card-border) hover:border-red-300 transition-all"
                    title={t("channels.deleteChannelHoverTitle")}>
                    {t("channels.deleteChannel")}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Tabs */}
          {(() => {
            const tabs: Array<[Tab, string]> = [
              ['entries', t("channels.tabEntriesWithCount", { n: channelEntries.length })],
              ['timeline', t("channels.tabTimelineWithCount", { n: timelineEntries.length })],
              ['skills', t("channels.tabSkillsWithCount", { n: selectedChannel.skills.length })],
            ];
            if (features.platforms.includes("lark")) tabs.push(['lark', 'Lark']);
            return (
              <div className="flex border-b border-(--card-border) mb-4 gap-1">
                {tabs.map(([id, label]) => (
                  <button key={id}
                    onClick={() => setActiveTab(id)}
                    className={`cursor-pointer px-4 py-2 text-[12px] font-medium border-b-2 transition-colors ${
                      activeTab === id
                        ? 'border-(--accent) text-(--accent)'
                        : 'border-transparent text-(--muted) hover:text-foreground'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
            );
          })()}

          <div key={activeTab} className="fade-up">
          {/* Entries tab */}
          {activeTab === 'entries' && (
            <div>
              <div className="flex justify-end mb-3">
                <button onClick={() => selectChannel(selectedChannel.id)}
                  className="cursor-pointer text-[11px] text-(--muted-light) hover:text-(--muted) flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-(--accent-light) transition-all"
                  title={t("common.retry")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              </div>
              {channelEntries.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-[13px] text-(--muted-light)">{t("channels.noEntriesInChannel")}</p>
                  <p className="text-[11px] text-(--muted-light) mt-1">{t("channels.syncHint", { id: selectedChannel.id })}</p>
                </div>
              ) : (
                <>
                  <ChannelFilterBar entries={channelEntries} value={filters} onChange={setFilters} />
                  {(() => {
                    const visibleEntries = applyFilters(channelEntries, filters);
                    if (visibleEntries.length === 0) {
                      return (
                        <div className="text-center py-12">
                          <p className="text-[13px] text-(--muted-light)">{t("channels.filter.noMatches")}</p>
                          <button type="button" onClick={() => setFilters(DEFAULT_FILTER_STATE)}
                            className="cursor-pointer mt-2 text-[11px] text-(--accent) underline underline-offset-2">
                            {t("channels.filter.clear")}
                          </button>
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-4">
                        {visibleEntries.map((entry) => (
                          <EntryCard
                            key={entry.id}
                            entry={entry}
                            currentHandle={currentHandle}
                            isAdmin={isAdmin}
                            onPublish={handlePublish}
                            onDelete={handleDeleteEntry}
                            onAuthorClick={(h) => window.location.href = `/profile?handle=${h}`}
                          />
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          {/* Timeline tab */}
          {activeTab === 'timeline' && (
            <div>
              <div className="flex justify-between items-center mb-3">
                <div className="flex gap-1">
                  {([7, 30, 90] as const).map((d) => (
                    <button key={d}
                      onClick={() => setTimelineDays(d)}
                      className={`cursor-pointer px-3 py-1 text-[12px] rounded-md border transition-colors ${
                        timelineDays === d
                          ? 'border-(--accent) text-(--accent) bg-(--accent-light)'
                          : 'border-(--card-border) text-(--muted) hover:text-foreground'
                      }`}>
                      {t(d === 7 ? 'channels.timelineDays7' : d === 30 ? 'channels.timelineDays30' : 'channels.timelineDays90')}
                    </button>
                  ))}
                </div>
              </div>

              {timelineLoading ? (
                <div className="text-center py-12">
                  <p className="text-[13px] text-(--muted-light)">{t("common.loading")}</p>
                </div>
              ) : timelineEntries.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-[13px] text-(--muted-light)">
                    {t("channels.timelineEmpty", { days: String(timelineDays) })}
                  </p>
                  <p className="text-[11px] text-(--muted-light) mt-2">{t("channels.timelineHint")}</p>
                </div>
              ) : (
                <div className="relative pl-8">
                  {/* vertical rail — centered at left = 12px so the dot's center aligns */}
                  <div className="absolute left-3 top-2 bottom-2 w-px bg-(--card-border)" aria-hidden />
                  <div className="space-y-4">
                    {timelineEntries.map((entry) => {
                      const nodeTags = (entry.tags || []).filter(tag => TIMELINE_NODE_TAGS.has(tag));
                      return (
                        <div key={entry.id} className="relative">
                          {/* dot — w-2.5 (10px) centered at -left-[19px] = card_left(-pl-8/32px) ... center = 32-19-5 = 8? recompute */}
                          {/* Card sits inside pl-8 (left padding 32). Rail center is at 12px. Dot is 10px → centered when its left = 7. From card's edge that's -25. */}
                          <span
                            className="absolute -left-[25px] top-3 inline-block w-2.5 h-2.5 rounded-full bg-(--accent) ring-2 ring-background"
                            aria-hidden
                          />
                          {nodeTags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1.5">
                              {nodeTags.map(nt => (
                                <span key={nt}
                                  className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-(--accent-light) text-(--accent) border border-(--accent)/20">
                                  {nt}
                                </span>
                              ))}
                            </div>
                          )}
                          <EntryCard
                            entry={entry}
                            currentHandle={currentHandle}
                            isAdmin={isAdmin}
                            onPublish={handlePublish}
                            onDelete={handleDeleteEntry}
                            onAuthorClick={(h) => window.location.href = `/profile?handle=${h}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Skills tab */}
          {activeTab === 'skills' && (
            <div>
              {selectedChannel.skills.length === 0 ? (
                <div className="text-center py-12 mb-3">
                  <p className="text-[13px] text-(--muted-light)">{t("channels.noSkillsYet")}</p>
                  <p className="text-[11px] text-(--muted-light) mt-1">{t("channels.noSkillsHint")}</p>
                </div>
              ) : (
                <div className="space-y-2 mb-3">
                  {selectedChannel.skills
                    .filter(s => s.exposeAs === 'prewrite' || s.exposeAs === 'digest' || (s.effects && s.effects.length > 0))
                    .map((skill) => {
                      const isRewrite = skill.exposeAs === 'prewrite';
                      const isDigest = skill.exposeAs === 'digest';
                      const isWebhook = !isRewrite && !isDigest && !!(skill.effects && skill.effects.length > 0);
                      const trigger = skill.triggers?.find(tr => tr.type === 'on_entry_write');
                      const tagFilter = trigger?.type === 'on_entry_write' ? trigger.filter?.tags : undefined;
                      const authorFilter = trigger?.type === 'on_entry_write' ? trigger.filter?.authors : undefined;
                      return (
                    <div key={skill.name} className="bg-(--card) border border-(--card-border) rounded-2xl p-4 group">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{isDigest ? '📊' : isRewrite ? '📖' : '🔔'}</span>
                            <p className="text-[13px] font-semibold text-foreground">{skill.name}</p>
                            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                              isDigest ? 'bg-green-100 text-green-700' : isRewrite ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                              {isDigest ? t("channels.skillBadgeDigest") : isRewrite ? t("channels.skillBadgeRewrite") : t("channels.skillBadgeWebhook")}
                            </span>
                            {isDigest && skill.digestConfig && (
                              <span className="text-[10px] text-(--muted-light)">
                                {skill.digestConfig.schedule === 'monthly' ? t("skillForm.digestMonthly") : t("skillForm.digestWeekly")}
                              </span>
                            )}
                          </div>
                          {skill.description && <p className="text-[12px] text-(--muted) mt-1">{skill.description}</p>}

                          {/* Rewrite preview */}
                          {isRewrite && skill.instructions && (
                            <p className="text-[11px] text-(--muted) mt-1.5 line-clamp-2 whitespace-pre-line">
                              {skill.instructions}
                            </p>
                          )}

                          {/* Digest details */}
                          {isDigest && skill.digestConfig && (
                            <div className="text-[11px] text-(--muted) mt-1.5">
                              {skill.digestConfig.lastRunAt && (
                                <p>{t("channels.digestLastRun")}: {new Date(skill.digestConfig.lastRunAt).toLocaleDateString()}</p>
                              )}
                              {skill.digestConfig.webhookUrl && (
                                <p className="font-mono truncate text-green-500 mt-0.5">→ {skill.digestConfig.webhookUrl.slice(0, 50)}…</p>
                              )}
                            </div>
                          )}

                          {/* Webhook details */}
                          {isWebhook && (
                            <>
                              <p className="text-[11px] text-blue-500 mt-1.5 font-mono truncate">
                                → {skill.effects![0].url.slice(0, 60)}{skill.effects![0].url.length > 60 ? '…' : ''}
                              </p>
                              {(tagFilter?.length || authorFilter?.length) ? (
                                <p className="text-[11px] text-(--muted) mt-1">
                                  <span className="text-(--muted-light)">{t("channels.filterLabel")}</span>{' '}
                                  {tagFilter?.length ? tagFilter.map(tag => `#${tag}`).join(' ') : ''}
                                  {tagFilter?.length && authorFilter?.length ? ` ${t("channels.skillFilterOr")} ` : ''}
                                  {authorFilter?.length ? authorFilter.map(a => `@${a}`).join(' ') : ''}
                                </p>
                              ) : (
                                <p className="text-[11px] text-(--muted-light) mt-1">{t("channels.filterLabel")} {t("channels.filterAll")}</p>
                              )}
                            </>
                          )}
                        </div>
                        <div className="flex gap-2 ml-3 shrink-0">
                          {isDigest && (
                            <button
                              disabled={runningDigest === skill.id}
                              onClick={async () => {
                                const API = process.env.NEXT_PUBLIC_API_URL || "";
                                setRunningDigest(skill.id);
                                setToast({ open: true, message: t("channels.digestRunning") });
                                try {
                                  const res = await fetch(`${API}/api/channels/${selectedChannel.id}/digest${key ? `?key=${key}` : ""}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
                                  if (res.ok) {
                                    const data = await res.json().catch(() => ({}));
                                    setToast({ open: true, message: data.digest === null ? (data.message || t("channels.digestEmpty")) : t("channels.digestDone") });
                                    await selectChannel(selectedChannel.id);
                                  } else {
                                    const d = await res.json().catch(() => ({}));
                                    setToast({ open: true, message: d.error || t("channels.digestFailed") });
                                  }
                                } catch {
                                  setToast({ open: true, message: t("channels.digestFailed") });
                                } finally {
                                  setRunningDigest(null);
                                }
                              }}
                              className="cursor-pointer text-[11px] text-green-600 hover:text-green-700 disabled:opacity-50 disabled:cursor-wait">
                              {runningDigest === skill.id ? t("common.loading") : t("channels.runDigest")}
                            </button>
                          )}
                          <button onClick={() => { setEditingSkill(skill); setShowSkillForm(true); }}
                            className="cursor-pointer text-[11px] text-(--muted) hover:text-foreground">{t("channels.editSkill")}</button>
                          <button onClick={() => handleRemoveSkill(skill.name)}
                            className="cursor-pointer text-[11px] text-red-400 hover:text-red-600">{t("channels.removeSkill")}</button>
                        </div>
                      </div>
                    </div>
                      );
                    })}
                </div>
              )}

              <button onClick={() => { setEditingSkill(null); setShowSkillForm(true); }}
                className="cursor-pointer w-full text-[12px] text-(--muted) border border-dashed border-(--card-border) hover:border-(--accent) hover:text-foreground rounded-2xl py-3 transition-colors">
                + {t("channels.createSkill")}
              </button>
            </div>
          )}

          {activeTab === 'lark' && features.platforms.includes("lark") && (
            <LarkBindingsPanel channelId={selectedChannel.id} availableChannels={channels} />
          )}
          </div>
        </div>
      ) : loading ? (
        <Loading className="py-24" />
      ) : channels.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-[13px] text-(--muted-light)">{t("channels.noChannels")}</p>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDeleteChannel}
        title={t("channels.deleteChannelTitle", { id: selectedChannel?.id ?? '' })}
        message={t("channels.deleteChannelBody")}
        confirmText={t("channels.deleteChannelConfirm")}
        onCancel={() => setConfirmDeleteChannel(false)}
        onConfirm={async () => {
          if (!selectedChannel) return;
          const id = selectedChannel.id;
          setConfirmDeleteChannel(false);
          try {
            await deleteChannel(key, id);
            setSelectedChannel(null);
            await loadChannels(key);
          } catch (e) {
            setError(e instanceof Error ? e.message : t("channels.errorDeleteChannel"));
          }
        }}
      />

      {showSkillForm && (
        <SkillFormModal
          mode={editingSkill ? 'edit' : 'create'}
          initial={editingSkill}
          onCancel={() => { setShowSkillForm(false); setEditingSkill(null); }}
          onSubmit={handleSubmitSkill}
        />
      )}

      <Toast
        open={toast.open}
        message={toast.message}
        duration={2500}
        onClose={() => setToast(s => ({ ...s, open: false }))}
      />
    </div>
  );
}

function SkillFormModal({
  mode, initial, onCancel, onSubmit,
}: {
  mode: 'create' | 'edit';
  initial: Skill | null;
  onCancel: () => void;
  onSubmit: (values: SkillFormValues) => Promise<void>;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto py-8 animate-in fade-in duration-150">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-2xl mx-4 animate-in fade-in zoom-in-95 duration-150">
        <SkillForm
          mode={mode}
          initial={initial || undefined}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      </div>
    </div>,
    document.body,
  );
}
