"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { useCliInstallCommand } from "@/lib/cli-install-command";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export default function SetupPage() {
  const t = useT();
  const [tab, setTab] = useState<"cli" | "mcp">("mcp");
  const [key, setKey] = useState("");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    try {
      const k = localStorage.getItem("router_key") || "";
      setKey(k);
    } catch {
      // ignore
    }
    setOrigin(API_URL || (typeof window !== "undefined" ? window.location.origin : ""));
  }, []);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  };

  const cliInstall = useCliInstallCommand();
  const keyForUrl = key || "YOUR_KEY";
  // Streamable HTTP (modern MCP transport, since spec 2025-03) — used by
  // Claude Code (CLI + Desktop). Cleaner protocol, single endpoint, better
  // through proxies. Other clients (Codex / Cursor / Windsurf) may not
  // support it yet → those keep using SSE URL below for compatibility.
  // Trailing slash on `/mcp/` so nginx's `^/(api|mcp)/` regex matches and
  // proxies straight to the Node server. Bare `/mcp` falls through to
  // Next.js and triggers a 301 to `/mcp/` — POST clients don't follow that.
  const mcpUrl = `${origin}/mcp/?key=${keyForUrl}`;
  const mcpSseUrl = `${origin}/mcp/sse?key=${keyForUrl}`;
  const claudeCodeCommand = `claude mcp add router --transport http --scope user "${mcpUrl}"`;

  return (
    <div className="fade-up flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{t("setup.title")}</h1>
        <p className="text-sm text-(--muted) mt-1">{t("setup.subtitle")}</p>
      </div>

      {/* Tab switcher — MCP first (default; CLI doesn't work in CC Desktop / claude.ai web) */}
      <div className="flex gap-2 border-b border-(--card-border) mb-6">
        <button
          type="button"
          onClick={() => setTab("mcp")}
          className={`cursor-pointer px-3 py-2 text-sm transition-colors ${
            tab === "mcp"
              ? "border-b-2 border-(--accent) text-foreground font-medium"
              : "text-(--muted) hover:text-foreground"
          }`}
        >
          {t("setup.tabMcp")}
        </button>
        <button
          type="button"
          onClick={() => setTab("cli")}
          className={`cursor-pointer px-3 py-2 text-sm transition-colors ${
            tab === "cli"
              ? "border-b-2 border-(--accent) text-foreground font-medium"
              : "text-(--muted) hover:text-foreground"
          }`}
        >
          {t("setup.tabCli")}
        </button>
      </div>

      {tab === "cli" && (
        <section className="bg-(--card) rounded-xl border border-(--card-border) p-6">
          <h2 className="text-sm font-bold mb-2">{t("setup.cliHeading")}</h2>
          <p className="text-sm text-(--muted) mb-3">
            {t("setup.cliBodyPre")}<code className="font-mono text-xs">router init</code>{t("setup.cliBodyPost")}
          </p>
          <div className="mb-3 bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-xs text-blue-900 leading-relaxed">
            {t("setup.cliClientsTip")}
          </div>
          <div className="relative bg-black/5 dark:bg-white/5 rounded-lg p-3 mb-3 font-mono text-xs break-all pr-16">
            <pre className="whitespace-pre-wrap">{cliInstall}</pre>
            <button
              type="button"
              onClick={() => copyToClipboard(cliInstall, "cli")}
              className="cursor-pointer absolute top-2 right-2 text-xs px-2 py-1 bg-(--card) border border-(--card-border) rounded hover:bg-(--accent-light) transition-colors"
            >
              {copied === "cli" ? t("common.copied") : t("common.copy")}
            </button>
          </div>
          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-900 dark:text-blue-200 leading-relaxed mb-3">
            <p className="font-medium mb-1">{t("setup.cliClientNoteTitle")}</p>
            <p>{t("setup.cliClientNoteBody")}</p>
          </div>
          <p className="text-xs text-(--muted)">
            {t("setup.cliFootnotePre")}<span className="font-mono">&ldquo;sync this&rdquo;</span>{t("setup.cliFootnotePost")}
          </p>
        </section>
      )}

      {tab === "mcp" && (
        <section className="bg-(--card) rounded-xl border border-(--card-border) p-6">
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-xs text-blue-900 leading-relaxed">
            {t("setup.mcpClientsTip")}
          </div>
          <p className="text-sm text-(--muted) mb-4">{t("setup.mcpBody")}</p>

          <h2 className="text-sm font-bold mb-2">{t("setup.claudeCode")}</h2>
          <div className="relative bg-black/5 dark:bg-white/5 rounded-lg p-3 mb-4 font-mono text-xs break-all pr-16">
            {claudeCodeCommand}
            <button
              type="button"
              onClick={() => copyToClipboard(claudeCodeCommand, "cmd")}
              className="cursor-pointer absolute top-2 right-2 text-xs px-2 py-1 bg-(--card) border border-(--card-border) rounded hover:bg-(--accent-light) transition-colors"
            >
              {copied === "cmd" ? t("common.copied") : t("common.copy")}
            </button>
          </div>

          <h2 className="text-sm font-bold mb-2">{t("setup.desktopWeb")}</h2>
          <div className="relative bg-black/5 dark:bg-white/5 rounded-lg p-3 mb-3 font-mono text-xs break-all pr-16">
            {mcpUrl}
            <button
              type="button"
              onClick={() => copyToClipboard(mcpUrl, "url")}
              className="cursor-pointer absolute top-2 right-2 text-xs px-2 py-1 bg-(--card) border border-(--card-border) rounded hover:bg-(--accent-light) transition-colors"
            >
              {copied === "url" ? t("common.copied") : t("common.copy")}
            </button>
          </div>
          <div className="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
            <p className="font-medium mb-1">⚠ {t("setup.desktopMemoryNoteTitle")}</p>
            <p>{t("setup.desktopMemoryNoteBody")}</p>
          </div>

          <h2 className="text-sm font-bold mb-2">{t("setup.mcpClientCodex")}</h2>
          <p className="text-xs text-(--muted) mb-2">{t("settings.codexManualPath")}</p>
          <div className="relative bg-black/5 dark:bg-white/5 rounded-lg p-3 mb-4 font-mono text-xs break-all pr-16">
            <pre className="whitespace-pre-wrap">{`[mcp_servers.router]
type = "http"
url = "${mcpUrl}"`}</pre>
            <button
              type="button"
              onClick={() => copyToClipboard(`[mcp_servers.router]\ntype = "http"\nurl = "${mcpUrl}"`, "codex")}
              className="cursor-pointer absolute top-2 right-2 text-xs px-2 py-1 bg-(--card) border border-(--card-border) rounded hover:bg-(--accent-light) transition-colors"
            >
              {copied === "codex" ? t("common.copied") : t("common.copy")}
            </button>
          </div>

          <h2 className="text-sm font-bold mb-2">{t("setup.mcpClientCursor")}</h2>
          <p className="text-xs text-(--muted) mb-2">{t("settings.cursorManualPath")}</p>
          <div className="relative bg-black/5 dark:bg-white/5 rounded-lg p-3 mb-4 font-mono text-xs break-all pr-16">
            <pre className="whitespace-pre-wrap">{`{
  "mcpServers": {
    "router": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`}</pre>
            <button
              type="button"
              onClick={() => copyToClipboard(`{\n  "mcpServers": {\n    "router": {\n      "type": "http",\n      "url": "${mcpUrl}"\n    }\n  }\n}`, "cursor")}
              className="cursor-pointer absolute top-2 right-2 text-xs px-2 py-1 bg-(--card) border border-(--card-border) rounded hover:bg-(--accent-light) transition-colors"
            >
              {copied === "cursor" ? t("common.copied") : t("common.copy")}
            </button>
          </div>

          <h2 className="text-sm font-bold mb-2">{t("setup.mcpClientOthers")}</h2>
          <p className="text-xs text-(--muted) mb-2">{t("setup.othersManualPath")}</p>
          <div className="relative bg-black/5 dark:bg-white/5 rounded-lg p-3 mb-2 text-xs break-all pr-16 font-mono">
            {mcpUrl}
            <button
              type="button"
              onClick={() => copyToClipboard(mcpUrl, "others")}
              className="cursor-pointer absolute top-2 right-2 text-xs px-2 py-1 bg-(--card) border border-(--card-border) rounded hover:bg-(--accent-light) transition-colors"
            >
              {copied === "others" ? t("common.copied") : t("common.copy")}
            </button>
          </div>
          <p className="text-xs text-(--muted) mb-1">{t("setup.othersHint")}</p>
          <p className="text-xs text-(--muted-light) mb-4">
            <a href={t("setup.othersDocsUrl")} target="_blank" rel="noopener noreferrer" className="underline hover:text-(--accent)">
              {t("setup.othersDocsLink")} ↗
            </a>
          </p>

          {/* Legacy SSE — deprecated, only for clients without Streamable HTTP support */}
          <details className="mt-6 mb-4 group">
            <summary className="text-xs text-(--muted-light) cursor-pointer hover:text-foreground select-none">
              {t("setup.legacySseSummary")}
            </summary>
            <div className="mt-2 p-3 rounded-lg border border-(--card-border) bg-black/2 dark:bg-white/2 text-xs text-(--muted) leading-relaxed">
              <p className="mb-2">{t("setup.legacySseBody")}</p>
              <div className="relative bg-black/5 dark:bg-white/5 rounded p-2.5 mb-1 font-mono text-xs break-all pr-16">
                {mcpSseUrl}
                <button
                  type="button"
                  onClick={() => copyToClipboard(mcpSseUrl, "sse-legacy")}
                  className="cursor-pointer absolute top-1.5 right-2 text-xs px-2 py-0.5 bg-(--card) border border-(--card-border) rounded hover:bg-(--accent-light) transition-colors"
                >
                  {copied === "sse-legacy" ? t("common.copied") : t("common.copy")}
                </button>
              </div>
            </div>
          </details>

          <p className="text-xs text-(--muted)">
            {t("setup.settingsLinkPre")}<a href="/settings" className="underline">{t("setup.settingsLinkLabel")}</a>{t("setup.settingsLinkPost")}
            {!key && <> {t("setup.notLoggedInPre")}<a href="/" className="underline">{t("setup.notLoggedInLabel")}</a>{t("setup.notLoggedInPost")}</>}
          </p>
        </section>
      )}
    </div>
  );
}
