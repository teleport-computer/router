"use client";

import { useState, useEffect } from "react";
import { type RouterEntry, deleteEntry, publishEntry } from "@/lib/api";
import EntryCard from "../components/EntryCard";
import LarkReactions from "../components/LarkReactions";
import Loading from "../components/Loading";
import { useT } from "@/lib/i18n";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export default function EntryPage() {
  const t = useT();
  const [loggedIn, setLoggedIn] = useState(true);
  const [key, setKey] = useState("");
  const [entry, setEntry] = useState<RouterEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentHandle, setCurrentHandle] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // M2a.5: cookie session is also valid auth
    const savedKey = localStorage.getItem("router_key") || "";
    setKey(savedKey);
    const keyQuery = savedKey ? `?key=${savedKey}` : "";

    fetch(`${API_URL}/api/me${keyQuery}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setCurrentHandle(d.handle || "");
          setIsAdmin(!!d.isAdmin);
          setLoggedIn(true);
        } else {
          setLoggedIn(false);
        }
      })
      .catch(() => setLoggedIn(false));

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (!id) { setLoading(false); return; }

    fetch(`${API_URL}/api/entries/${id}${keyQuery}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.entry) setEntry(data.entry);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Scroll to a specific comment when URL contains `#comment-<id>`.
  // Triggered after entry data is loaded so the target element exists.
  useEffect(() => {
    if (!entry) return;
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (!hash.startsWith('#comment-')) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-(--accent)');
        setTimeout(() => el.classList.remove('ring-2', 'ring-(--accent)'), 2000);
      }
    });
  }, [entry]);

  const handleDelete = async (entryId: string) => {
    try {
      await deleteEntry(key, entryId);
      window.location.href = "/";
    } catch (e: any) {
      alert(e.message || "Failed to delete entry");
    }
  };

  const handlePublish = async (entryId: string) => {
    try {
      const updated = await publishEntry(key, entryId);
      setEntry(updated);
    } catch (e: any) {
      alert(e.message || "Failed to publish entry");
    }
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Loading /></div>;
  }

  if (!loggedIn) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-gray-400">{t("common.notLoggedIn")} <a href="/" className="underline">{t("common.dashboard")}</a></p>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-gray-400">{t("entry.notFound")} <a href="/" className="underline">{t("common.dashboard")}</a></p>
      </div>
    );
  }

  return (
    <div className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <a href="/" className="text-xs text-gray-400 hover:text-gray-600 mb-6 block">&larr; {t("common.dashboard")}</a>

      {/* Main entry */}
      <EntryCard
        entry={entry}
        currentHandle={currentHandle}
        isAdmin={isAdmin}
        onDelete={handleDelete}
        onPublish={handlePublish}
        onAuthorClick={(h) => { window.location.href = `/profile?handle=${h}`; }}
      />

      {/* Native Lark reactions on bot-pushed cards for this entry */}
      <LarkReactions entryId={entry.id} />
    </div>
  );
}
