"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import Loading from "@/app/components/Loading";
import { listTags, type TagConfig } from "@/lib/api";

type Filter = 'all' | 'with-skills';

export default function TagsIndexPage() {
  const [tags, setTags] = useState<TagConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState("");

  useEffect(() => {
    const savedKey = localStorage.getItem("router_key") || "";
    (async () => {
      try {
        const list = await listTags(savedKey);
        setTags(list);
      } catch (e: any) {
        setError(e?.message || "Failed to load tags");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tags.filter((t) => {
      if (q && !t.tag.toLowerCase().includes(q) && !(t.name?.toLowerCase().includes(q))) return false;
      if (filter === 'with-skills') return t.skills.length > 0;
      return true;
    }).sort((a, b) => {
      if ((a.skills.length > 0) !== (b.skills.length > 0)) return b.skills.length - a.skills.length;
      return a.tag.localeCompare(b.tag);
    });
  }, [tags, filter, query]);

  if (loading) return <Loading />;

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Tags</h1>
        <p className="text-sm text-(--muted) mt-1">
          Every <code className="font-mono">#xxx</code> token in entry tags is a tag here. A tag with skills attached fires its webhook when an entry includes it; a tag without is just a label.
        </p>
      </header>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name…"
          className="text-[13px] px-3 py-1.5 rounded-lg border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) flex-1 min-w-40"
        />
        <div className="flex gap-1 text-[12px]">
          {(['all', 'with-skills'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1.5 rounded-lg transition-colors ${
                filter === f
                  ? 'bg-(--accent) text-white'
                  : 'text-(--muted) hover:bg-(--accent-light)'
              }`}
            >
              {f === 'all' ? 'All' : 'Has skills'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-(--muted) text-center py-12">
          {tags.length === 0
            ? 'No tags have configs yet. Configure a webhook or skill on any tag via router_tag in CC.'
            : 'No matches.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((t) => (
            <li key={`${t.teamId}:${t.tag}`}>
              <Link
                href={`/tags/${encodeURIComponent(t.tag)}`}
                className="block rounded-2xl border border-(--card-border) bg-(--card) p-4 hover:border-(--accent) hover:shadow-sm transition-all"
              >
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-mono font-semibold text-[15px]">#{t.tag}</span>
                    {t.name && t.name !== t.tag && (
                      <span className="text-[13px] text-(--muted) truncate">{t.name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-(--muted-light) shrink-0">
                    <span>{t.skills.length} skill{t.skills.length === 1 ? '' : 's'}</span>
                  </div>
                </div>
                {t.description && (
                  <p className="text-[12px] text-(--muted) mt-1.5 line-clamp-2">{t.description}</p>
                )}
                {t.skills.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.skills.slice(0, 4).map(s => (
                      <span key={s.id} className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-(--tag-bg) text-(--tag-text)">
                        {s.name}{s.effects?.length ? ` ⚡` : ''}
                      </span>
                    ))}
                    {t.skills.length > 4 && (
                      <span className="text-[10px] text-(--muted-light)">+{t.skills.length - 4}</span>
                    )}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
