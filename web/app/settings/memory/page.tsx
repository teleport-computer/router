"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Loading from "../../components/Loading";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useI18n } from "@/lib/i18n";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface MemoryResponse {
  content: string;
  example?: string;
  updatedAt: number;
  updatedByHandle: string | null;
  canEdit: boolean;
  isTemplateOnly: boolean;
  hasPrevious: boolean;
  charCount: number;
  charLimit: number;
  adminHandles: string[];
}

function formatDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

export default function TeamMemoryPage() {
  const { t } = useI18n();
  const [memory, setMemory] = useState<MemoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showRollback, setShowRollback] = useState(false);
  const [showExample, setShowExample] = useState(false);

  const [keyParam, setKeyParam] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const k = new URLSearchParams(window.location.search).get("key") ?? "";
    setKeyParam(k);
  }, []);
  const queryStr = keyParam ? `?key=${encodeURIComponent(keyParam)}` : "";

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/memory${queryStr}`, { credentials: "include" });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/settings/memory")}`;
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: MemoryResponse = await res.json();
      setMemory(data);
      setDraft(data.content);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyParam]);

  async function save() {
    if (!memory?.canEdit) return;
    if (draft.length > memory.charLimit) {
      setError(`Over limit: ${draft.length} / ${memory.charLimit}`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/memory${queryStr}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      const data: MemoryResponse = await res.json();
      setMemory(data);
      setDraft(data.content);
      setSavedAt(Date.now());
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function rollback() {
    setShowRollback(false);
    if (!memory?.canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/memory/rollback${queryStr}`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      const data: MemoryResponse = await res.json();
      setMemory(data);
      setDraft(data.content);
      setSavedAt(Date.now());
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (!memory) return;
    setDraft(memory.content);
    setError(null);
  }

  if (loading) return <Loading />;
  if (!memory) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-lg font-bold mb-2">{t("memory.pageTitle")}</h1>
        <p className="text-sm text-red-600">{error ?? "Failed to load."}</p>
      </main>
    );
  }

  const dirty = draft !== memory.content;
  const overLimit = draft.length > memory.charLimit;

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <nav className="mb-3">
        <Link
          href={`/settings${queryStr}`}
          className="text-xs text-(--muted) hover:text-foreground transition-colors"
        >
          {t("memory.backToSettings")}
        </Link>
      </nav>

      <section className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
        <h1 className="text-sm font-bold mb-2">{t("memory.pageTitle")}</h1>
        <p className="text-xs text-(--muted) mb-4">
          {t("memory.pageDesc", { limit: String(memory.charLimit) })}
        </p>

        {/* ── Status banners ── */}
        {memory.isTemplateOnly && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 leading-relaxed">
            {t("memory.notConfigured")}
          </div>
        )}

        {!memory.canEdit && (
          <div className="mb-4 bg-(--accent-light) border border-(--card-border) rounded-lg p-3 text-xs text-foreground leading-relaxed">
            <strong>{t("memory.readonlyLabel")}</strong> {t("memory.readonlyDesc")}{" "}
            {memory.adminHandles.length > 0 ? (
              <>
                {t("memory.contactAdmins")}{" "}
                {memory.adminHandles.map((h, i) => (
                  <span key={h}>
                    {i > 0 && ", "}
                    <strong>@{h}</strong>
                  </span>
                ))}
                .
              </>
            ) : (
              <>{t("memory.noAdmins")}</>
            )}
          </div>
        )}

        {memory.updatedByHandle && (
          <p className="text-xs text-(--muted) mb-3">
            {t("memory.lastUpdatedBy")} <strong>@{memory.updatedByHandle}</strong> · {formatDate(memory.updatedAt)}
          </p>
        )}

        {/* ── Editor ── */}
        <label
          htmlFor="memory-editor"
          className="block text-xs font-medium text-(--muted) mb-1"
        >
          {memory.canEdit ? t("memory.editorLabelEdit") : t("memory.editorLabelReadonly")}
        </label>
        <textarea
          id="memory-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          readOnly={!memory.canEdit}
          rows={28}
          spellCheck={false}
          placeholder={t("memory.placeholder")}
          className={[
            "w-full font-mono text-xs leading-relaxed px-3 py-2 rounded-lg border bg-background text-foreground resize-y placeholder:text-(--muted) placeholder:opacity-60",
            memory.canEdit
              ? "border-(--card-border) focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light)"
              : "border-dashed border-(--card-border) opacity-80 cursor-default",
          ].join(" ")}
        />

        {/* ── Collapsible starter-template panel ── */}
        {memory.example && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowExample(v => !v)}
              className="text-xs text-(--muted) hover:text-foreground underline cursor-pointer"
            >
              {showExample ? t("memory.hideExample") : t("memory.showExample")}
            </button>
            {showExample && (
              <div className="mt-2">
                <pre className="font-mono text-xs leading-relaxed px-3 py-2 rounded-lg border border-dashed border-(--card-border) bg-(--accent-light)/30 text-(--muted) whitespace-pre-wrap overflow-x-auto">
                  {memory.example}
                </pre>
                <p className="text-xs text-(--muted) mt-1">{t("memory.exampleNote")}</p>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between items-center mt-2 gap-4 flex-wrap">
          <p className={`text-xs ${overLimit ? "text-red-600" : "text-(--muted)"}`}>
            {draft.length} / {memory.charLimit}
            {overLimit && ` ${t("memory.overLimit")}`}
            {dirty && memory.canEdit && !overLimit && ` ${t("memory.unsavedChanges")}`}
          </p>
        </div>

        {error && (
          <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            Error: {error}
          </p>
        )}

        {savedAt && !error && !dirty && (
          <p className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            {t("memory.saved")}
          </p>
        )}

        {/* ── Action buttons ── */}
        <div className="mt-4 flex gap-2 flex-wrap items-center">
          <button
            onClick={save}
            disabled={!memory.canEdit || saving || !dirty || overLimit}
            title={!memory.canEdit ? t("memory.tooltipAdminOnly") : !dirty ? t("memory.tooltipNoChanges") : overLimit ? t("memory.tooltipOverLimit") : ""}
            className="cursor-pointer text-sm bg-(--accent) text-white px-4 py-2 rounded-lg hover:bg-(--accent-hover) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? t("memory.saving") : t("memory.save")}
          </button>

          <button
            onClick={discard}
            disabled={!memory.canEdit || saving || !dirty}
            className="cursor-pointer text-sm px-4 py-2 rounded-lg border border-(--card-border) text-(--muted) hover:border-(--accent) hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("memory.discard")}
          </button>

          {memory.hasPrevious && (
            <button
              onClick={() => setShowRollback(true)}
              disabled={!memory.canEdit || saving}
              className="cursor-pointer text-sm px-4 py-2 rounded-lg border border-(--card-border) text-(--muted) hover:border-(--accent) hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
            >
              {t("memory.restorePrev")}
            </button>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={showRollback}
        title={t("memory.restoreConfirmTitle")}
        message={t("memory.restoreConfirmMessage")}
        confirmText={t("memory.restoreConfirmAction")}
        danger={false}
        onConfirm={rollback}
        onCancel={() => setShowRollback(false)}
      />
    </main>
  );
}
