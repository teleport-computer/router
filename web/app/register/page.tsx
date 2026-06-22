"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { useServerInfo } from "@/lib/server-info";
import { useCliInstallCommand } from "@/lib/cli-install-command";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

type Step = "choose" | "create" | "join" | "done-key" | "done-connect" | "done-try";

export default function RegisterPage() {
  const { t } = useI18n();
  const { features } = useServerInfo();
  const [step, setStep] = useState<Step>("choose");
  const [handle, setHandle] = useState("");
  const [teamName, setTeamName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [teamId, setTeamId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [topTab, setTopTab] = useState<"cli" | "mcp">("mcp");
  const [mcpClient, setMcpClient] = useState<"code" | "desktop" | "codex" | "cursor" | "others">("code");

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // If ?invite=CODE is in the URL, prefill the code. Stay on the "choose" step
  // so the user picks: secret_key join OR Lark register. The choose step renders
  // an invite-aware variant when inviteCode is non-empty.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("invite");
    if (code) setInviteCode(code.trim());
    // Surface ?error=lark_already_bound&handle=X coming back from a Lark
    // OAuth callback when the user's Lark is already linked to another
    // router account.
    const err = params.get("error");
    if (err === "lark_already_bound") {
      const h = params.get("handle") || "?";
      setError(t("lark.errorAlreadyBoundOnInvite", { handle: h }));
      // Strip params from URL so refresh doesn't re-show
      const cleaned = code ? `/register?invite=${encodeURIComponent(code)}` : "/register";
      window.history.replaceState({}, "", cleaned);
    }
  }, [t]);

  const origin = API_URL || (typeof window !== "undefined" ? window.location.origin : "");
  // New users start with the modern Streamable HTTP transport — no legacy
  // SSE fallback shown here (only on /setup + /settings, for migrating users).
  // See /setup for the trailing-slash rationale (nginx regex match).
  const mcpUrl = `${origin}/mcp/?key=${secretKey}`;
  const claudeCodeCommand = `claude mcp add router --transport http --scope user "${mcpUrl}"`;
  const cliInstall = useCliInstallCommand();


  const handleCreate = async () => {
    setError("");
    setLoading(true);
    try {
      const keyRes = await fetch(`${API_URL}/api/identity/generate`, { method: "POST" });
      const { secret_key } = await keyRes.json();

      const res = await fetch(`${API_URL}/api/team/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret_key, handle, team_name: teamName }),
      });
      const data = await res.json();

      if (!res.ok) { setError(data.error); setLoading(false); return; }

      setSecretKey(secret_key);
      setTeamId(data.team.id);
      setStep("done-key");
    } catch {
      setError(t("register.failedServer"));
    }
    setLoading(false);
  };

  const handleJoin = async () => {
    setError("");
    setLoading(true);
    try {
      const keyRes = await fetch(`${API_URL}/api/identity/generate`, { method: "POST" });
      const { secret_key } = await keyRes.json();

      const res = await fetch(`${API_URL}/api/identity/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret_key, handle, invite_code: inviteCode }),
      });
      const data = await res.json();

      if (!res.ok) { setError(data.error); setLoading(false); return; }

      setSecretKey(secret_key);
      setTeamId(data.user.teamId);
      setStep("done-key");
    } catch {
      setError(t("register.failedServer"));
    }
    setLoading(false);
  };

  // ── Step 1: Choose ──
  if (step === "choose") {
    const cameFromInvite = !!inviteCode;
    const startLarkRegister = async () => {
      setError("");
      try {
        const { authorize_url } = await import("@/lib/api").then(m => m.larkLogin({
          inviteCode: cameFromInvite ? inviteCode : undefined,
        }));
        window.location.href = authorize_url;
      } catch (e: any) {
        setError(e.message?.includes("503") ? t("lark.loginUnavailable") : t("lark.loginFailed"));
      }
    };

    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
          <h1 className="text-xl font-bold mb-1">{t("register.teamworkTitle")}</h1>
          <p className="text-sm text-gray-500 mb-6">
            {cameFromInvite
              ? <>{t("register.joinTeamSubtitle")} · <span className="font-mono text-gray-700 break-all">{inviteCode}</span></>
              : t("register.teamworkSubtitle")}
          </p>

          {/* When user arrived via invite link, show only 2 join paths.
              Otherwise show all 3 (create / join / lark). */}
          {!cameFromInvite && (
            <button onClick={() => setStep("create")}
              className="cursor-pointer w-full bg-gray-900 text-white text-sm font-medium py-3 rounded-lg hover:bg-gray-800 transition-colors mb-3">
              {t("register.createTeam")}
            </button>
          )}
          <button onClick={() => setStep("join")}
            className={`cursor-pointer w-full text-sm font-medium py-3 rounded-lg mb-3 transition-colors ${
              cameFromInvite
                ? "bg-gray-900 text-white hover:bg-gray-800"
                : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 hover:border-gray-400"
            }`}>
            {cameFromInvite ? t("register.joinButton") : t("register.joinWithInvite")}
          </button>

          {/* Lark register — must use invite_code to join an existing team. */}
          {features.platforms.includes("lark") && (
            <button
              onClick={startLarkRegister}
              className="cursor-pointer w-full bg-white text-gray-700 text-sm font-medium py-3 rounded-lg border border-gray-200 hover:bg-gray-50 hover:border-gray-400 transition-colors">
              {t("lark.registerButton")}
            </button>
          )}

          {error && <p className="text-xs text-red-500 mt-3">{error}</p>}

          <div className="mt-6 pt-4 border-t border-gray-100 text-center">
            <a href="/" className="text-xs text-gray-400 hover:text-gray-600">
              {t("register.alreadyHaveKey")}
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2a: Create team form ──
  if (step === "create") {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
          <button onClick={() => setStep("choose")} className="text-sm text-gray-400 hover:text-gray-600 mb-4 block">{t("register.back")}</button>
          <h1 className="text-xl font-bold mb-1">{t("register.createTeam")}</h1>
          <p className="text-sm text-gray-500 mb-6">{t("register.createTeamSubtitle")}</p>

          <label className="block text-xs font-medium text-gray-500 mb-1">{t("register.yourHandle")}</label>
          <input type="text" value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            placeholder={t("register.handlePlaceholderExample")} maxLength={15}
            className="w-full text-sm px-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:border-gray-400 mb-4" />

          <label className="block text-xs font-medium text-gray-500 mb-1">{t("register.teamName")}</label>
          <input type="text" value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder={t("register.teamNamePlaceholder")}
            className="w-full text-sm px-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:border-gray-400 mb-4" />

          {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

          <button onClick={handleCreate} disabled={!handle || !teamName || loading}
            className="w-full bg-gray-900 text-white text-sm font-medium py-3 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? t("register.creatingEllipsis") : t("register.createButton")}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 2b: Join team form ──
  if (step === "join") {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
          <button onClick={() => setStep("choose")} className="text-sm text-gray-400 hover:text-gray-600 mb-4 block">{t("register.back")}</button>
          <h1 className="text-xl font-bold mb-1">{t("register.joinTeam")}</h1>
          <p className="text-sm text-gray-500 mb-6">{t("register.joinTeamSubtitle")}</p>

          <label className="block text-xs font-medium text-gray-500 mb-1">{t("register.yourHandle")}</label>
          <input type="text" value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            placeholder={t("register.handlePlaceholderExample")} maxLength={15}
            className="w-full text-sm px-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:border-gray-400 mb-4" />

          <label className="block text-xs font-medium text-gray-500 mb-1">{t("register.inviteCode")}</label>
          <input type="text" value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder={t("register.inviteCodePlaceholderExample")}
            className="w-full text-sm px-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:border-gray-400 mb-4" />

          {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

          <button onClick={handleJoin} disabled={!handle || !inviteCode || loading}
            className="w-full bg-gray-900 text-white text-sm font-medium py-3 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? t("register.joiningEllipsis") : t("register.joinButton")}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 3: Save your key ──
  if (step === "done-key") {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-md">
          {/* Progress indicator */}
          <div className="flex items-center gap-2 mb-6 text-xs text-gray-400">
            <span className="w-6 h-6 rounded-full bg-gray-900 text-white flex items-center justify-center font-bold">1</span>
            <span className="font-medium text-gray-900">{t("register.progressSaveKey")}</span>
            <span className="flex-1 h-px bg-gray-200" />
            <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center font-bold">2</span>
            <span>{t("register.progressConnect")}</span>
            <span className="flex-1 h-px bg-gray-200" />
            <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center font-bold">3</span>
            <span>{t("register.progressTryIt")}</span>
          </div>

          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold mb-1">{t("register.doneTitle")}</h1>
          <p className="text-sm text-gray-500 mb-4">
            {t("register.teamLabel")}: <strong>{teamId}</strong> &middot; {t("register.handleLabel")}: <strong>@{handle}</strong>
          </p>

          <label className="block text-xs font-medium text-red-500 mb-1">
            {t("register.saveKeyWarning")}
          </label>
          <div className="relative bg-gray-50 rounded-lg p-3 mb-2 font-mono text-xs break-all border border-gray-200 pr-16">
            {secretKey}
            <button
              onClick={() => copyToClipboard(secretKey)}
              className="absolute top-2 right-2 text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-100 transition-colors"
            >
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-6">{t("register.keepSafe")}</p>

          <button onClick={() => setStep("done-connect")}
            className="w-full bg-gray-900 text-white text-sm font-medium py-3 rounded-lg hover:bg-gray-800 transition-colors">
            {t("register.iSavedItNext")}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 4: Connect Claude ──
  if (step === "done-connect") {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-md">
          {/* Progress indicator */}
          <div className="flex items-center gap-2 mb-6 text-xs text-gray-400">
            <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center font-bold">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            </span>
            <span>{t("register.progressSaveKey")}</span>
            <span className="flex-1 h-px bg-gray-200" />
            <span className="w-6 h-6 rounded-full bg-gray-900 text-white flex items-center justify-center font-bold">2</span>
            <span className="font-medium text-gray-900">{t("register.progressConnect")}</span>
            <span className="flex-1 h-px bg-gray-200" />
            <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center font-bold">3</span>
            <span>{t("register.progressTryIt")}</span>
          </div>

          <h1 className="text-xl font-bold mb-1">{t("register.connectYourClaude")}</h1>
          <p className="text-sm text-gray-500 mb-4">{t("register.connectSubtitle")}</p>

          {/* Top tabs: MCP first (default; CLI doesn't work in CC Desktop / claude.ai web) */}
          <div className="grid grid-cols-2 gap-1 mb-4">
            <button onClick={() => setTopTab("mcp")}
              className={`text-xs font-medium py-2 rounded-md border transition-colors ${topTab === "mcp" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
              MCP
            </button>
            <button onClick={() => setTopTab("cli")}
              className={`text-xs font-medium py-2 rounded-md border transition-colors ${topTab === "cli" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
              CLI
            </button>
          </div>

          {topTab === "cli" ? (
            <div>
              <p className="text-xs font-medium text-gray-700 mb-2">{t("setup.cliHeading")}</p>
              <p className="text-xs text-gray-500 mb-2">
                {t("setup.cliBodyPre")}<code className="font-mono">router init</code>{t("setup.cliBodyPost")}
              </p>
              <div className="relative bg-gray-900 rounded-lg p-3 mb-3 font-mono text-xs text-green-400 break-all pr-16">
                <pre className="whitespace-pre-wrap">{cliInstall}</pre>
                <button onClick={() => copyToClipboard(cliInstall)}
                  className="absolute top-2 right-2 text-xs px-2 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors">
                  {copied ? t("common.copied") : t("common.copy")}
                </button>
              </div>
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 leading-relaxed mb-3">
                <p className="font-medium mb-1">{t("setup.cliClientNoteTitle")}</p>
                <p>{t("setup.cliClientNoteBody")}</p>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                {t("setup.cliFootnotePre")}<span className="font-mono">&ldquo;sync this&rdquo;</span>{t("setup.cliFootnotePost")}
              </p>
            </div>
          ) : (
            <div>
              {/* MCP platform sub-tabs */}
              <div className="grid grid-cols-2 gap-1 mb-4">
                <button onClick={() => setMcpClient("code")}
                  className={`text-xs font-medium py-2 rounded-md border transition-colors ${mcpClient === "code" ? "bg-gray-700 text-white border-gray-700" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  Claude Code
                </button>
                <button onClick={() => setMcpClient("desktop")}
                  className={`text-xs font-medium py-2 rounded-md border transition-colors ${mcpClient === "desktop" ? "bg-gray-700 text-white border-gray-700" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  Desktop / Web
                </button>
                <button onClick={() => setMcpClient("codex")}
                  className={`text-xs font-medium py-2 rounded-md border transition-colors ${mcpClient === "codex" ? "bg-gray-700 text-white border-gray-700" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  Codex
                </button>
                <button onClick={() => setMcpClient("cursor")}
                  className={`text-xs font-medium py-2 rounded-md border transition-colors ${mcpClient === "cursor" ? "bg-gray-700 text-white border-gray-700" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  Cursor
                </button>
                <button onClick={() => setMcpClient("others")}
                  className={`col-span-2 text-xs font-medium py-2 rounded-md border transition-colors ${mcpClient === "others" ? "bg-gray-700 text-white border-gray-700" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  {t("setup.mcpClientOthers")}
                </button>
              </div>

              {mcpClient === "code" ? (
                <div>
                  <p className="text-xs font-medium text-gray-700 mb-2">{t("register.step2ConnectTitle")}</p>
                  <p className="text-xs text-gray-500 mb-2">{t("register.step1Run")}</p>
                  <div className="relative bg-gray-900 rounded-lg p-3 mb-4 font-mono text-xs text-green-400 break-all pr-16">
                    {claudeCodeCommand}
                    <button onClick={() => copyToClipboard(claudeCodeCommand)}
                      className="absolute top-2 right-2 text-xs px-2 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors">
                      {copied ? t("common.copied") : t("common.copy")}
                    </button>
                  </div>
                  <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-xs text-green-800 mb-4">
                    {t("register.autoSkillShort")}
                  </div>
                </div>
              ) : mcpClient === "desktop" ? (
                <div>
                  <p className="text-xs font-medium text-gray-700 mb-2">{t("register.step2ConnectTitle")}</p>
                  <p className="text-xs text-gray-500 mb-2">{t("register.goToConnectorsHint")}</p>
                  <div className="space-y-3 mb-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">{t("settings.nameLabel")}</label>
                      <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm border border-gray-200 font-mono">router</div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">{t("settings.urlLabel")}</label>
                      <div className="relative bg-gray-50 rounded-lg px-3 py-2 text-xs border border-gray-200 font-mono break-all pr-16">
                        {mcpUrl}
                        <button onClick={() => copyToClipboard(mcpUrl)}
                          className="absolute top-1.5 right-2 text-xs px-2 py-0.5 bg-white border border-gray-200 rounded hover:bg-gray-100 transition-colors">
                          {copied ? t("common.copied") : t("common.copy")}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-xs text-green-800 mb-4">
                    {t("register.autoSkillShort")}
                  </div>
                </div>
              ) : mcpClient === "codex" ? (
                <div>
                  <p className="text-xs font-medium text-gray-700 mb-2">{t("settings.codexManualPath")}</p>
                  <div className="relative bg-gray-900 rounded-lg p-3 mb-4 font-mono text-xs text-green-400 break-all pr-16">
                    <pre className="whitespace-pre-wrap">{`[mcp_servers.router]
type = "http"
url = "${mcpUrl}"`}</pre>
                    <button onClick={() => copyToClipboard(`[mcp_servers.router]\ntype = "http"\nurl = "${mcpUrl}"`)}
                      className="absolute top-2 right-2 text-xs px-2 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors">
                      {copied ? t("common.copied") : t("common.copy")}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">{t("settings.codexAlsoFor")}</p>
                  <p className="text-xs text-gray-400 mb-4">{t("settings.codexNote")}</p>
                </div>
              ) : mcpClient === "cursor" ? (
                <div>
                  <p className="text-xs font-medium text-gray-700 mb-2">{t("settings.cursorManualPath")}</p>
                  <div className="relative bg-gray-900 rounded-lg p-3 mb-4 font-mono text-xs text-green-400 break-all pr-16">
                    <pre className="whitespace-pre-wrap">{`{
  "mcpServers": {
    "router": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`}</pre>
                    <button onClick={() => copyToClipboard(`{\n  "mcpServers": {\n    "router": {\n      "type": "http",\n      "url": "${mcpUrl}"\n    }\n  }\n}`)}
                      className="absolute top-2 right-2 text-xs px-2 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors">
                      {copied ? t("common.copied") : t("common.copy")}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">{t("settings.cursorAlsoFor")}</p>
                  <p className="text-xs text-gray-400 mb-2">{t("settings.cursorNote")}</p>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-gray-700 mb-2">{t("setup.othersManualPath")}</p>
                  <div className="relative bg-gray-50 rounded-lg p-3 mb-3 text-xs border border-gray-200 font-mono break-all pr-16">
                    {mcpUrl}
                    <button onClick={() => copyToClipboard(mcpUrl)}
                      className="absolute top-2 right-2 text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-50 transition-colors">
                      {copied ? t("common.copied") : t("common.copy")}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">{t("setup.othersHint")}</p>
                  <p className="text-xs text-gray-400 mb-4">
                    <a href={t("setup.othersDocsUrl")} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">
                      {t("setup.othersDocsLink")} ↗
                    </a>
                  </p>
                </div>
              )}
            </div>
          )}

          <button onClick={() => setStep("done-try")}
            className="w-full bg-gray-900 text-white text-sm font-medium py-3 rounded-lg hover:bg-gray-800 transition-colors">
            {t("register.doneNext")}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 5: Try it out ──
  return (
    <div className="flex-1 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-md">
        {/* Progress indicator */}
        <div className="flex items-center gap-2 mb-6 text-xs text-gray-400">
          <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center font-bold">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
          </span>
          <span>{t("register.progressSaveKey")}</span>
          <span className="flex-1 h-px bg-gray-200" />
          <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center font-bold">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
          </span>
          <span>{t("register.progressConnect")}</span>
          <span className="flex-1 h-px bg-gray-200" />
          <span className="w-6 h-6 rounded-full bg-gray-900 text-white flex items-center justify-center font-bold">3</span>
          <span className="font-medium text-gray-900">{t("register.progressTryIt")}</span>
        </div>

        <h1 className="text-xl font-bold mb-1">{t("register.tryItOut")}</h1>
        <p className="text-sm text-gray-500 mb-6">{t("register.tryItOutBody")}</p>

        <div className="space-y-4 mb-6">
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold shrink-0">1</div>
            <div>
              <p className="text-sm font-medium">{t("register.step1Title")}</p>
              <p className="text-xs text-gray-500">{t("register.step1Desc")}</p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold shrink-0">2</div>
            <div>
              <p className="text-sm font-medium">{t("register.step2Title")}</p>
              <p className="text-xs text-gray-500">{t("register.step2Desc")}</p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold shrink-0">3</div>
            <div>
              <p className="text-sm font-medium">{t("register.step3Title")}</p>
              <p className="text-xs text-gray-500">{t("register.step3Desc")}</p>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-3 mb-6 text-xs text-gray-500 border border-gray-200">
          <p className="font-medium text-gray-700 mb-1">{t("register.exampleSyncTitle")}</p>
          <p>{t("register.exampleSyncLine")}</p>
          <p className="mt-1">{t("register.exampleClaudeGen")}</p>
          <p className="mt-1 text-gray-600">{t("register.exampleSummary")}</p>
          <p className="text-gray-400">{t("register.exampleTags")}</p>
        </div>

        <a href={`/?key=${encodeURIComponent(secretKey)}`}
          className="block w-full bg-gray-900 text-white text-sm font-medium py-3 rounded-lg hover:bg-gray-800 transition-colors text-center">
          {t("register.goToDashboardBtn")}
        </a>
      </div>
    </div>
  );
}
