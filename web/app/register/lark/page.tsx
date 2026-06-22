"use client";

import { useState, useEffect } from "react";
import {
  getLarkRegisterPending,
  completeLarkRegistration,
  type LarkPendingRegistration,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useServerInfo } from "@/lib/server-info";

type Step = "loading" | "form" | "expired" | "done";

export default function LarkRegisterPage() {
  const { t } = useI18n();
  const { features, loaded } = useServerInfo();
  const [step, setStep] = useState<Step>("loading");

  // Redirect away when Lark is disabled — this entire flow needs a Lark
  // OAuth callback to make sense.
  useEffect(() => {
    if (typeof window === "undefined" || !loaded) return;
    if (!features.platforms.includes("lark")) {
      window.location.replace(`/register`);
    }
  }, [loaded, features.platforms]);
  const [pendingToken, setPendingToken] = useState("");
  const [pending, setPending] = useState<LarkPendingRegistration | null>(null);
  const [handle, setHandle] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [teamId, setTeamId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("pending");
    if (!token) { setStep("expired"); return; }
    setPendingToken(token);
    // Pre-fill invite_code if it came through from /register?invite=XXX → Lark OAuth
    const prefilledInvite = params.get("invite_code");
    if (prefilledInvite) setInviteCode(prefilledInvite);

    getLarkRegisterPending(token).then(p => {
      if (!p) { setStep("expired"); return; }
      setPending(p);
      setStep("form");
    });
  }, []);

  const onSubmit = async () => {
    setError("");
    const h = handle.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,14}$/.test(h)) {
      setError(t("lark.register.errorHandleFormat"));
      return;
    }
    if (!inviteCode.trim()) {
      setError(t("lark.register.errorInviteRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const r = await completeLarkRegistration({
        pending: pendingToken,
        handle: h,
        invite_code: inviteCode.trim(),
      });
      // Cache the plaintext key in localStorage so /settings can render
      // CC MCP commands with it. This is a convenience cache for the user's
      // own reference — auth itself runs through cookie. Cleared only on
      // logout or explicit rotation.
      localStorage.setItem("router_key", r.secret_key);
      localStorage.setItem("router_handle", r.handle);
      setSecretKey(r.secret_key);
      setTeamId(r.teamId);
      setStep("done");
    } catch (e: any) {
      const msg = (e.message || "").toString();
      if (msg.includes("invalid_invite_code")) setError(t("lark.register.errorInviteInvalid"));
      else if (msg.includes("handle_taken")) setError(t("lark.register.errorHandleTaken", { handle: h }));
      else if (msg.includes("invalid_handle")) setError(t("lark.register.errorHandleFormatServer"));
      else if (msg.includes("pending_not_found_or_expired")) { setStep("expired"); return; }
      else if (msg.includes("lark_account_already_bound")) setError(t("lark.register.errorBoundElsewhere"));
      else setError(t("lark.register.errorGeneric", { msg }));
    } finally { setSubmitting(false); }
  };

  if (step === "loading") {
    return <div className="flex-1 flex items-center justify-center text-sm text-neutral-500">{t("lark.register.loading")}</div>;
  }

  if (step === "expired") {
    return (
      <div className="max-w-md mx-auto py-12 px-4">
        <h1 className="text-xl font-semibold mb-3">{t("lark.register.expiredTitle")}</h1>
        <p className="text-sm text-neutral-600 mb-4">{t("lark.register.expiredBody")}</p>
        <a href="/" className="inline-block text-sm font-medium bg-(--accent) text-white px-4 py-2 rounded-lg">{t("lark.register.expiredCta")}</a>
      </div>
    );
  }

  if (step === "done") {
    const origin = (typeof window !== "undefined") ? window.location.origin : "";
    const mcpUrl = `${origin}/mcp/sse?key=${secretKey}`;
    const ccCmd = `claude mcp add router --transport sse --scope user "${mcpUrl}"`;
    const codexJson = `{
  "mcpServers": {
    "router": {
      "type": "sse",
      "url": "${mcpUrl}"
    }
  }
}`;

    // Subtitle has a {teamId} placeholder
    const subtitleParts = t("lark.register.doneSubtitle").split("{teamId}");
    // Step1 hint has {settings} placeholder
    const step1HintParts = t("lark.register.doneStep1Hint").split("{settings}");

    return (
      <div className="max-w-2xl mx-auto py-10 px-4">
        <h1 className="text-xl font-semibold mb-3">{t("lark.register.doneTitle")}</h1>
        <p className="text-sm text-neutral-700 mb-5">
          {subtitleParts[0]}<strong>{teamId}</strong>{subtitleParts[1] || ""}
        </p>

        {/* Step 1: Save key */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <p className="text-xs font-semibold text-amber-800 mb-2">{t("lark.register.doneStep1Title")}</p>
          <div className="font-mono text-xs break-all bg-white border border-amber-200 rounded p-2">{secretKey}</div>
          <button
            onClick={() => { navigator.clipboard.writeText(secretKey); }}
            className="cursor-pointer mt-2 text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-300 hover:bg-amber-100">
            {t("lark.register.copyKey")}
          </button>
          <p className="mt-2 text-xs text-amber-700 leading-relaxed">
            {step1HintParts[0]}
            <a className="underline" href="/settings#mcp-credential">{t("lark.register.doneStep1Settings")}</a>
            {step1HintParts[1] || ""}
          </p>
        </div>

        {/* Step 2: Connect Claude Code */}
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 mb-4">
          <p className="text-xs font-semibold mb-2">{t("lark.register.doneStep2Title")}</p>
          <p className="text-xs text-neutral-600 mb-2">{t("lark.register.doneStep2Hint")}</p>
          <div className="relative bg-neutral-900 rounded-lg p-3 mb-3 font-mono text-xs text-green-400 break-all pr-16">
            {ccCmd}
            <button
              onClick={() => { navigator.clipboard.writeText(ccCmd); }}
              className="absolute top-2 right-2 text-xs px-2 py-1 bg-neutral-700 text-neutral-200 rounded hover:bg-neutral-600">
              {t("lark.register.copy")}
            </button>
          </div>
          <details className="text-xs text-neutral-600">
            <summary className="cursor-pointer hover:text-neutral-900">{t("lark.register.doneStep2OtherTitle")}</summary>
            <p className="mt-2 mb-1">{t("lark.register.doneStep2OtherHint")}</p>
            <div className="relative bg-neutral-900 rounded-lg p-3 font-mono text-xs text-green-400 break-all pr-16">
              <pre className="whitespace-pre-wrap">{codexJson}</pre>
              <button
                onClick={() => { navigator.clipboard.writeText(codexJson); }}
                className="absolute top-2 right-2 text-xs px-2 py-1 bg-neutral-700 text-neutral-200 rounded hover:bg-neutral-600">
                {t("lark.register.copy")}
              </button>
            </div>
          </details>
        </div>

        {/* Step 3: Done */}
        <a href="/" className="block w-full text-center text-sm font-medium py-3 rounded-lg bg-(--accent) text-white hover:bg-(--accent-hover)">
          {t("lark.register.goToDashboard")}
        </a>
      </div>
    );
  }

  // step === "form"
  const inviteHintParts = t("lark.register.inviteHint").split("{link}");

  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <h1 className="text-xl font-semibold mb-3">{t("lark.register.title")}</h1>

      <div className="bg-(--card) border border-(--card-border) rounded-2xl p-6 mb-4">
        <div className="text-xs text-neutral-500 mb-2">{t("lark.register.identifiedTitle")}</div>
        <div className="flex items-center gap-3">
          {pending?.avatarUrl && <img src={pending.avatarUrl} alt="" className="w-10 h-10 rounded-full" />}
          <div>
            <div className="font-medium">{pending?.name || t("lark.register.noName")}</div>
            <div className="text-xs text-neutral-500 font-mono break-all">{pending?.openId}</div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">{t("lark.register.handleLabel")}</label>
          <input
            value={handle}
            onChange={e => setHandle(e.target.value)}
            placeholder={t("lark.register.handlePlaceholder")}
            className="w-full text-sm px-4 py-3 rounded-xl border border-neutral-200 focus:outline-none focus:border-neutral-400 transition-colors" />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">{t("lark.register.inviteLabel")}</label>
          <input
            value={inviteCode}
            onChange={e => setInviteCode(e.target.value)}
            placeholder={t("lark.register.invitePlaceholder")}
            className="w-full text-sm px-4 py-3 rounded-xl border border-neutral-200 focus:outline-none focus:border-neutral-400 transition-colors" />
          <p className="text-xs text-neutral-400 mt-1">
            {inviteHintParts[0]}
            <a href="/register" className="underline">{t("lark.register.inviteHintLink")}</a>
            {inviteHintParts[1] || ""}
          </p>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="cursor-pointer w-full bg-(--accent) text-white text-sm font-medium py-3 rounded-xl hover:bg-(--accent-hover) disabled:opacity-50 transition-colors">
          {submitting ? t("lark.register.submitting") : t("lark.register.submit")}
        </button>
      </div>
    </div>
  );
}
