"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import enLocale from "./locales/en.json";
import zhLocale from "./locales/zh.json";
import { useServerInfo } from "@/lib/server-info";

export type Lang = string;

type Locale = typeof enLocale;

const locales: Record<string, Locale> = {
  en: enLocale,
  zh: zhLocale as Locale,
};

const LANG_STORAGE_KEY = "router_lang";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function persistLangToServer(lang: Lang) {
  if (typeof window === "undefined") return;
  const key = localStorage.getItem("router_key") || "";
  fetch(`${API_URL}/api/users/me${key ? `?key=${key}` : ""}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lang }),
  }).catch(() => {
    /* ignore — best effort */
  });
}

function lookup(locale: Locale, key: string): string {
  const segments = key.split(".");
  let cur: unknown = locale;
  for (const seg of segments) {
    if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return "";
    }
  }
  return typeof cur === "string" ? cur : "";
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

type I18nContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const serverInfo = useServerInfo();
  const availableLangs = serverInfo.features.languages.length > 0
    ? serverInfo.features.languages
    : ["en"];
  const defaultLang: Lang = availableLangs[0];

  const [lang, setLangState] = useState<Lang>(defaultLang);

  // First pass: hydrate state from localStorage as soon as we mount.
  // Don't gate on serverInfo.loaded here — that fetch is async and
  // running this effect early-then-cleaning-up was a bug: it would wipe
  // a stored "zh" because availableLangs was still the default ["en"]
  // before the fetch landed, then never restore.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(LANG_STORAGE_KEY);
      if (saved) setLangState(saved);
    } catch {
      /* ignore */
    }
  }, []);

  // Second pass: validate against the server's allowed list ONLY after
  // serverInfo has actually loaded. If the stored choice isn't allowed
  // (e.g. user has "zh" but Shape only supports "en"), drop it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!serverInfo.loaded) return;
    try {
      const saved = localStorage.getItem(LANG_STORAGE_KEY);
      if (saved && !availableLangs.includes(saved)) {
        setLangState(defaultLang);
        localStorage.removeItem(LANG_STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [serverInfo.loaded, availableLangs.join(","), defaultLang]);

  const setLang = useCallback((next: Lang) => {
    if (!availableLangs.includes(next)) return;
    setLangState(next);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    persistLangToServer(next);
  }, [availableLangs]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const locale = locales[lang] ?? locales.en;
      let raw = lookup(locale, key);
      if (!raw && lang !== "en") raw = lookup(locales.en, key);
      if (!raw) return key;
      return interpolate(raw, vars);
    },
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      lang: "en",
      setLang: () => {},
      t: (key, vars) => interpolate(lookup(enLocale, key) || key, vars),
    };
  }
  return ctx;
}

export function useT() {
  return useI18n().t;
}
