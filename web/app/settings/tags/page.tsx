"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getPresetTags,
  addPresetTag,
  updatePresetTag,
  deletePresetTag,
  getTagStats,
  createCustomTag,
  mergeTags,
  deleteTag,
  type PresetTag,
  type TagStat,
} from "@/lib/api";
import ConfirmDialog from "../../components/ConfirmDialog";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const TAG_RE = /^[a-z0-9][a-z0-9-:]*$/;

export default function TagManagementPage() {
  const [key, setKey] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  // null = checking; true = ?key= or cookie session valid; false = neither
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const [presetTags, setPresetTags] = useState<PresetTag[]>([]);
  const [tagStats, setTagStats] = useState<TagStat[]>([]);

  // Preset add form
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetDesc, setNewPresetDesc] = useState("");
  const [presetAddError, setPresetAddError] = useState("");
  const [presetAdding, setPresetAdding] = useState(false);

  // Preset edit state
  const [editingPreset, setEditingPreset] = useState<string | null>(null);
  const [editPresetDesc, setEditPresetDesc] = useState("");
  const [editPresetBusy, setEditPresetBusy] = useState(false);

  // Custom add form
  const [showCustomAdd, setShowCustomAdd] = useState(false);
  const [newCustomName, setNewCustomName] = useState("");
  const [customAddError, setCustomAddError] = useState("");
  const [customAdding, setCustomAdding] = useState(false);

  // Rename state
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  // Delete / confirm state
  const [deleteConfirm, setDeleteConfirm] = useState<{ name: string; type: "preset" | "custom" } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Merge state
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState("");

  // Filter + sort
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "usage">("usage");

  const presetNames = new Set(presetTags.map((t) => t.name));
  const customTags = tagStats.filter((s) => !presetNames.has(s.tag));

  const q = query.trim().toLowerCase().replace(/^#/, "");
  const matchesQuery = (s: string) => !q || s.toLowerCase().includes(q);

  const filteredPresets = presetTags.filter(t => matchesQuery(t.name) || matchesQuery(t.description || ""));
  const filteredCustoms = customTags.filter(s => matchesQuery(s.tag));
  const usageFor = (name: string) => tagStats.find(s => s.tag === name)?.count ?? 0;

  const sortedPresets = [...filteredPresets].sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    return usageFor(b.name) - usageFor(a.name) || a.name.localeCompare(b.name);
  });
  const sortedCustoms = [...filteredCustoms].sort((a, b) => {
    if (sortBy === "name") return a.tag.localeCompare(b.tag);
    return b.count - a.count || a.tag.localeCompare(b.tag);
  });

  const loadData = useCallback(async (k: string) => {
    try {
      const [pt, ts] = await Promise.all([getPresetTags(k), getTagStats(k)]);
      setPresetTags(pt);
      setTagStats(ts);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    // M2a.5: cookie session also valid
    const savedKey = localStorage.getItem("router_key") || "";
    setKey(savedKey);
    const keyQuery = savedKey ? `?key=${savedKey}` : "";

    fetch(`${API_URL}/api/me${keyQuery}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setAuthed(true);
          if (d.isAdmin) setIsAdmin(true);
          return loadData(savedKey);
        }
        setAuthed(false);
        return undefined;
      })
      .catch(() => setAuthed(false))
      .finally(() => {
        setAuthChecked(true);
        setLoading(false);
      });
  }, [loadData]);

  const refresh = () => loadData(key);

  // ── Preset tag actions ────────────────────────────────────

  const handleAddPreset = async () => {
    const name = newPresetName.trim().toLowerCase().replace(/^#/, "");
    const desc = newPresetDesc.trim();
    if (!name) { setPresetAddError("Name is required"); return; }
    if (!TAG_RE.test(name)) { setPresetAddError("Invalid name. Use lowercase letters, numbers, hyphens, colons. Must start with letter or number."); return; }
    if (presetNames.has(name)) { setPresetAddError("Tag already exists"); return; }

    setPresetAdding(true);
    setPresetAddError("");
    try {
      await addPresetTag(key, name, desc);
      setNewPresetName("");
      setNewPresetDesc("");
      await refresh();
    } catch (e: any) {
      setPresetAddError(e.message || "Failed to add tag");
    }
    setPresetAdding(false);
  };

  const startEditPreset = (tag: PresetTag) => {
    setEditingPreset(tag.name);
    setEditPresetDesc(tag.description);
  };

  const cancelEditPreset = () => {
    setEditingPreset(null);
    setEditPresetDesc("");
  };

  const saveEditPreset = async () => {
    if (!editingPreset) return;
    setEditPresetBusy(true);
    try {
      await updatePresetTag(key, editingPreset, editPresetDesc.trim());
      cancelEditPreset();
      await refresh();
    } catch (e: any) {
      alert(e.message || "Failed to update tag");
    }
    setEditPresetBusy(false);
  };

  // ── Custom tag actions ────────────────────────────────────

  const handleAddCustom = async () => {
    const name = newCustomName.trim().toLowerCase().replace(/^#/, "");
    if (!name) { setCustomAddError("Name is required"); return; }
    if (!TAG_RE.test(name)) { setCustomAddError("Invalid name. Use lowercase letters, numbers, hyphens, colons. Must start with letter or number."); return; }
    if (presetNames.has(name)) { setCustomAddError("This name is already a preset tag"); return; }

    setCustomAdding(true);
    setCustomAddError("");
    try {
      await createCustomTag(key, name);
      setNewCustomName("");
      setShowCustomAdd(false);
      await refresh();
    } catch (e: any) {
      setCustomAddError(e.message || "Failed to create tag");
    }
    setCustomAdding(false);
  };

  const startRename = (name: string) => {
    setRenamingTag(name);
    setRenameValue(name);
  };

  const cancelRename = () => {
    setRenamingTag(null);
    setRenameValue("");
  };

  const saveRename = async () => {
    if (!renamingTag) return;
    const newName = renameValue.trim().toLowerCase().replace(/^#/, "");
    if (!newName || newName === renamingTag) { cancelRename(); return; }
    if (!TAG_RE.test(newName)) { alert("Invalid tag name"); return; }

    setRenameBusy(true);
    try {
      await mergeTags(key, renamingTag, newName);
      cancelRename();
      await refresh();
    } catch (e: any) {
      alert(e.message || "Failed to rename tag");
    }
    setRenameBusy(false);
  };

  // ── Delete ────────────────────────────────────────────────

  const performDelete = async () => {
    if (!deleteConfirm) return;
    const { name, type } = deleteConfirm;
    setDeleteConfirm(null);
    setDeleteBusy(true);
    try {
      if (type === "preset") {
        await deletePresetTag(key, name);
      } else {
        await deleteTag(key, name);
      }
      await refresh();
    } catch (e: any) {
      alert(e.message || "Failed to delete tag");
    }
    setDeleteBusy(false);
  };

  // ── Merge ─────────────────────────────────────────────────

  const toggleMergeSelect = (name: string) => {
    setMergeSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setMergeError("");
  };

  const performMerge = async () => {
    const target = mergeTarget.trim().toLowerCase().replace(/^#/, "");
    if (!target) { setMergeError("Target tag name is required"); return; }
    if (!TAG_RE.test(target)) { setMergeError("Invalid target tag name"); return; }
    const sources = [...mergeSelected].filter((s) => s !== target);
    if (sources.length === 0) { setMergeError("Select at least one source tag different from target"); return; }

    setMergeBusy(true);
    setMergeError("");
    try {
      for (const src of sources) {
        await mergeTags(key, src, target);
      }
      setMergeSelected(new Set());
      setMergeTarget("");
      await refresh();
    } catch (e: any) {
      setMergeError(e.message || "Failed to merge tags");
    }
    setMergeBusy(false);
  };

  const cancelMerge = () => {
    setMergeSelected(new Set());
    setMergeTarget("");
    setMergeError("");
  };

  // ── Render ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-(--accent) border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authChecked) return null;

  if (!authed) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-[13px] text-(--muted) mb-3">Not logged in.</p>
          <a href="/" className="text-[13px] text-(--accent) hover:underline cursor-pointer">
            Back to dashboard
          </a>
        </div>
      </div>
    );
  }

  const mergeMode = mergeSelected.size > 0;

  return (
    <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-5 py-6 sm:py-8">
      <a href="/" className="text-[12px] text-(--accent) hover:underline cursor-pointer">
        &larr; Dashboard
      </a>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-4 mb-5">
        <h1 className="text-base font-semibold text-foreground">Tag Management</h1>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="text-[12px] w-44 px-3 py-1.5 rounded-lg border border-(--card-border) bg-(--background) focus:outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent-light)"
          />
          <div className="flex items-center gap-1 text-[11px] text-(--muted)">
            <button
              onClick={() => setSortBy("usage")}
              className={`cursor-pointer px-2 py-1 rounded transition-colors ${sortBy === "usage" ? "text-(--accent) bg-(--accent-light)" : "hover:text-foreground"}`}
            >
              Usage
            </button>
            <button
              onClick={() => setSortBy("name")}
              className={`cursor-pointer px-2 py-1 rounded transition-colors ${sortBy === "name" ? "text-(--accent) bg-(--accent-light)" : "hover:text-foreground"}`}
            >
              A–Z
            </button>
          </div>
        </div>
      </div>

      {/* ── Preset Tags Section ──────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-medium text-foreground">
            Preset tags <span className="text-(--muted) font-normal">({filteredPresets.length}{q && ` / ${presetTags.length}`})</span>
          </h2>
        </div>

        {/* Admin: add form */}
        {isAdmin && (
          <div className="bg-(--card) border border-(--card-border) rounded-xl p-4 mb-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex items-center gap-1 flex-1">
                <span className="text-[13px] text-(--muted-light)">#</span>
                <input
                  value={newPresetName}
                  onChange={(e) => { setNewPresetName(e.target.value); setPresetAddError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleAddPreset()}
                  placeholder="tag-name"
                  className="flex-1 text-[13px] px-3 py-2 rounded-lg border border-(--card-border) bg-(--background) focus:outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent-light)"
                  disabled={presetAdding}
                />
              </div>
              <input
                value={newPresetDesc}
                onChange={(e) => setNewPresetDesc(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddPreset()}
                placeholder="Description (optional)"
                className="flex-1 text-[13px] px-3 py-2 rounded-lg border border-(--card-border) bg-(--background) focus:outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent-light)"
                disabled={presetAdding}
              />
              <button
                onClick={handleAddPreset}
                disabled={presetAdding || !newPresetName.trim()}
                className="cursor-pointer text-[12px] font-medium px-4 py-2 rounded-lg bg-(--accent) text-white hover:bg-(--accent-hover) disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Add
              </button>
            </div>
            {presetAddError && (
              <p className="text-[11px] text-(--danger) mt-2">{presetAddError}</p>
            )}
          </div>
        )}

        {/* Preset tag grid */}
        {sortedPresets.length === 0 ? (
          <p className="text-[12px] text-(--muted) text-center py-6">
            {q ? "No preset tags match." : "No preset tags yet."}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {sortedPresets.map((tag) => {
              const isEditing = editingPreset === tag.name;
              const usageCount = usageFor(tag.name);
              return (
                <div
                  key={tag.name}
                  className="bg-(--card) border border-(--card-border) rounded-lg px-3 py-2.5 group hover:border-(--accent)/40 transition-colors flex flex-col min-h-[64px]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-medium text-foreground truncate">#{tag.name}</span>
                    <span className="text-[10px] tabular-nums text-(--muted-light) shrink-0">{usageCount}</span>
                    {isAdmin && !isEditing && (
                      <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => startEditPreset(tag)}
                          className="cursor-pointer text-[10px] text-(--muted) hover:text-(--accent) px-1.5 py-0.5 rounded hover:bg-(--accent-light) transition-colors"
                          disabled={deleteBusy}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ name: tag.name, type: "preset" })}
                          className="cursor-pointer text-[10px] text-(--danger) px-1.5 py-0.5 rounded hover:bg-(--danger)/10 transition-colors"
                          disabled={deleteBusy}
                        >
                          Del
                        </button>
                      </div>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="mt-1.5 flex items-center gap-1">
                      <input
                        autoFocus
                        value={editPresetDesc}
                        onChange={(e) => setEditPresetDesc(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEditPreset();
                          if (e.key === "Escape") cancelEditPreset();
                        }}
                        className="flex-1 min-w-0 text-[11px] px-2 py-1 rounded border border-(--card-border) bg-background focus:outline-none focus:border-(--accent)"
                        disabled={editPresetBusy}
                        placeholder="Description"
                      />
                      <button
                        onClick={saveEditPreset}
                        disabled={editPresetBusy}
                        className="cursor-pointer text-[10px] text-(--accent) hover:text-(--accent-hover) px-1 disabled:opacity-40"
                      >
                        ✓
                      </button>
                      <button
                        onClick={cancelEditPreset}
                        disabled={editPresetBusy}
                        className="cursor-pointer text-[10px] text-(--muted) hover:text-foreground px-1"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-(--muted) mt-0.5 line-clamp-2 leading-snug" title={tag.description}>
                      {tag.description || <span className="italic text-(--muted-light)">No description</span>}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Custom Tags Section ──────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-medium text-foreground">
            Custom tags <span className="text-(--muted) font-normal">({filteredCustoms.length}{q && ` / ${customTags.length}`})</span>
          </h2>
          <div className="flex items-center gap-2">
            {mergeMode && (
              <button
                onClick={cancelMerge}
                className="cursor-pointer text-[11px] text-(--muted) hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={() => { setShowCustomAdd(true); setNewCustomName(""); setCustomAddError(""); }}
              className="cursor-pointer text-[12px] text-(--accent) hover:text-(--accent-hover) font-medium transition-colors"
            >
              + Add tag
            </button>
          </div>
        </div>

        {/* Add custom tag form */}
        {showCustomAdd && (
          <div className="bg-(--card) border border-(--card-border) rounded-xl p-4 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-(--muted-light)">#</span>
              <input
                autoFocus
                value={newCustomName}
                onChange={(e) => { setNewCustomName(e.target.value); setCustomAddError(""); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCustom();
                  if (e.key === "Escape") setShowCustomAdd(false);
                }}
                placeholder="tag-name"
                className="flex-1 text-[13px] px-3 py-2 rounded-lg border border-(--card-border) bg-(--background) focus:outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent-light)"
                disabled={customAdding}
              />
              <button
                onClick={handleAddCustom}
                disabled={customAdding || !newCustomName.trim()}
                className="cursor-pointer text-[12px] font-medium px-4 py-2 rounded-lg bg-(--accent) text-white hover:bg-(--accent-hover) disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Add
              </button>
              <button
                onClick={() => setShowCustomAdd(false)}
                className="cursor-pointer text-[12px] text-(--muted) hover:text-foreground px-2 py-2 transition-colors"
              >
                Cancel
              </button>
            </div>
            {customAddError && (
              <p className="text-[11px] text-(--danger) mt-2">{customAddError}</p>
            )}
          </div>
        )}

        {/* Merge bar */}
        {mergeMode && (
          <div className="bg-(--card) border border-(--card-border) rounded-xl p-4 mb-3">
            <p className="text-[12px] text-(--muted) mb-2">
              Merge {mergeSelected.size} selected tag{mergeSelected.size > 1 ? "s" : ""} into:
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-(--muted-light)">#</span>
              <input
                value={mergeTarget}
                onChange={(e) => { setMergeTarget(e.target.value); setMergeError(""); }}
                onKeyDown={(e) => e.key === "Enter" && performMerge()}
                placeholder="target-tag-name"
                className="flex-1 text-[13px] px-3 py-2 rounded-lg border border-(--card-border) bg-(--background) focus:outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent-light)"
                disabled={mergeBusy}
              />
              <button
                onClick={performMerge}
                disabled={mergeBusy}
                className="cursor-pointer text-[12px] font-medium px-4 py-2 rounded-lg bg-(--accent) text-white hover:bg-(--accent-hover) disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Merge
              </button>
            </div>
            {mergeError && (
              <p className="text-[11px] text-(--danger) mt-2">{mergeError}</p>
            )}
          </div>
        )}

        {/* Custom tag grid */}
        {sortedCustoms.length === 0 && !showCustomAdd ? (
          <p className="text-[12px] text-(--muted) text-center py-6">
            {q ? "No custom tags match." : "No custom tags yet."}
          </p>
        ) : sortedCustoms.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {sortedCustoms.map((stat) => {
              const isRenaming = renamingTag === stat.tag;
              const isSelected = mergeSelected.has(stat.tag);
              return (
                <div
                  key={stat.tag}
                  className={`relative bg-(--card) border rounded-lg px-3 py-2.5 group transition-colors flex flex-col min-h-16 ${
                    isSelected ? "border-(--accent) bg-(--accent-light)/30" : "border-(--card-border) hover:border-(--accent)/40"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleMergeSelect(stat.tag)}
                      className="cursor-pointer accent-(--accent) w-3.5 h-3.5 shrink-0"
                      title="Select for merge"
                    />
                    {isRenaming ? (
                      <div className="flex-1 flex items-center gap-1 min-w-0">
                        <span className="text-[12px] text-(--muted-light) shrink-0">#</span>
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename();
                            if (e.key === "Escape") cancelRename();
                          }}
                          className="flex-1 min-w-0 text-[12px] px-2 py-0.5 rounded border border-(--card-border) bg-background focus:outline-none focus:border-(--accent)"
                          disabled={renameBusy}
                        />
                        <button
                          onClick={saveRename}
                          disabled={renameBusy}
                          className="cursor-pointer text-[10px] text-(--accent) hover:text-(--accent-hover) px-1 disabled:opacity-40"
                        >
                          ✓
                        </button>
                        <button
                          onClick={cancelRename}
                          disabled={renameBusy}
                          className="cursor-pointer text-[10px] text-(--muted) hover:text-foreground px-1"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="text-[13px] font-medium text-foreground truncate">#{stat.tag}</span>
                        <span className="text-[10px] tabular-nums text-(--muted-light) shrink-0">{stat.count}</span>
                        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={() => startRename(stat.tag)}
                            className="cursor-pointer text-[10px] text-(--muted) hover:text-(--accent) px-1.5 py-0.5 rounded hover:bg-(--accent-light) transition-colors"
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => setDeleteConfirm({ name: stat.tag, type: "custom" })}
                            className="cursor-pointer text-[10px] text-(--danger) px-1.5 py-0.5 rounded hover:bg-(--danger)/10 transition-colors"
                            disabled={deleteBusy}
                          >
                            Del
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteConfirm}
        title={`Delete #${deleteConfirm?.name ?? ""}?`}
        message={
          deleteConfirm?.type === "preset"
            ? "This will remove it from the preset tags list. Existing entries with this tag will not be affected."
            : "This will remove this tag from all entries that use it."
        }
        confirmText="Delete"
        onConfirm={performDelete}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
