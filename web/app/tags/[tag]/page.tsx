"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import EntryCard from "@/app/components/EntryCard";
import Loading from "@/app/components/Loading";
import ConfirmDialog from "@/app/components/ConfirmDialog";
import SkillForm, { type SkillFormValues } from "@/app/channels/SkillForm";
import LarkBindingsPanel from "@/app/channels/LarkBindingsPanel";
import {
  getTag,
  listTags,
  publishEntry,
  deleteEntry,
  addTagSkill,
  updateTagSkill,
  removeTagSkill,
  type TagConfig,
  type RouterEntry,
  type Skill,
  type Channel,
} from "@/lib/api";
import { useServerInfo } from "@/lib/server-info";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export default function TagDetailPage({ params }: { params: Promise<{ tag: string }> }) {
  const router = useRouter();
  const { features } = useServerInfo();
  const { tag: rawTag } = use(params);
  const tag = decodeURIComponent(rawTag);

  const [key, setKey] = useState("");
  const [currentHandle, setCurrentHandle] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [config, setConfig] = useState<TagConfig | null>(null);
  const [entries, setEntries] = useState<RouterEntry[]>([]);
  const [availableTags, setAvailableTags] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showSkillForm, setShowSkillForm] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [confirmDeleteSkill, setConfirmDeleteSkill] = useState<string | null>(null);
  // Settings panels (skills, Lark) collapsed by default — most visitors come
  // to read entries, not to configure. One click to expand when needed.
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [larkOpen, setLarkOpen] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem("router_key") || "";
    const savedHandle = localStorage.getItem("router_handle") || "";
    setKey(savedKey);
    setCurrentHandle(savedHandle);

    const keyQuery = savedKey ? `?key=${savedKey}` : "";
    fetch(`${API_URL}/api/me${keyQuery}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.isAdmin) setIsAdmin(true); })
      .catch(() => { /* */ });

    // Fetch tag list once for the Lark binding "archive target" dropdown.
    // LarkBindingsPanel expects Channel-shaped rows; map TagConfig → Channel.
    listTags(savedKey)
      .then(list => setAvailableTags(list.map(t => ({
        id: t.tag,
        teamId: t.teamId,
        name: t.name ?? t.tag,
        description: t.description,
        skills: t.skills,
        subscribers: t.subscribers,
      }))))
      .catch(() => { /* dropdown stays empty */ });

    refresh(savedKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag]);

  async function refresh(k?: string) {
    setLoading(true);
    try {
      const detail = await getTag(k ?? key, tag);
      setConfig(detail.config);
      setEntries(detail.entries);
    } catch (e: any) {
      setError(e?.message || "Failed to load tag");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitSkill(values: SkillFormValues) {
    try {
      if (editingSkill) {
        await updateTagSkill(key, tag, editingSkill.name, {
          description: values.description,
          instructions: values.instructions,
          exposeAs: values.exposeAs,
          triggers: values.triggers,
          effects: values.effects,
          ...(values.digestConfig ? { digestConfig: values.digestConfig } : {}),
        });
      } else {
        await addTagSkill(key, tag, values);
      }
      setShowSkillForm(false);
      setEditingSkill(null);
      await refresh();
    } catch (e: any) {
      throw e;
    }
  }

  async function handleDeleteSkill(skillName: string) {
    await removeTagSkill(key, tag, skillName);
    setConfirmDeleteSkill(null);
    await refresh();
  }

  async function handlePublish(entryId: string) {
    await publishEntry(key, entryId);
    await refresh();
  }

  async function handleDelete(entryId: string) {
    await deleteEntry(key, entryId);
    setEntries(prev => prev.filter(e => e.id !== entryId));
  }

  if (loading) return <Loading />;
  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-6 sm:p-8">
        <p className="text-red-500">{error}</p>
        <button onClick={() => router.back()} className="text-xs text-(--muted) hover:text-(--accent) underline mt-3">
          ← Back
        </button>
      </div>
    );
  }

  const skillCount = config?.skills.length ?? 0;

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8">
      <header className="mb-6">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-bold font-mono">#{tag}</h1>
          {config?.name && config.name !== tag && (
            <span className="text-sm text-(--muted)">{config.name}</span>
          )}
        </div>
        {config?.description && (
          <p className="text-sm text-(--muted) mt-1">{config.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-3 mt-3 text-[12px] text-(--muted-light)">
          <span>{skillCount} skill{skillCount === 1 ? '' : 's'}</span>
          <span>·</span>
          <span>{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</span>
        </div>
      </header>

      {/* Skill block — collapsed by default. Anyone in the team can attach
          a webhook / prewrite / digest skill to any tag; no admin gate. */}
      <section className="mb-3 rounded-2xl border border-(--card-border) bg-(--card)">
        <button
          type="button"
          onClick={() => setSkillsOpen(v => !v)}
          className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-(--accent-light) rounded-2xl transition-colors"
        >
          <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
            <h2 className="text-[13px] font-semibold text-(--muted) shrink-0">
              Skills <span className="text-(--muted-light) font-normal">({config?.skills?.length ?? 0})</span>
            </h2>
            <span className="text-[11px] text-(--muted-light) truncate">
              Webhooks, prewrite rules, digest schedules (formerly "channel skills")
            </span>
          </div>
          <span className="text-[10px] text-(--muted-light) shrink-0">{skillsOpen ? '▴' : '▾'}</span>
        </button>

        {skillsOpen && (
          <div className="px-4 pb-4 pt-1">
            {!showSkillForm && (
              <div className="flex justify-end mb-3">
                <button
                  onClick={() => { setEditingSkill(null); setShowSkillForm(true); }}
                  className="text-xs font-medium px-3 py-1 rounded-lg bg-(--accent) text-white hover:bg-(--accent-hover) transition-colors"
                >
                  + Add skill
                </button>
              </div>
            )}

            {showSkillForm && (
              <div className="mb-3 p-3 rounded-xl border border-(--accent) bg-background">
                <SkillForm
                  initial={editingSkill ?? undefined}
                  mode={editingSkill ? 'edit' : 'create'}
                  onSubmit={handleSubmitSkill}
                  onCancel={() => { setShowSkillForm(false); setEditingSkill(null); }}
                />
              </div>
            )}

            {!showSkillForm && (
              (config?.skills?.length ?? 0) === 0 ? (
                <p className="text-[12px] text-(--muted)">
                  No skills yet. Add a webhook, prewrite instructions, or a digest schedule for #{tag}.
                </p>
              ) : (
                <ul className="space-y-2">
                  {config!.skills.map(s => (
                    <li key={s.id} className="rounded-lg bg-(--tag-bg) p-3 text-[12px]">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono font-semibold">{s.name}</span>
                          <span className="text-[10px] uppercase tracking-wide text-(--muted-light)">{s.exposeAs}</span>
                          {s.effects?.length ? (
                            <span className="text-[10px] text-(--muted-light)">[{s.effects.map(e => e.type).join(', ')}]</span>
                          ) : null}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => { setEditingSkill(s); setShowSkillForm(true); }}
                            className="text-[11px] text-(--muted) hover:text-(--accent) hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setConfirmDeleteSkill(s.name)}
                            className="text-[11px] text-red-500 hover:text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      {s.description && <p className="text-(--muted) mt-1">{s.description}</p>}
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        )}
      </section>

      {/* Lark bindings — collapsed by default. Visible whenever the server has
          Lark credentials; managing existing bindings doesn't need the event
          listener (LARK_BOT_ENABLED), only creating new ones via @bot /connect does. */}
      {(features.lark_configured || features.platforms.includes("lark")) && (
        <section className="mb-6 rounded-2xl border border-(--card-border) bg-(--card)">
          <button
            type="button"
            onClick={() => setLarkOpen(v => !v)}
            className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-(--accent-light) rounded-2xl transition-colors"
          >
            <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
              <h2 className="text-[13px] font-semibold text-(--muted) shrink-0">Lark bindings</h2>
              <span className="text-[11px] text-(--muted-light) truncate">
                Lark group push / archive (formerly "channel binding")
              </span>
            </div>
            <span className="text-[10px] text-(--muted-light) shrink-0">{larkOpen ? '▴' : '▾'}</span>
          </button>
          {larkOpen && (
            <div className="px-4 pb-4 pt-1">
              <LarkBindingsPanel channelId={tag} availableChannels={availableTags} />
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        {entries.length === 0 ? (
          <p className="text-sm text-(--muted) text-center py-8">
            No entries yet for #{tag}.
          </p>
        ) : (
          entries.map(e => (
            <EntryCard
              key={e.id}
              entry={e}
              currentHandle={currentHandle}
              isAdmin={isAdmin}
              onPublish={handlePublish}
              onDelete={handleDelete}
            />
          ))
        )}
      </section>

      <ConfirmDialog
        open={confirmDeleteSkill !== null}
        title="Delete skill"
        message={confirmDeleteSkill ? `Remove "${confirmDeleteSkill}" from #${tag}? This won't delete any entries — only the skill config.` : ''}
        onConfirm={() => confirmDeleteSkill && handleDeleteSkill(confirmDeleteSkill)}
        onCancel={() => setConfirmDeleteSkill(null)}
      />
    </div>
  );
}
