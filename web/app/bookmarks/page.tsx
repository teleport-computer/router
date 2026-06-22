"use client";

import { useState, useEffect } from "react";
import { getBookmarks, publishEntry, type RouterEntry } from "@/lib/api";
import EntryCard from "../components/EntryCard";
import Loading from "../components/Loading";
import { useT } from "@/lib/i18n";

export default function BookmarksPage() {
  const t = useT();
  const [key, setKey] = useState("");
  const [currentHandle, setCurrentHandle] = useState("");
  const [entries, setEntries] = useState<RouterEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // M2a.5: cookie session also valid; api helpers send credentials
    const savedKey = localStorage.getItem("router_key") || "";
    const savedHandle = localStorage.getItem("router_handle");
    setKey(savedKey);
    if (savedHandle) setCurrentHandle(savedHandle);

    getBookmarks(savedKey).then(setEntries).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handlePublish = async (entryId: string) => {
    try {
      const updated = await publishEntry(key, entryId);
      setEntries(es => es.map(e => e.id === entryId ? updated : e));
    } catch (e: any) {
      alert(e.message || "Failed to publish entry");
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loading />
      </div>
    );
  }

  return (
    <div className="fade-up flex-1 max-w-2xl mx-auto w-full px-4 sm:px-5 py-6 sm:py-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight italic">{t("bookmarks.title")}</h1>
        <div className="flex items-center gap-1">
          <a href="/members" className="text-[12px] text-(--muted) hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-(--accent-light) transition-all">{t("nav.members")}</a>
          <a href="/" className="text-[12px] text-(--muted) hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-(--accent-light) transition-all">{t("common.dashboard")}</a>
        </div>
      </div>

      {loading ? (
        <Loading className="py-24" />
      ) : entries.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-sm text-(--muted)">{t("bookmarks.emptyShort")}</p>
          <p className="text-xs text-(--muted-light) mt-1">{t("bookmarks.emptyHintShort")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              currentHandle={currentHandle}
              isBookmarked={true}
              onPublish={handlePublish}
              onAuthorClick={(h) => window.location.href = `/profile?handle=${h}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
