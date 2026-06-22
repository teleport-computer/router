"use client";

import { useI18n } from "@/lib/i18n";
import { useServerInfo } from "@/lib/server-info";

export default function LangToggle() {
  const { lang, setLang } = useI18n();
  const serverInfo = useServerInfo();
  const langs = serverInfo.features.languages.length > 0 ? serverInfo.features.languages : ["en"];

  if (!langs.includes("en") || !langs.includes("zh")) return null;

  const next = lang === "en" ? "zh" : "en";
  const label = lang === "en" ? "EN" : "中";
  const title = lang === "en" ? "Switch to Chinese" : "切换到英文";

  return (
    <button
      onClick={() => setLang(next)}
      title={title}
      className="cursor-pointer p-1.5 rounded-lg hover:bg-(--accent-light) transition-all text-[11px] font-semibold tracking-wide text-(--muted) hover:text-foreground min-w-[28px]"
    >
      {label}
    </button>
  );
}
