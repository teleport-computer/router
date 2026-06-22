"use client";

import { useState, useEffect } from "react";
import { type RouterEntry, deleteEntry, publishEntry } from "@/lib/api";
import EntryCard from "../components/EntryCard";
import Loading from "../components/Loading";
import { useT } from "@/lib/i18n";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface ProfileData {
  user: {
    handle: string;
    displayName?: string;
    bio?: string;
    role?: string;
    isAdmin?: boolean;
    createdAt: number;
    larkBinding?: {
      name?: string;
      avatarUrl?: string;
    };
  };
  entries: RouterEntry[];
  entryCount: number;
}

export default function ProfilePage() {
  const t = useT();
  const [key, setKey] = useState("");
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentHandle, setCurrentHandle] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // M2a.5: cookie session is also valid auth. If localStorage has key,
    // include it as ?key= for backward compat; else rely on cookie.
    const savedKey = localStorage.getItem("router_key") || "";
    setKey(savedKey);
    const keyQuery = savedKey ? `?key=${savedKey}` : "";

    // Fetch current user info so EntryCard can decide owner/admin actions.
    fetch(`${API_URL}/api/me${keyQuery}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setCurrentHandle(d.handle || ""); setIsAdmin(!!d.isAdmin); } })
      .catch(() => {});

    const params = new URLSearchParams(window.location.search);
    const handle = params.get("handle");
    if (!handle) { setLoading(false); return; }

    fetch(`${API_URL}/api/users/${handle}${keyQuery}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.user) setProfile(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleDelete = async (entryId: string) => {
    try {
      await deleteEntry(key, entryId);
      setProfile(p => p ? { ...p, entries: p.entries.filter(e => e.id !== entryId), entryCount: p.entryCount - 1 } : p);
    } catch (e: any) {
      alert(e.message || "Failed to delete entry");
    }
  };

  const handlePublish = async (entryId: string) => {
    try {
      const updated = await publishEntry(key, entryId);
      setProfile(p => p ? { ...p, entries: p.entries.map(e => e.id === entryId ? updated : e) } : p);
    } catch (e: any) {
      alert(e.message || "Failed to publish entry");
    }
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Loading /></div>;
  }

  if (!profile) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-gray-400">{t("profile.notFound")} <a href="/" className="underline">{t("common.dashboard")}</a></p>
      </div>
    );
  }

  const { user, entries, entryCount } = profile;

  return (
    <div className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-8">
        <a href="/" className="text-xs text-gray-400 hover:text-gray-600 mb-4 block">&larr; {t("common.dashboard")}</a>
        <div className="flex items-center gap-3">
          {user.larkBinding?.avatarUrl ? (
            <img
              src={user.larkBinding.avatarUrl}
              alt={user.larkBinding.name || user.displayName || user.handle}
              className="w-12 h-12 rounded-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-lg font-bold text-gray-500">
              {user.handle[0].toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold">
              @{user.handle}
              {user.isAdmin && <span className="text-xs ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full font-medium">{t("profile.adminBadge")}</span>}
            </h1>
            {user.displayName && <p className="text-sm text-gray-500">{user.displayName}</p>}
            {user.larkBinding?.name && user.larkBinding.name !== user.displayName && (
              <p className="text-xs text-blue-500 mt-0.5">Lark: {user.larkBinding.name}</p>
            )}
            {user.bio && <p className="text-sm text-gray-500 mt-0.5">{user.bio}</p>}
          </div>
        </div>
        <div className="flex gap-4 mt-3 text-xs text-gray-400">
          {user.role && <span className="capitalize">{user.role}</span>}
          <span>{t("profile.entriesCount", { n: entryCount })}</span>
          <span>{t("profile.joined", { date: new Date(user.createdAt).toLocaleDateString() })}</span>
        </div>
      </div>

      {/* Entries */}
      {entries.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">{t("profile.noEntries")}</p>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              currentHandle={currentHandle}
              isAdmin={isAdmin}
              onDelete={handleDelete}
              onPublish={handlePublish}
              onAuthorClick={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}
