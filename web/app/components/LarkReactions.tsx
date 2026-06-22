"use client";
import { useEffect, useState } from "react";
import { getEntryReactions, type EntryReaction } from "@/lib/api";
import { useServerInfo } from "@/lib/server-info";

/**
 * Map raw Lark emoji_type strings to actual emoji glyphs.
 * Source: https://open.feishu.cn/document/server-docs/group/chat-member/events/added (reaction enum)
 * Add more as we encounter them — unknown types fall back to the raw label.
 */
const EMOJI_GLYPHS: Record<string, string> = {
  THUMBSUP: "👍",
  THUMBSDOWN: "👎",
  HEART: "❤️",
  EYES: "👀",
  DONE: "✅",
  FIRE: "🔥",
  BULB: "💡",
  PARTY_POPPER: "🎉",
  TADA: "🎉",
  CLAPPING_HANDS: "👏",
  CLAP: "👏",
  PRAY: "🙏",
  HUNDRED_POINTS: "💯",
  STAR: "⭐",
  SMILE: "🙂",
  SMILEY: "😀",
  LAUGH: "😂",
  JOY: "😂",
  CRYING_FACE: "😢",
  SAD: "😢",
  THINKING_FACE: "🤔",
  THINKING: "🤔",
  EYES_RIGHT: "👀",
  PUSHPIN: "📌",
  QUESTION: "❓",
};

function renderEmoji(emojiType: string): string {
  return EMOJI_GLYPHS[emojiType] ?? `:${emojiType.toLowerCase()}:`;
}

export default function LarkReactions({ entryId }: { entryId: string }) {
  const { features } = useServerInfo();
  const larkEnabled = features.platforms.includes("lark");
  const [reactions, setReactions] = useState<EntryReaction[] | null>(null);

  useEffect(() => {
    if (!larkEnabled) return;
    let alive = true;
    getEntryReactions(entryId)
      .then(r => { if (alive) setReactions(r); })
      .catch(() => { if (alive) setReactions([]); });
    return () => { alive = false; };
  }, [entryId, larkEnabled]);

  if (!larkEnabled) return null;
  if (!reactions || reactions.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {reactions.map(r => (
        <span
          key={r.emojiType}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-(--card-border)/40 text-xs"
          title={r.emojiType}
        >
          <span>{renderEmoji(r.emojiType)}</span>
          <span className="font-medium text-(--muted)">{r.count}</span>
        </span>
      ))}
    </div>
  );
}
