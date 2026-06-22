"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Loading from "../../components/Loading";
import { useI18n } from "@/lib/i18n";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface PrefsResponse {
  enabled: boolean;
}

export default function ConciergeSettingsPage() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [keyParam, setKeyParam] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const k = new URLSearchParams(window.location.search).get("key") ?? "";
    setKeyParam(k);
  }, []);
  const queryStr = keyParam ? `?key=${encodeURIComponent(keyParam)}` : "";

  async function load() {
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/users/me/concierge-prefs${queryStr}`, { credentials: "include" });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/settings/concierge")}`;
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PrefsResponse = await res.json();
      setEnabled(data.enabled);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyParam]);

  async function toggle(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/users/me/concierge-prefs${queryStr}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      const data: PrefsResponse = await res.json();
      setEnabled(data.enabled);
      setSavedAt(Date.now());
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  if (enabled === null && !error) return <Loading />;

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <nav className="mb-3">
        <Link
          href={`/settings${queryStr}`}
          className="text-xs text-(--muted) hover:text-foreground transition-colors"
        >
          {t("concierge.backToSettings")}
        </Link>
      </nav>

      <section className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
        <h1 className="text-sm font-bold mb-2">{t("concierge.pageTitle")}</h1>
        <p className="text-xs text-(--muted) mb-4">{t("concierge.pageDesc")}</p>

        <div className="mb-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled === true}
              onChange={(e) => toggle(e.target.checked)}
              disabled={saving}
              className="mt-0.5 cursor-pointer"
            />
            <div>
              <div className="text-sm font-medium">{t("concierge.toggleLabel")}</div>
              <p className="text-xs text-(--muted) mt-1">{t("concierge.toggleHint")}</p>
            </div>
          </label>
        </div>

        {error && (
          <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            Error: {error}
          </p>
        )}

        {savedAt && !error && (
          <p className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            {t("concierge.saved")}
          </p>
        )}
      </section>

      <section className="bg-(--card) rounded-xl border border-(--card-border) p-6 mb-6">
        <h2 className="text-sm font-bold mb-2">{t("concierge.howTitle")}</h2>
        <p className="text-xs text-(--muted) mb-3">{t("concierge.howIntro")}</p>
        <ul className="text-xs text-(--muted) space-y-1 list-disc pl-5">
          <li>{t("concierge.groupMentioned")}</li>
          <li>{t("concierge.groupReplied")}</li>
          <li>{t("concierge.groupChannels")}</li>
          <li>{t("concierge.groupMilestones")}</li>
          <li>{t("concierge.groupTopics")}</li>
        </ul>
        <p className="text-xs text-(--muted) mt-3">{t("concierge.howOutro")}</p>
      </section>
    </main>
  );
}
