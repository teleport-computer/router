/**
 * Teleport Router — HTTP Server
 *
 * REST API + MCP Server with key-based auth and team isolation.
 * All requests require authentication (no anonymous access).
 */

import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { randomBytes, randomUUID } from 'crypto';
import { PostgresStorage } from './postgres-storage.js';
import { runMigrations } from './migrate.js';
import { collectMentionedHandles } from './mention-collector.js';
import { detectMcpClientApp, detectHttpClientApp, INTERNAL_SOURCE } from './entry-source.js';
import { getMyUpcomingEvents, getMyOpenTasks, formatCalendarHint, createTask, createCalendarEvent } from './lark/calendar-tasks-api.js';
import {
  FileStorage,
  StagedStorage,
  type Storage,
  type RouterUser,
  type RouterEntry,
  type Channel,
  type Skill,
  type SkillTrigger,
  type SkillEffect,
  type SkillParameter,
  tokenize,
  generateEntryId,
  generateInviteCode,
  isValidChannelId,
  isValidTeamId,
  teamNameToId,
  encodePageCursor,
} from './storage.js';
import {
  generateSecretKey,
  isValidSecretKey,
  hashSecretKey,
  isValidHandle,
  normalizeHandle,
  derivePseudonym,
} from './identity.js';
import { evaluateChannelTriggers, evaluateTagTriggers, runEffects } from './webhook.js';
import { AUTO_DIGEST_TAG, BOT_DIGEST_SUMMARY_PREFIX, excludeAutoDigest, extractDigestSummary } from './digest-filter.js';
import { seedPresetTags } from './seed-preset-tags.js';
import { filterTimelineEntries, isValidTimelineDays, type TimelineDays } from './timeline-tags.js';
import { userToPreferences, validatePatch as validatePreferencesPatch, applyPatch as applyPreferencesPatch } from './cli-preferences.js';
import { buildContext } from './cli-context.js';
import { buildServerInfo } from './server-info.js';
import {
  signState, verifyState, buildAuthorizeUrl, newNonce, claimNonce,
  exchangeCodeForTokens, fetchLarkUserInfo,
  type NonceStore,
} from './lark-oauth.js';
import { loadLarkConfig, type LarkRuntimeConfig } from './lark-config.js';
import { requireEnv } from './env.js';
import {
  makePendingRegToken,
  getPendingReg as pendingRegGet,
  putPendingReg as pendingRegPut,
  consumePendingReg as pendingRegConsume,
  DEFAULT_PENDING_TTL_MS,
  type PendingLarkStore,
} from './lark-pending.js';
import { createTokenManager, type TokenManager } from './lark-tokens.js';
import { startLarkTokenRefreshCron } from './lark-token-refresh-cron.js';
import { LarkEventClient } from './lark/event-client.js';
import { createLarkApiClient, type LarkApiClient } from './lark/api-client.js';
import { pushNotificationToLark } from './lark/notification-bridge.js';
import { createEventRouter } from './lark/event-router.js';
import { handleChatMember } from './lark/handlers/chat-member.js';
import { handleReaction } from './lark/handlers/reaction.js';
import { createCommandRouter } from './lark/handlers/command-router.js';
import { createP2pMessageHandler } from './lark/handlers/p2p-message.js';
import { createSummarizer } from './lark/llm-summarize.js';
import { startAutoSummaryCron } from './lark/auto-summary.js';
import { loadLlmModels, describeLlmModels } from './lark/llm-models.js';
import { createLlmTimeRangeFallback } from './lark/llm-time-range.js';
import { createRateLimiter } from './lark/rate-limit.js';
import { createSummarizeHandler } from './lark/handlers/summarize.js';
import { createConnectHandler } from './lark/handlers/commands/connect.js';
import { createDisconnectHandler } from './lark/handlers/commands/disconnect.js';
import { createArchiveHandler } from './lark/handlers/commands/archive.js';
import { createPushHandler } from './lark/handlers/commands/push.js';
import { createWatchHandler } from './lark/handlers/commands/watch.js';
import { createStyleHandler } from './lark/handlers/commands/style.js';
import { createSettingsHandler } from './lark/handlers/commands/settings.js';
import { onMessageForWatch } from './lark/watch.js';
import { runAgent } from './lark/agent.js';
import { postOpenRouterChat } from './lark/openrouter-fetch.js';
import { TEAM_MEMORY_EXAMPLE, TEAM_MEMORY_CHAR_LIMIT, isTemplateOnly, isMemoryEmpty, parseMemorySections, findMemorySection } from './team-memory-template.js';
import { computeUserRecap, renderRecap } from './concierge.js';
import { startConciergeCron, runConciergeForAllUsers } from './concierge-cron.js';
import { SHARED_TRIGGERS, SHARED_TAG_RULES, SHARED_LANGUAGE_RULE } from './lib/router-sync-shared.js';
import { createHelpHandler } from './lark/handlers/commands/help.js';
import { fetchChatHistory } from './lark/api-client.js';
import { parseTimeRange } from './lark/parse-time-range.js';
import {
  generateMatrixLinkCode,
  isMatrixUserId,
  matrixHandleBase,
  redeemMatrixLinkCode,
} from './matrix-link-tokens.js';
import {
  buildMatrixAlreadyLinkedCopy,
  buildMatrixLinkCopy,
  buildMatrixProvisionCopy,
} from './matrix-link-copy.js';
import { MatrixProvisionReplayCache, type MatrixProvisionResult } from './matrix-provision-replay.js';
import { verifyCardSignature } from './lark/lark-signing.js';
import { handleCardAction } from './lark/handlers/card-action.js';
import { createSummaryTokenCache } from './lark/summary-token-cache.js';
import {
  ROUTER_WRITE_TOOL_DESCRIPTION,
  ROUTER_TAGS_REUSE_GUIDANCE,
  renderTagContextForLLM,
} from './entry-prompts.js';
import {
  canModerateSparks,
  detectSparks,
  evaluateSpark,
  executeSpark,
  getConnectionInfo,
  isPublishedVisibleForSparks,
  type SparkCandidate,
} from './sparks.js';
import { createMatrixSparkGatewayFromEnv } from './matrix-spark-gateway.js';
import { maybeMirrorEntryToMatrix } from './matrix-entry-mirror.js';

// Passed into evaluateChannelTriggers so that every trigger evaluation marks
// the entry as "webhook fired" — prevents the startup recovery loop from
// re-firing webhooks after a restart.
const markWebhookFired = async (entryId: string): Promise<void> => {
  try {
    await storage.updateEntry(entryId, { webhookFired: true });
  } catch (err) {
    console.error(`[webhookFired] failed to mark ${entryId}:`, err);
  }
};

// ─────────────────────────────────────────────────────────────
// MCP instructions — injected on connect, no CLAUDE.md copy required
// ─────────────────────────────────────────────────────────────

function buildRouterMcpInstructions(publicUrl: string): string {
  return `Teleport Router — team shared notebook.

WHEN TO SYNC (call router_write)
Sync immediately, without asking, when the user explicitly asks to record or share the conversation to Router. Common phrasings include (but are not limited to): "sync", "sync to router", "push to router", "save this to router", "record this", and their equivalents in any language the user is speaking. Trust your judgment on phrasing — the core intent is "put this into the team notebook".

Proactively ASK "Sync this to Router?" (do not sync yet — wait for confirmation) when the conversation produces something worth sharing with the team. Think about what a teammate would want to find later.

${SHARED_TRIGGERS}

Only ask once per conversation. If the user declines, drop it.

${SHARED_LANGUAGE_RULE}

TAGGING RULES (reuse first, invent last)
- Call router_tags first to get the available tag list.
${SHARED_TAG_RULES}

AFTER SYNCING — ALWAYS REPORT BACK
Reply must include:
1. Confirm sync succeeded (and channel, if any)
2. The summary you wrote
3. The tags you chose + a one-line reason
4. Entry ID + "publishes in 15 min"
5. Link: ${publicUrl}

router_search: search the team notebook for past entries (decisions, design docs, history, who-said-what).

PROACTIVELY call router_search (no permission needed) when ANY of these triggers fire:

1. **User asks WHY / WHEN / WHO / HISTORY about something Memory mentions** — "X 是怎么决定的" / "为什么选 Y" / "上周/之前/历史/讨论过" / "andrew 这周做啥" / "@handle ...". Memory has WHAT, router has WHY.

2. **User starts non-trivial work on a topic by name** — "I want to refactor X" / "add a feature for Y" / "改 Z 模块". Search the topic to find prior design / decisions.

3. **User explicitly says "search router / 查 router / router 里有没有"** — always search.

DO NOT call router_search for: pure technical/general questions, totally unrelated topics, same keyword already searched.

DO NOT call when:
- Question is pure technical / general knowledge with no team angle ("how do I write a for loop" / "Zustand basics")
- Topic completely unrelated to this team's work
- Same keyword set already searched in this conversation
- User just declined sync / search

ETIQUETTE:
- 0 hits → silently use Memory + general knowledge to answer the original question. Do NOT say "I searched router but found nothing" — they didn't ask, they don't need to know.
- Hits → quote with a markdown link [#entry-id](url) + a 1-sentence summary. Don't dump the whole entry.
- Same keyword set: max 1 search per conversation.

When unsure, lean toward NOT searching — but the 4 triggers above ARE the cases where you should err on the side of searching, not skipping.

HASH SKILLS
When router_write returns a "Tag skill" response (the response starts with "Tag skill — read these before writing"):
1. One or more of the tags you sent is a tag with attached prewrite skills. Treat them as INSTRUCTIONS, not just style rules — they may ask you to look up history, search by tag, check a specific person's entries, cross-reference related discussions, etc.
2. Actually CARRY OUT any lookups the skills require. You have the full Router toolset — use whichever tools are right for the task (searching past entries, reading a specific entry, checking tags, etc.). Do not skip lookups or invent results.
3. Apply the background, terminology, format, and tag rules from the skills on top of the global rules above.
4. Call router_write AGAIN with the refined summary, the same tags, and _skill_executed: true.
5. The entry is NOT saved until the second call.
6. When the second call succeeds, the response will include "Applied tag skills: ..." — you MUST name each applied skill in your final reply to the user so they know which skills shaped the entry.

HYPERLINK DISCIPLINE — entry content + chat replies
Every URL or referenced resource you write must be a clickable markdown link with descriptive anchor text. This rule has 3 categories and 2 scopes.

3 categories that MUST be linked:
  (a) Router's own resources — entries / channels / profiles / settings pages
      • Entry: [#mnk5xyz](${publicUrl}/entry?id=mnk5xyz)
      • Channel: [#frontend](${publicUrl}/channels/frontend)
      • Profile: [@andrew](${publicUrl}/profile/andrew)
      • Settings: [Team Memory](${publicUrl}/settings/memory)
  (b) Code repo references — commits / files / PRs / issues
      Get repo URL from \`git remote get-url origin\`; format as [abcd123](https://github.com/.../commit/abcd123) etc.
  (c) External sources — articles, docs, RFCs, blog posts, tickets, videos, papers
      ✅ \`we followed the approach in [React 19 actions RFC](https://github.com/.../123)\`
      ❌ raw URL pasted bare
      ❌ anchor text like "this" or "here" — readers should know where the link goes from the text alone

2 scopes:
  • In any entry you write via router_write (the \`summary\` and \`content\` markdown fields) — apply ALL 3 categories
  • In your chat reply to the user — apply category (a) so they can click through router references

Bare ids / paths / pasted URLs in entry content are dead text. Applies to Chinese and English entries equally.`;
}

// ─────────────────────────────────────────────────────────────
// Storage + MCP sessions
// ─────────────────────────────────────────────────────────────

const STAGING_DELAY_MS = parseInt(process.env.STAGING_DELAY_MS || String(15 * 60 * 1000)); // default 15 minutes

// Bump this whenever router_write's inputSchema changes (new params, renamed
// params, changed description). Frontend compares against localStorage to
// show a "please reconnect MCP" banner.
const MCP_SCHEMA_VERSION = 9;

// ─────────────────────────────────────────────────────────────
// Personal notification webhook
// ─────────────────────────────────────────────────────────────
//
// Users can register a personal webhook URL in settings. When they're
// mentioned or their entry gets a comment, we POST a payload there.
// - Lark URLs (open.feishu.cn / open.larksuite.com) get a Lark interactive
//   card with a "View entry" markdown link so the user can jump straight to
//   the entry on the web. A "1-person group + custom bot" setup then works
//   as a personal DM channel.
// - Any other URL gets a generic JSON envelope including the link.

const PERSONAL_WEBHOOK_PUBLIC_URL = requireEnv('PUBLIC_URL').replace(/\/$/, '');

// Lark OAuth scopes requested when a user binds / re-binds their Lark account.
// IMPORTANT: every scope listed here must ALSO be enabled in the Lark app
// backend (权限管理) AND the app must have a published version that includes
// it — otherwise OAuth will reject. After adding a new scope here, all users
// must re-bind to get a new user-token with the wider scope (existing tokens
// don't auto-upgrade).
const LARK_OAUTH_USER_SCOPES = [
  // ⚠️ MANDATORY for refresh_token issuance via Lark's v2 oauth endpoint.
  // Without this scope, Lark only returns a short-lived access_token (~2h)
  // and refresh_token comes back null — bindLarkAccount stores null, and
  // every subsequent getValidUserAccessToken call fails with "no valid
  // user access token". Symptoms: binding looks "done" (open_id + scopes
  // saved) but refresh-token field is null. Lark v1 issued refresh_token
  // implicitly; v2 follows OAuth 2.0 spec and requires offline_access.
  'offline_access',
  // Identity
  'contact:user.id:readonly',
  'contact:user.base:readonly',
  // Calendar — Lark splits this granularly; A needs :read, B needs :create.
  // The primary-calendar-list endpoint we call before reading events
  // (/open-apis/calendar/v4/calendars) might need its own scope too — if
  // 403 shows up in server logs, add the missing one here.
  'calendar:calendar.event:read',
  'calendar:calendar.event:create',
  // Tasks — task:task:write covers read + create + update + delete per
  // Lark backend labeling "查看、创建、更新、删除任务"; one scope is enough
  // for both A (list open tasks) and B (create task).
  'task:task:write',
];

function isLarkWebhook(url: string): boolean {
  return /^https:\/\/(open\.feishu\.cn|open\.larksuite\.com)\//.test(url);
}

type PersonalWebhookPayload = {
  type: 'mention' | 'comment' | 'other';
  fromHandle: string;
  recipient: string;
  preview: string;
  entryId?: string;
  lang?: 'en' | 'zh';
};

// Localized strings for personal notifications. Picked server-side based on
// the recipient's stored `lang` preference (falls back to English).
const PERSONAL_WEBHOOK_COPY = {
  en: {
    mention: 'mentioned you',
    comment: 'commented on your entry',
    emptyPreview: '(no content)',
    viewLink: 'View entry →',
  },
  zh: {
    mention: '在评论中 @ 了你',
    comment: '评论了你的 entry',
    emptyPreview: '(无内容)',
    viewLink: '查看详情 →',
  },
} as const;

async function sendPersonalWebhook(webhookUrl: string, payload: PersonalWebhookPayload): Promise<void> {
  try {
    const link = payload.entryId
      ? `${PERSONAL_WEBHOOK_PUBLIC_URL}/entry?id=${payload.entryId}`
      : PERSONAL_WEBHOOK_PUBLIC_URL;
    const copy = PERSONAL_WEBHOOK_COPY[payload.lang ?? 'en'];
    const actionLabel = payload.type === 'mention' ? copy.mention : copy.comment;
    const title = `@${payload.fromHandle} ${actionLabel}`;

    let body: unknown;
    if (isLarkWebhook(webhookUrl)) {
      body = {
        msg_type: 'interactive',
        card: {
          header: {
            title: { tag: 'plain_text', content: title },
            template: payload.type === 'mention' ? 'orange' : 'blue',
          },
          elements: [
            {
              tag: 'markdown',
              content: payload.preview || copy.emptyPreview,
            },
            {
              tag: 'markdown',
              content: `[${copy.viewLink}](${link})`,
            },
          ],
        },
      };
    } else {
      body = { ...payload, title, link };
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[personal webhook] ${webhookUrl} returned ${res.status}`);
    }
  } catch (err) {
    console.error(`[personal webhook] POST failed:`, err);
  }
}

// Scan an entry body for @handle mentions and fan out notifications
// (in-app notification row + personal webhook) to each distinct mentioned
// teammate. Fires only when the entry is published — callers must gate on
// `entry.publishAt` being null/undefined. Matches comment-mention semantics
// in POST /api/entries/:id/comments.
//
// Handle collection (text scan + entry.to[] + dedup + self-exclusion) lives
// in `mention-collector.ts` so the pure logic can be unit-tested.
async function notifyEntryMentions(entry: RouterEntry): Promise<void> {
  const handles = collectMentionedHandles({
    text: `${entry.summary}\n${entry.content}`,
    to: entry.to,
    selfHandle: entry.handle,
  });
  if (handles.size === 0) return;

  const preview = entry.summary.trim().slice(0, 80);
  for (const handle of handles) {
    const recipient = await storage.getUser(handle);
    if (!recipient || recipient.teamId !== entry.teamId) continue;

    await storage.addNotification({
      id: `n-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
      recipientHandle: recipient.handle,
      teamId: entry.teamId,
      type: 'mention',
      fromHandle: entry.handle,
      entryId: entry.id,
      preview,
      read: false,
      timestamp: Date.now(),
    });

    if (recipient.notificationWebhook) {
      sendPersonalWebhook(recipient.notificationWebhook, {
        type: 'mention',
        fromHandle: entry.handle,
        recipient: recipient.handle,
        preview,
        entryId: entry.id,
        lang: recipient.lang,
      }).catch(() => {});
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Shared LLM helper — all AI features (translation, digest, etc.)
// go through this single function via OpenRouter.
// ─────────────────────────────────────────────────────────────

async function callLLM(
  prompt: string,
  opts?: { model?: string; temperature?: number; maxTokens?: number },
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not configured');

  const model = opts?.model || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
  const data = await postOpenRouterChat({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: opts?.temperature ?? 0.3,
    max_tokens: opts?.maxTokens ?? 4096,
  }, key);
  return data?.choices?.[0]?.message?.content || '';
}

// ─────────────────────────────────────────────────────────────
// Translation helpers — fire on publish/edit so readers see
// translated copy without per-post clicks. Bidirectional:
// zh source → cache en translation; en source → cache zh.
// Same-language source skipped (no translation needed).
// On-demand POST /api/entries/:id/translate is preserved as a
// fallback for backfill and race-window manual triggers.
// ─────────────────────────────────────────────────────────────

type EntryTranslation = { summary: string; content?: string; oneliner?: string };

function detectSourceLangFromSample(text: string): 'zh' | 'en' {
  const sample = text.slice(0, 200);
  const cjk = (sample.match(/[一-鿿]/g) || []).length;
  // 10% threshold (was 15%) to catch bilingual entries dominated by Chinese
  // narrative but with heavy English technical-term sprinkling (which is
  // typical for this team's writing style).
  return cjk > sample.length * 0.10 ? 'zh' : 'en';
}

const TARGET_LANG_NAME: Record<'en' | 'zh', string> = {
  en: 'English',
  zh: 'Chinese (Simplified)',
};

async function translateEntry(entry: RouterEntry, targetLang: 'en' | 'zh'): Promise<EntryTranslation | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;

  const prompt = `Translate the following into ${TARGET_LANG_NAME[targetLang]}. Keep technical terms (Channel, Skill, Webhook, MCP, Tag, Entry, Router, handle, etc.) in their original form. Preserve markdown formatting. Return ONLY the translation, nothing else.

---
SUMMARY (plain text):
${entry.summary}

${entry.content ? `CONTENT (markdown):\n${entry.content}` : ''}

${entry.oneliner ? `ONELINER (headline):\n${entry.oneliner}` : ''}
---

Return your response in this exact format (preserve the labels):
SUMMARY: <translated summary>
${entry.content ? 'CONTENT: <translated content>' : ''}
${entry.oneliner ? 'ONELINER: <translated oneliner>' : ''}`;

  const raw = await callLLM(prompt, { temperature: 0.2 });
  const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]*?)(?=\n(?:CONTENT|ONELINER):|$)/i);
  const contentMatch = raw.match(/CONTENT:\s*([\s\S]*?)(?=\nONELINER:|$)/i);
  const onelinerMatch = raw.match(/ONELINER:\s*(.*)/i);
  const summary = summaryMatch?.[1]?.trim();
  // If the LLM didn't emit a SUMMARY: label, skip caching this translation.
  // The previous behaviour fell back to the entire raw response, which for
  // long entries (esp. digests) crammed the full markdown body into the
  // summary field — and `whitespace-pre-wrap` rendering then showed it as a
  // wall of plain-text markdown with visible \n\n gaps.
  if (!summary) {
    console.warn(`[translate-entry] LLM response missing SUMMARY: label; skipping cache (entry=${entry.id}, lang=${targetLang}, raw=${raw.slice(0, 80)}…)`);
    return null;
  }
  return {
    summary,
    content: contentMatch?.[1]?.trim() || undefined,
    oneliner: onelinerMatch?.[1]?.trim() || undefined,
  };
}

async function translateComment(content: string, targetLang: 'en' | 'zh'): Promise<string | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;
  const prompt = `Translate the following comment into ${TARGET_LANG_NAME[targetLang]}. Keep technical terms (Channel, Skill, Webhook, MCP, Tag, Entry, Router, handle, etc.) in their original form. Preserve markdown formatting. Return ONLY the translation, nothing else.

---
${content}`;
  const raw = await callLLM(prompt, { temperature: 0.2 });
  return raw.trim() || null;
}

/** Fire-and-forget: translate a freshly-saved entry into the opposite
 *  language. zh source → caches en; en source → caches zh. No-op if a
 *  translation is already cached. Errors are logged but never thrown. */
function autoTranslateEntry(entryId: string): void {
  (async () => {
    try {
      const entry = await storage.getEntry(entryId);
      if (!entry) return;
      const sample = entry.summary + ' ' + (entry.oneliner || '');
      const sourceLang = detectSourceLangFromSample(sample);
      const targetLang: 'en' | 'zh' = sourceLang === 'zh' ? 'en' : 'zh';
      if (entry.translations?.[targetLang]) return;
      const translation = await translateEntry(entry, targetLang);
      if (!translation) return;
      const merged = { ...(entry.translations || {}), [targetLang]: translation };
      await storage.updateEntry(entryId, { translations: merged });
    } catch (err) {
      console.error(`[auto-translate-entry] ${entryId} failed:`, err);
    }
  })();
}

/** Fire-and-forget: translate a newly-added comment into the opposite
 *  language (zh → en, en → zh). */
function autoTranslateComment(entryId: string, commentId: string): void {
  (async () => {
    try {
      const entry = await storage.getEntry(entryId);
      const comment = entry?.comments?.find(c => c.id === commentId);
      if (!comment) return;
      const sourceLang = detectSourceLangFromSample(comment.content);
      const targetLang: 'en' | 'zh' = sourceLang === 'zh' ? 'en' : 'zh';
      if (comment.translations?.[targetLang]) return;
      const translated = await translateComment(comment.content, targetLang);
      if (!translated) return;
      const merged = { ...(comment.translations || {}), [targetLang]: translated };
      await storage.updateComment(entryId, commentId, { translations: merged });
    } catch (err) {
      console.error(`[auto-translate-comment] ${entryId}/${commentId} failed:`, err);
    }
  })();
}

const dataFile = process.env.DATA_FILE || 'data.json';
const baseStorage: Storage = process.env.DATABASE_URL
  ? new PostgresStorage(process.env.DATABASE_URL)
  : new FileStorage(dataFile);
const stagedStorage = new StagedStorage(STAGING_DELAY_MS, baseStorage);
const storage: Storage = stagedStorage;

// ── Lark event client (M2b.1) ──
const _larkConfigForBot = loadLarkConfig();
let larkEventClient: LarkEventClient | null = null;
let larkApiClientForEffects: LarkApiClient | null = null;
// Hoisted to module scope so the token-refresh cron (started later) can reuse
// the same TokenManager instance. Null when Lark isn't configured.
let larkTokenManagerForEffects: TokenManager | null = null;
let summaryTokenCache: ReturnType<typeof import('./lark/summary-token-cache.js').createSummaryTokenCache> | null = null;
if (_larkConfigForBot) {
  // Lark is configured at all — construct a tokenManager+apiClient available
  // to runEffects so the bot path (push entry cards via the Lark Bot API)
  // works whenever lark_chat_bindings exist, regardless of botEnabled.
  const tokenManager = createTokenManager(storage, {
    domain: _larkConfigForBot.domain,
    appId: _larkConfigForBot.appId,
    appSecret: _larkConfigForBot.appSecret,
  });
  larkTokenManagerForEffects = tokenManager;
  const apiClient = createLarkApiClient({ domain: _larkConfigForBot.domain, tokens: tokenManager });
  larkApiClientForEffects = apiClient;

  // ── notification → Lark IM bridge (fire-and-forget) ──
  // Wrap storage.addNotification so every write also tries to push the
  // notification to the recipient's Lark IM (if they bound an account and
  // their preferences allow it). Failures are logged inside the bridge.
  {
    const publicUrlForNotif = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`;
    const origAddNotification = storage.addNotification.bind(storage);
    storage.addNotification = async (n) => {
      const written = await origAddNotification(n);
      // Fire-and-forget — never await in a way that propagates errors.
      pushNotificationToLark(written, {
        storage,
        apiClient,
        publicUrl: publicUrlForNotif,
      }).catch(() => { /* already logged inside bridge */ });
      return written;
    };
  }

  if (_larkConfigForBot.botEnabled) {
    summaryTokenCache = createSummaryTokenCache();
    // One model registry built at startup; logged so operators can verify
    // which SKU each feature ended up with without grepping source.
    const models = loadLlmModels();
    console.log(`[lark] models: ${describeLlmModels(models)}`);
    const summarizer = createSummarizer({ callLLM, model: models.summarize });
    const llmFallback = createLlmTimeRangeFallback({ callLLM, model: models.timeParse });
    const rateLimiter = createRateLimiter({
      windowMs: parseInt(process.env.LARK_SUMMARIZE_RATE_LIMIT_MS || '300000', 10),
    });
    const summarizeHandler = createSummarizeHandler({
      storage,
      apiClient,
      fetchHistory: opts => fetchChatHistory(apiClient, opts),
      summarize: summarizer,
      parseTimeRange: (q, ctx) => parseTimeRange(q, { ...ctx, llmFallback }),
      rateLimiter,
      tokenCache: summaryTokenCache,
    });
    const stubHandler = async (ctx: import('./lark/handlers/command-router.js').CommandContext) => {
      console.log(`[lark-cmd-stub] ${JSON.stringify(ctx).slice(0, 200)}`);
    };
    const PUBLIC_URL_FOR_LARK = requireEnv('PUBLIC_URL');
    const connectHandler = createConnectHandler({ storage, apiClient, publicUrl: PUBLIC_URL_FOR_LARK });
    const disconnectHandler = createDisconnectHandler({ storage, apiClient });
    const archiveHandler = createArchiveHandler({ storage, apiClient });
    const pushHandler = createPushHandler({ storage, apiClient });
    const watchHandler = createWatchHandler({ storage, apiClient });
    const styleHandler = createStyleHandler({ storage, apiClient });
    const PUBLIC_URL_VAL = requireEnv('PUBLIC_URL');
    const settingsHandler = createSettingsHandler({ storage, apiClient, publicUrl: PUBLIC_URL_VAL });
    const helpHandler = createHelpHandler({ apiClient });
    const botOpenId = process.env.LARK_BOT_OPEN_ID;
    if (!botOpenId) console.warn('[lark] LARK_BOT_OPEN_ID not set — bot will respond to ANY @-mention (legacy behavior)');
    const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? '';
    // Base agent dependencies — shared by group @-bot fallback and p2p handler.
    // triggerSummarize is rebuilt per-request to capture the actual sender_open_id
    // (each call needs the requester's identity in the synthetic /summarize call).
    const agentDepsBase = OPENROUTER_KEY ? {
      storage,
      apiClient,
      llmModel: models.agent,
      llmApiKey: OPENROUTER_KEY,
      publicUrl: PUBLIC_URL_VAL,
    } : undefined;

    const agentFallback = agentDepsBase
      ? async (req: { chatId: string; senderOpenId: string; text: string }) => {
          await runAgent(req, {
            ...agentDepsBase,
            triggerSummarize: async (chatId, timeRange) => {
              await summarizeHandler({
                message: { chat_id: chatId, message_type: 'text', content: JSON.stringify({ text: `/summarize ${timeRange}` }), mentions: [] },
                sender: { sender_id: { open_id: req.senderOpenId } },
              });
            },
          });
        }
      : undefined;
    if (!OPENROUTER_KEY) console.warn('[lark] OPENROUTER_API_KEY not set — agent fallback disabled, only slash commands work');

    // p2p (private DM) handler — same agent, different rate-limit + caller-handled
    // rate-limit guidance card. Skips work entirely if OPENROUTER not configured.
    const p2pMessageHandler = agentDepsBase
      ? createP2pMessageHandler({
          storage,
          apiClient,
          publicUrl: PUBLIC_URL_VAL,
          runAgent,
          // p2p doesn't use triggerSummarize (slash commands don't apply in DMs).
          // Cast away the optional to satisfy AgentDeps shape; agent only calls it
          // when an LLM tool requests it, and we don't expose that tool in p2p UX.
          agentDeps: agentDepsBase as any,
        })
      : null;
    if (!OPENROUTER_KEY) console.warn('[lark] OPENROUTER_API_KEY not set — p2p bot DM disabled');

    const commandRouter = createCommandRouter({
      summarize: ctx => summarizeHandler(ctx.payload),
      connect: ctx => connectHandler(ctx),
      disconnect: ctx => disconnectHandler(ctx),
      archive: ctx => archiveHandler(ctx),
      push: ctx => pushHandler(ctx),
      watch: ctx => watchHandler(ctx),
      style: ctx => styleHandler(ctx),
      settings: ctx => settingsHandler(ctx),
      help: ctx => helpHandler(ctx),
    }, { botOpenId, agentFallback });
    const watchDeps = {
      storage,
      apiClient,
      callLLM,
      llmModel: models.summarize,
    };
    const route = createEventRouter({
      message: ev => {
        // p2p (private DM): every text message → agent (via p2p handler)
        if (ev?.message?.chat_type === 'p2p') {
          if (p2pMessageHandler) {
            p2pMessageHandler(ev).catch(err =>
              console.error('[p2p-msg] handler failed:', err?.message ?? err),
            );
          }
          return;
        }
        // group: existing dual concerns
        //   1. command routing
        //   2. watch counter + maybe-trigger eval (fire-and-forget)
        commandRouter(ev);
        onMessageForWatch(ev, watchDeps, botOpenId).catch(err =>
          console.error('[watch] onMessage failed:', err?.message ?? err),
        );
      },
      member: ev => handleChatMember(ev, { apiClient }),
      reaction: (ev, kind) => handleReaction(ev, kind, { storage }),
    });
    larkEventClient = new LarkEventClient({
      appId: _larkConfigForBot.appId,
      appSecret: _larkConfigForBot.appSecret,
      domain: _larkConfigForBot.domain,
      botEnabled: true,
      onEvent: route,
      onCardAction: async (raw) => {
        const result = await handleCardAction(raw, {
          storage,
          tokenCache: summaryTokenCache ?? undefined,
          apiClient,
          publicUrl: process.env.PUBLIC_URL ?? '',
        });
        return { toast: { type: 'info', content: result.toast } };
      },
    });
    larkEventClient.start().catch(e => console.error('[lark-ws] start crashed', e));
    console.log('[lark] event client started');

    // M3b: periodic auto-summary cron — fires per chat at user-configured cadence.
    // Independent from watch (which is event-triggered). Skipped without LLM key.
    if (OPENROUTER_KEY) {
      startAutoSummaryCron({
        storage,
        apiClient,
        summarize: summarizer,
        publicUrl: PUBLIC_URL_VAL,
      });
    } else {
      console.log('[lark-autosum] skipped — no OPENROUTER_API_KEY');
    }
  } else {
    console.log('[lark] event client disabled (LARK_BOT_ENABLED=false)');
  }
} else {
  console.log('[lark] not configured');
}

const mcpSessions = new Map<string, { transport: SSEServerTransport; secretKey: string }>();
// Streamable HTTP transport (modern MCP transport, replacing SSE long-term).
// Each session has its own transport + MCP server instance, keyed by Mcp-Session-Id
// header. Lifecycle: client POSTs initialize → server creates transport → onsessioninitialized
// fires with the generated session id → we register it here. Subsequent requests with
// the same Mcp-Session-Id route through the registered transport.
const mcpStreamableSessions = new Map<
  string,
  { transport: StreamableHTTPServerTransport; secretKey: string; userHandle: string }
>();

// Rehydrate pending entries on startup so restarts don't drop staged posts.
// Fire-and-forget: the index will fill in before the first publishReady tick.
stagedStorage.rehydratePending()
  .then(n => { if (n > 0) console.log(`[staging] Rehydrated ${n} pending entries`); })
  .catch(err => console.error('[staging] Failed to rehydrate pending:', err));

// Seed preset tags on startup (idempotent — skips existing).
seedPresetTags(storage)
  .then(n => { if (n > 0) console.log(`[preset-tags] Seeded ${n} preset tags`); })
  .catch(err => console.error('[preset-tags] Failed to seed:', err));

// Watch observations cleanup — keep 30 days. Runs once at startup + every 24h.
const WATCH_OBS_RETENTION_MS = 30 * 24 * 3600 * 1000;
async function pruneWatchObservations() {
  try {
    const cutoff = Date.now() - WATCH_OBS_RETENTION_MS;
    const n = await storage.deleteLarkWatchObservationsBefore(cutoff);
    if (n > 0) console.log(`[watch-cleanup] purged ${n} observation rows older than 30 days`);
  } catch (err) {
    console.error('[watch-cleanup] failed:', err);
  }
}
pruneWatchObservations();
setInterval(pruneWatchObservations, 24 * 3600 * 1000);

// ── Digest cron runner ──────────────────────────────────────
// Checks every 60 seconds for digest skills whose schedule is due.
// Simple approach: compare lastRunAt against the schedule interval.
// weekly = must run once per 7 days, monthly = once per 30 days.

function startDigestCron() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log('[digest-cron] Skipped — no OPENROUTER_API_KEY');
    return;
  }

  setInterval(async () => {
    try {
      // Get all channels across all teams
      const published = (storage as any).published || storage;
      const allChannels = typeof published.listAllChannels === 'function'
        ? await published.listAllChannels()
        : [];

      for (const channel of allChannels) {
        for (const skill of channel.skills || []) {
          if (skill.exposeAs !== 'digest' || !skill.digestConfig) continue;

          const config = skill.digestConfig;
          const intervalMs = (config.schedule === 'monthly' ? 30 : 7) * 24 * 60 * 60 * 1000;
          const lastRun = config.lastRunAt || 0;
          const now = Date.now();

          if (now - lastRun < intervalMs) continue; // Not due yet

          console.log(`[digest-cron] Running ${config.schedule} digest for #${channel.id}`);

          const lookbackDays = config.lookbackDays || (config.schedule === 'monthly' ? 30 : 7);
          const since = now - lookbackDays * 24 * 60 * 60 * 1000;
          const allEntries = await storage.getChannelEntries(channel.teamId, channel.id, 200);
          const windowEntries = allEntries.filter((e: any) => e.timestamp >= since);
          // Exclude prior auto-generated digests so we don't re-summarize last run.
          const entries = excludeAutoDigest(windowEntries);

          if (entries.length === 0) {
            console.log(`[digest-cron] #${channel.id}: no entries, skipping`);
            config.lastRunAt = now;
            await storage.updateChannel(channel.id, { skills: channel.skills });
            continue;
          }

          const periodLabel = config.schedule === 'monthly' ? 'Monthly' : 'Weekly';
          const entrySummaries = entries.map((e: any) => {
            const date = new Date(e.timestamp).toLocaleDateString();
            return `[@${e.handle} · ${date}] ${e.summary}\nTags: ${e.tags.map((t: string) => '#' + t).join(' ')}`;
          }).join('\n\n');

          const defaultTemplate = `You are generating a ${periodLabel} Digest for the #${channel.id} channel. Below are ${entries.length} entries from the past ${lookbackDays} days. Organize them into a clear digest with: By Author, Key Decisions, Open Items, and a Summary paragraph. Write in the same language as the majority of entries.`;

          const prompt = `${skill.instructions || defaultTemplate}\n\n---\nENTRIES (${entries.length}):\n\n${entrySummaries}`;

          try {
            const digestContent = await callLLM(prompt, { temperature: 0.3 });

            // Post as entry
            if (config.postToChannel !== false) {
              // Promote the LLM's `### Summary` paragraph to the entry's
              // summary field so the feed/card shows the actual TL;DR instead
              // of a metadata stub. Bot-digest prefix preserved for the
              // cross-bot loop-prevention convention.
              const summaryFallback = `${periodLabel} digest for #${channel.id} — ${entries.length} entries over ${lookbackDays} days.`;
              const realSummary = extractDigestSummary(digestContent, summaryFallback);
              const digestEntry = await storage.addEntry({
                handle: 'router-bot',
                teamId: channel.teamId,
                client: 'code',
                content: digestContent,
                summary: `${BOT_DIGEST_SUMMARY_PREFIX}${realSummary}`,
                tags: [AUTO_DIGEST_TAG, config.schedule],
                timestamp: now,
                channel: channel.id,
                to: [`#${channel.id}`],
                oneliner: `${periodLabel} digest #${channel.id}`,
                ...INTERNAL_SOURCE,
              }, 0);

              evaluateChannelTriggers(digestEntry, channel, markWebhookFired, { larkApiClient: larkApiClientForEffects, storage }).catch(() => {});
            }

            // Push to webhook
            if (config.webhookUrl) {
              const isLark = isLarkWebhook(config.webhookUrl);
              const body = isLark ? {
                msg_type: 'interactive',
                card: {
                  header: { title: { tag: 'plain_text', content: `${periodLabel} Digest — #${channel.id}` }, template: 'purple' },
                  elements: [{ tag: 'markdown', content: digestContent.slice(0, 2000) }],
                },
              } : { type: 'digest', channel: channel.id, content: digestContent };
              await fetch(config.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              }).catch(err => console.error(`[digest-cron] webhook failed for #${channel.id}:`, err));
            }

            config.lastRunAt = now;
            await storage.updateChannel(channel.id, { skills: channel.skills });
            console.log(`[digest-cron] #${channel.id} ${config.schedule} digest done`);
          } catch (err) {
            console.error(`[digest-cron] LLM failed for #${channel.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('[digest-cron] scan error:', err);
    }
  }, 60_000); // Check every 60 seconds

  console.log('[digest-cron] Started');
}

// Trigger channel effects when entries auto-publish after staging delay
stagedStorage.onPublish = (entry) => {
  notifyEntryMentions(entry).catch(err => {
    console.error(`[AutoPublish] Failed to notify mentions for ${entry.id}:`, err);
  });
  mirrorEntryToMatrix(entry, '[AutoPublish]');
  autoTranslateEntry(entry.id);
  // Tag unification: walk every tag (and legacy entry.channel) and fire
  // tag_configs triggers for each that has a config row.
  evaluateTagTriggers(entry, storage, markWebhookFired, {
    larkApiClient: larkApiClientForEffects,
    storage,
  }).catch(err => {
    console.error(`[AutoPublish] Failed to evaluate tag triggers for ${entry.id}:`, err);
  });
};

// Translate immediate-publish entries too (bot saves, users with staging=0).
// Mentions and channel triggers are handled at the call sites for this path —
// only auto-translate needs a centralised hook.
stagedStorage.onImmediatePublish = (entry) => {
  autoTranslateEntry(entry.id);
};

// ── Startup recovery: fire webhooks for entries that were published
// while the server was down (pending map lost on restart). Looks for
// entries with a channel that were published (no publishAt) in the
// last 24h but never had their webhook fired.
async function recoverMissedWebhooks() {
  try {
    const published = (storage as any).published || storage;
    if (typeof published.pool?.query !== 'function') return; // Only works with Postgres

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const { rows } = await published.pool.query(
      `SELECT * FROM entries
       WHERE channel IS NOT NULL
         AND publish_at IS NULL
         AND (webhook_fired IS NULL OR webhook_fired = FALSE)
         AND timestamp > $1
       ORDER BY timestamp ASC`,
      [cutoff],
    );

    if (rows.length === 0) return;
    console.log(`[webhook-recovery] Found ${rows.length} entries with unfired webhooks`);

    for (const row of rows) {
      const entry = {
        id: row.id, handle: row.handle, teamId: row.team_id,
        summary: row.summary, tags: row.tags ?? [], channel: row.channel,
        timestamp: Number(row.timestamp), to: row.to_handles ?? [],
        content: row.content, client: row.client,
      };
      try {
        const fired = await evaluateTagTriggers(entry as any, storage, markWebhookFired, {
          larkApiClient: larkApiClientForEffects,
          storage,
        });
        console.log(`[webhook-recovery] Fired tag triggers for ${entry.id}: ${fired.join(', ') || '(none)'}`);
      } catch (err) {
        console.error(`[webhook-recovery] Failed for ${entry.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[webhook-recovery] Error:', err);
  }
}

// ─────────────────────────────────────────────────────────────
// Entry enrichment — joins authorDisplayName from user table
// ─────────────────────────────────────────────────────────────
async function enrichEntries(entries: RouterEntry[]): Promise<any[]> {
  const handles = [...new Set(entries.map(e => e.handle))];
  const users = await Promise.all(handles.map(h => storage.getUser(h)));
  const displayNames = new Map(handles.map((h, i) => [h, users[i]?.displayName]));
  const authorRoles = new Map(handles.map((h, i) => [h, users[i]?.role]));
  return entries.map(e => ({
    ...e,
    authorDisplayName: displayNames.get(e.handle) || undefined,
    authorRole: authorRoles.get(e.handle) || undefined,
  }));
}

async function enrichEntry(entry: RouterEntry): Promise<any> {
  const [enriched] = await enrichEntries([entry]);
  return enriched;
}

const PORT = parseInt(process.env.PORT || '3001');
const protocol = 'http';

// ─────────────────────────────────────────────────────────────
// MCP Server
// ─────────────────────────────────────────────────────────────

async function createMCPServer(secretKey: string, transportKind: 'mcp-http' | 'mcp-sse' = 'mcp-http') {
  const keyHash = hashSecretKey(secretKey);

  // Probe whether the team has configured Memory; if so, append a one-line
  // hint to the MCP instructions so CC knows the prompt is worth invoking.
  // We deliberately do NOT auto-inject the full Memory content here —
  // forcing it into every session burns context and biases all answers
  // through a "team lens", even for unrelated questions. The hint lets CC
  // pull Memory on demand via /team_memory when the conversation actually
  // calls for team context.
  let memoryHint = '';
  let syncPrefHint = '';
  // @ mention guidance — depends on Memory's People section so it's only
  // useful when Memory is non-empty. Set inside the same try/catch below.
  let mentionHint = '';
  // Per-user Lark calendar + open-tasks snapshot, fetched fresh each MCP
  // connect. Only non-empty when the user has a Lark binding AND the Lark
  // app has the calendar/task scopes. Failures (no scope, no token, network)
  // silently leave it empty — CC just doesn't get the section that session.
  let calendarHint = '';
  try {
    const sessionUser = await storage.getUserByKeyHash(keyHash);
    // ─── User-pref-driven sync behavior (parity with CLI skill) ───
    // Honors: syncMode (active/passive), previewMode (always/never),
    // privacyStripCustom (regex list). Same fields the CLI consults
    // via `router context`. Without these hints, MCP defaults to
    // active+preview-always behavior regardless of user settings.
    if (sessionUser) {
      const syncMode = sessionUser.syncMode ?? 'active';
      const previewMode = sessionUser.previewMode ?? 'always';
      const stripPatterns = sessionUser.privacyStripCustom ?? [];

      const blocks: string[] = [];

      if (syncMode === 'passive') {
        blocks.push(`SYNC MODE: PASSIVE — this user has opted OUT of proactive sync prompts. Do NOT ask "Sync to Router?" mid-conversation. Only call \`router_write\` when the user EXPLICITLY says "sync" / "记一下" / "save to router" / equivalent. Treat noteworthy moments as silent — note them in your reasoning but do not prompt.`);
      } else {
        blocks.push(`SYNC MODE: ACTIVE — proactively ask "Sync this to Router?" at noteworthy moments per the WHEN TO SYNC rules above. Wait for user confirmation before calling \`router_write\`.`);
      }

      if (previewMode === 'always') {
        blocks.push(`PREVIEW GATE — before EVERY \`router_write\` call (including express requests like "sync"), present a preview to the user containing: oneliner (~15 chars), summary (2-3 sentences), tags (1-5). WAIT for user confirmation. Only after they say go / yes / 同步 do you call \`router_write\`. PREVIEW GATE applies even when user explicitly asked to sync.`);
      } else {
        blocks.push(`PREVIEW MODE: NEVER — user has opted OUT of preview confirmation. Call \`router_write\` directly when criteria match; report the result after.`);
      }

      if (syncMode === 'passive' && stripPatterns.length > 0) {
        const patternList = stripPatterns.map(p => `  • \`${p}\``).join('\n');
        blocks.push(`PRIVACY STRIP (passive mode) — before calling \`router_write\`, run these regexes against \`summary\` and \`content\` and replace matches with [REDACTED]:\n${patternList}\n(Patterns are user-defined. Apply them in order, stay on the side of stripping more rather than less.)`);
      }

      // E — text-only mode-switch hint (no server-side decline tracking;
      // server-side state would require detecting "no" responses in chat,
      // which we can't observe at the API layer)
      blocks.push(`MODE-SWITCH HINT — if you've asked "Sync?" 3+ times and the user keeps declining, suggest: "💡 You've declined a few — want to switch to passive mode (auto-sync without asking)? Toggle at /settings/sync." Drop after suggesting once per conversation; don't nag.`);

      syncPrefHint = '═══ SYNC PREFERENCES (server-controlled, per-user) ═══\n\n' + blocks.join('\n\n') + '\n\n';
    }
    if (sessionUser) {
      const memory = await storage.getTeamMemory(sessionUser.teamId);
      if (memory && !isMemoryEmpty(memory.content)) {
        memoryHint = `═══ TEAM MEMORY (always-on background context) ═══

The team has shared a static Memory doc — people, tech stack, conventions,
long-term goals. Treat this as ground truth for any team-fact question.

${memory.content}

═══ TEAM AWARENESS (proactive surfacing) ═══

Use the Memory above as background context throughout the conversation.
When you notice the user's work connects to a person, project, convention,
or topic from Memory — surface it naturally, even if they didn't ask:

  • "Btw, Andrew leads frontend — your token system might overlap with
    his design system work, worth a quick sync."
  • "Heads up: your team conventions say PRs ≤500 lines. This diff is
    ~700, might want to split."
  • "Samantha is on onboarding this week — if your change touches that
    flow, ping her."

Connections you notice are valuable. Don't force them when none exist.

You may optionally call \`router_search\` to find a specific past entry
that relates to the connection — but don't sweat search misses (the
keyword-based search returns nothing for plenty of valid topics).
A Memory-based suggestion alone is useful.

`;

        // @ MENTIONS — only useful when Memory has a People section to look up against.
        // Server-side mention extraction is strict: only canonical \`@handle\` (lowercase
        // alphanumeric, matching a real router user) fires a notification. So CC must
        // do the alias resolution UP FRONT, before writing the entry.
        mentionHint = `═══ @ MENTIONS ═══

要让队友收到通知,在 entry text 里写 \`@<canonical-handle>\`,或在 router_write
调用时传 \`to: ["@<handle>"]\` 字段(canonical handle = TEAM MEMORY 的 People 段
里前面带 \`@\` 的那个 token,例如 \`@amiller\` 而不是 \`Andrew Miller\`)。

显示名 / Lark 全名 / 自然描述都不会触发 notification — 只有 canonical handle 才会。

用户怎么表达不重要 ——「@andrew」/「Andrew」/「ping Andrew Miller」/「那个搞 TEE
的」都要把它解析成 \`@amiller\` 写进 entry。

歧义时(eg 用户说 Andrew 但 Memory 里有两个 Andrew):先在对话里反问用户是哪个,
不要瞎猜也不要并排都 @ 一遍。
找不到时(Memory 里没这个人):告诉用户"没找到",不要瞎猜 handle。
错别字时(\`@adnrew\`):用 Memory 找最接近的,跟用户确认后再写。

═══ TAG USAGE ═══

Tags are first-class. Every \`#xxx\` token you put in \`tags\` is a tag; there is no
separate "channel" concept. Some tags have a config row (subscribers + skills
+ webhooks) — those behave like the old channels and may auto-push to Lark or
fire other effects when an entry includes them. Most tags are plain tags
with no config.

After router_write returns, the response includes a \`Triggered tags: #a, #b\`
line listing which tags had a webhook fire — surface those to the user when
relevant so they know where their entry was forwarded.

To configure a tag (subscribe, add a webhook skill, etc.) call \`router_tag\`.
Anyone can subscribe to any tag; admins manage skills. \`router_channels\`
still exists for older CC instances and is treated as an alias.

(Migration note: tags used to be called "channels" — same data, same configs,
same webhooks/bindings, just renamed. Older CC instances might still set
\`router_write\`'s \`channel\` argument — the server folds it into \`tags[]\` and
emits a warn log. Use \`tags\` only going forward.)

`;
      }
    }

    // ── A: per-user Lark calendar + open tasks snapshot (M7) ──
    // Inject into MCP instructions so CC has live context for "what's on
    // my schedule" / "what's due this week" without needing a tool call.
    // Same trick as Memory injection. Gracefully degrades when:
    //   - user has no Lark binding (no larkOpenId) → skip
    //   - Lark not configured on this instance → skip (gated below)
    //   - scopes missing / token expired / API down → catches inside the
    //     calendar-tasks-api helpers, returns empty arrays → empty hint
    if (sessionUser?.larkOpenId && larkApiClientForEffects) {
      try {
        const events = await getMyUpcomingEvents(larkApiClientForEffects, sessionUser.handle, 2);
        const tasks = await getMyOpenTasks(larkApiClientForEffects, sessionUser.handle, 14);
        if (events.length > 0 || tasks.length > 0) {
          calendarHint = formatCalendarHint(events, tasks);
        }
      } catch (err) {
        console.warn(`[mcp] failed to fetch lark calendar/tasks for @${sessionUser.handle}: ${(err as any)?.message ?? err}`);
      }
    }
  } catch (err) {
    console.warn(`[mcp] failed to probe team memory: ${(err as any)?.message ?? err}`);
  }

  const mcpServer = new Server(
    { name: 'teleport-router', version: '0.1.0' },
    {
      capabilities: { tools: {}, prompts: {} },
      // User-pref hints (sync/preview/privacy) + Memory + @ mention guidance
      // + per-user Lark calendar/tasks ALL go BEFORE the standard router
      // instructions. Attention to a long system prompt drops toward the tail;
      // CC was ignoring hints appended at the end. Order:
      //   1. sync preferences (shape every router_write)
      //   2. Memory (always-on team context — also the source of canonical handles)
      //   3. @ mention guidance (depends on Memory's People section)
      //   4. calendar + tasks (live snapshot, refreshes each connect)
      //   5. broader router rules
      // Concierge no longer auto-injects — pushes via weekly Lark cron + on-demand router_brief.
      instructions:
        syncPrefHint
        + memoryHint
        + mentionHint
        + calendarHint
        + buildRouterMcpInstructions(PERSONAL_WEBHOOK_PUBLIC_URL),
    }
  );

  // ── Helper: build inputSchema for a channel skill ──
  function buildSkillInputSchema(skill: any): Record<string, any> {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const param of (skill.parameters || [])) {
      properties[param.name] = { type: param.type, description: param.description };
      if (param.required) required.push(param.name);
    }
    // Always inject 'result' for auto-post mode
    properties['result'] = {
      type: 'string',
      description: 'If provided, creates an entry with this content in the channel. If omitted, returns skill instructions.',
    };
    return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
  }

  // ── List tools ──
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    // Get user for channel skill injection
    const user = await storage.getUserByKeyHash(keyHash);
    const handle = user?.handle;

    // Build dynamic context for router_write: pinned presets + existing top tags
    let pinnedHint = '';
    let existingTagHint = '';
    if (user) {
      const presets = user.tagPresets || [];
      if (presets.length > 0) {
        pinnedHint =
          '\n\nUser pinned tag presets (PREFER these for matching scenarios):\n' +
          presets.map(p => `  - ${p.name}: ${p.tags.map(t => '#' + t).join(' ')}`).join('\n');
      }
      try {
        const stats = await storage.getTagStats(user.teamId);
        if (stats.length > 0) {
          const top = stats.slice(0, 30).map(s => `#${s.tag}(${s.count})`).join(' ');
          existingTagHint = `\n\nExisting team tags (sorted by usage, PREFER these over inventing new ones):\n  ${top}`;
        }
      } catch { /* */ }
    }

    // Build channel skill tools (only those exposed as 'tool' or 'both') and
    // collect 'context'/'both' skills into an appendix for router_write description.
    const channelTools: Array<{ name: string; description: string; inputSchema: Record<string, any> }> = [];
    let channelContextHint = '';
    if (handle) {
      try {
        const teamTags = await storage.listTagConfigs(user.teamId);
        const ctxLines: string[] = [];
        for (const cfg of teamTags) {
          const ctxSkills = cfg.skills.filter(s => s.exposeAs === 'context' || s.exposeAs === 'both');
          if (ctxSkills.length > 0) {
            ctxLines.push(`\n## #${cfg.tag} context`);
            for (const s of ctxSkills) {
              ctxLines.push(`- ${s.name}: ${s.description || '(no description)'}`);
              if (s.instructions) {
                const indented = s.instructions.split('\n').map(l => '  ' + l).join('\n');
                ctxLines.push(indented);
              }
            }
          }

          // v1: Tool skills are disabled. They remain in the DB for future
          // versions (or a "list_changed" notification flow) but are not
          // injected as MCP tools right now, to avoid the MCP reconnect problem.
          // Rewrite (exposeAs === 'prewrite') and webhook (exposeAs === 'context')
          // skills are applied at router_write time from the live DB instead.
        }
        if (ctxLines.length > 0) {
          channelContextHint = '\n\n# HASH CONTEXT (every tag in your team that has guidance — follow it when an entry includes that tag):' + ctxLines.join('\n');
        }
      } catch { /* */ }
    }

    return {
      tools: [
        {
          name: 'router_write',
          description: ROUTER_WRITE_TOOL_DESCRIPTION + pinnedHint + existingTagHint + channelContextHint,
          inputSchema: {
            type: 'object',
            properties: {
              summary: { type: 'string', description: '2–3 plain-text sentences. No markdown (it renders literally). Newlines are rendered — use \\n to split points across lines for scannability. Shown as the card header.' },
              oneliner: { type: 'string', description: '10–15 char headline for sharing. Plain text. Example: "v0.1.0 shipped".' },
              tags: { type: 'array', items: { type: 'string' }, description: '1-5 tags (server-enforced max). Reuse existing tags from router_tags whenever semantically close — exact match not required. Only invent when nothing fits. Aim for 2-4 dimensions. Example: ["project-x","frontend","decision"].' },
              role: { type: 'string', enum: ['frontend', 'backend', 'design', 'pm', 'infra'], description: 'What the entry is about, from the author\'s perspective.' },
              content: { type: 'string', description: 'Full markdown body. Shown when the user clicks "Show full content". Use headings, lists, code blocks, links.' },
              client: { type: 'string', enum: ['desktop', 'mobile', 'code'], description: 'Which Claude surface you\'re calling from.' },
              to: { type: 'array', items: { type: 'string' }, description: 'Explicit @handle recipients to notify, eg ["@amiller","@liko"]. Each must be a canonical handle from TEAM MEMORY (NOT a display name). Triggers the same mention notification as writing `@handle` inline in summary/content. Use this when you want to keep the prose clean — e.g. user says "提醒 amiller 看下 nginx" → summary stays focused on the topic, recipient goes here.' },
              model: { type: 'string', description: 'Your model identifier.' },
              search_keywords: { type: 'array', items: { type: 'string' }, description: 'Extra keywords to make the entry findable via search.' },
              _skill_executed: { type: 'boolean', description: 'INTERNAL. Set to true on the second call after you\'ve applied the channel skills returned on the first call. Never set this on the first call.' },
              _confirmed: { type: 'boolean', description: 'INTERNAL. Set to true on the second call after you\'ve shown the user the preview returned on the first call. Never set this on the first call.' },
            },
            required: ['summary', 'tags', 'client'],
          },
        },
        {
          name: 'router_tags',
          description: `List the team's existing tags (sorted by usage) and the current user's pinned tag presets. ALWAYS call this before router_write so you can reuse existing tags instead of inventing new ones. Tag consistency matters more than precision.`,
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Max tags to return (default 50)' },
            },
          },
        },
        {
          name: 'router_search',
          description: 'Search the team notebook for past entries (decisions, design docs, history). PROACTIVELY call when: (1) user asks WHY / WHEN / WHO / HISTORY about a topic ("why did we pick X", "andrew last week", "X 是怎么决定的"); (2) user starts non-trivial work on a topic by name ("refactor X", "add feature Y") — search to find prior design; (3) user explicitly says "search router / 查 router". DO NOT call for pure technical/general questions, totally unrelated topics, same keyword already searched. 0 hits → silently rely on Memory + general knowledge. Hits → quote [#entry-id](url) + 1-sentence summary. Max 1 search per same-keyword set per conversation.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search keywords' },
              tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
              limit: { type: 'number', description: 'Max results (default 20)' },
            },
          },
        },
        {
          name: 'router_link_matrix',
          description: 'Link your Matrix account to this private Router account. First DM the Shape Router bot on Matrix and ask for "link". It will give you a short copy/paste prompt containing a MATRIX-... code. Call this tool with that code.',
          inputSchema: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'One-time Matrix link code from the Shape Router bot, for example MATRIX-ABCDEFGH.' },
            },
            required: ['code'],
          },
        },
        {
          name: 'router_search_sparks',
          description: 'Search private team notebook entries for potential introductions between Router users. Results are team-scoped and exclude hidden/staged entries.',
          inputSchema: {
            type: 'object',
            properties: {
              handle: { type: 'string', description: 'Router handle to find sparks for. Defaults to your own handle. Admins/moderators may search any team member.' },
              query: { type: 'string', description: 'Optional topic query for broad private-team spark search.' },
              limit: { type: 'number', description: 'Max results, default 10.' },
            },
          },
        },
        {
          name: 'router_trigger_spark',
          description: 'Admin/moderator: manually create or reuse a private encrypted Matrix spark room between two Matrix-linked Router users.',
          inputSchema: {
            type: 'object',
            properties: {
              source_handle: { type: 'string', description: 'First Router handle.' },
              target_handle: { type: 'string', description: 'Second Router handle.' },
              reason: { type: 'string', description: 'Why these users should be introduced.' },
              message: { type: 'string', description: 'Optional message to post in the spark room.' },
            },
            required: ['source_handle', 'target_handle', 'reason'],
          },
        },
        {
          name: 'router_get_entry',
          description: 'Get full details of a notebook entry by ID.',
          inputSchema: {
            type: 'object',
            properties: {
              entry_id: { type: 'string', description: 'Entry ID' },
            },
            required: ['entry_id'],
          },
        },
        {
          name: 'router_delete_entry',
          description: 'Delete an entry you wrote.',
          inputSchema: {
            type: 'object',
            properties: {
              entry_id: { type: 'string', description: 'Entry ID to delete' },
            },
            required: ['entry_id'],
          },
        },
        {
          name: 'router_channels',
          description: '[Deprecated alias of router_tag] Manage channels and their skills. Use router_tag for new code; this tool stays for older CC instances.',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['list', 'create', 'info', 'join', 'leave', 'add_skill', 'update_skill', 'remove_skill'],
                description: 'list: show channels. create: new channel. info: channel details. join/leave: subscribe. add_skill/update_skill/remove_skill: manage channel skills (admin only).',
              },
              channel_id: { type: 'string', description: 'Channel ID (e.g. "project-x"). Required for all actions except list.' },
              name: { type: 'string', description: 'For create: display name. For add_skill: skill name (lowercase, hyphens ok).' },
              description: { type: 'string', description: 'For create/add_skill/update_skill: description text.' },
              instructions: { type: 'string', description: 'For add_skill/update_skill: detailed instructions for Claude to follow.' },
              skill_name: { type: 'string', description: 'For update_skill/remove_skill: which skill to modify.' },
              webhook_url: { type: 'string', description: 'For add_skill/update_skill: webhook URL for auto-push (optional).' },
            },
            required: ['action'],
          },
        },
        {
          name: 'router_tag',
          description: 'Manage tag configs (B-plus successor to router_channels). Every `#xxx` in your tags is a tag; some tags have subscribers / webhooks attached. Anyone can subscribe to any tag — the row is auto-created. Admins manage skills.',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['list', 'info', 'subscribe', 'unsubscribe', 'add_skill', 'update_skill', 'remove_skill'],
                description: 'list: show tags with config. info: tag detail. subscribe/unsubscribe: caller membership (auto-creates row on subscribe). add_skill/update_skill/remove_skill: admin-only.',
              },
              tag: { type: 'string', description: 'Hash name (the bare tag — e.g. "feedling"). Required for everything except list.' },
              name: { type: 'string', description: 'For add_skill: skill name (lowercase, hyphens ok).' },
              description: { type: 'string', description: 'For add_skill/update_skill: description text.' },
              instructions: { type: 'string', description: 'For add_skill/update_skill: instructions Claude follows when this tag is in tags.' },
              skill_name: { type: 'string', description: 'For update_skill/remove_skill: which skill to modify.' },
              webhook_url: { type: 'string', description: 'For add_skill/update_skill: webhook URL for auto-push (optional).' },
            },
            required: ['action'],
          },
        },
        {
          name: 'router_create_lark_task',
          description: `Create a Lark task on the user's behalf.

ALWAYS confirm with the user BEFORE calling: show title, due date (if any), and assignee. Get explicit yes, then call.

assignee_handle MUST be a canonical router @handle from TEAM MEMORY (NOT a display name). Server resolves handle → Lark open_id from the binding table; an unbound handle is created as an unassigned task with a warning (not an error). If omitted, defaults to the caller (you).

Returns the Lark task guid + URL on success. On failure (no Lark binding for caller, scope missing, API error) returns ok=false with an error message — never throws.`,
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Task title (required).' },
              description: { type: 'string', description: 'Optional task description / notes.' },
              due_at: { type: 'number', description: 'Optional due date as Unix milliseconds since epoch.' },
              assignee_handle: { type: 'string', description: 'Optional canonical router @handle of the assignee. Defaults to the caller. Strip leading @ if present.' },
            },
            required: ['title'],
          },
        },
        {
          name: 'router_create_lark_calendar_event',
          description: `Create a Lark calendar event on the user's primary calendar.

ALWAYS confirm with the user BEFORE calling: show title, start/end time (in user's timezone), attendees. Get explicit yes, then call.

attendee_handles items MUST be canonical router @handles from TEAM MEMORY. Server resolves each handle → Lark open_id; unbound handles are skipped with a warning (event still created).

Returns the Lark event id on success. On failure returns ok=false with an error message.`,
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Event title (required).' },
              description: { type: 'string', description: 'Optional event description / agenda.' },
              start_at: { type: 'number', description: 'Start time as Unix milliseconds since epoch (required).' },
              end_at: { type: 'number', description: 'End time as Unix milliseconds since epoch (required).' },
              attendee_handles: { type: 'array', items: { type: 'string' }, description: 'Optional canonical router @handles to invite. Strip leading @.' },
            },
            required: ['title', 'start_at', 'end_at'],
          },
        },
        {
          name: 'router_brief',
          description: 'Get the user\'s daily brief — what\'s happened in the team since the last morning brief was sent (mentions, replies on your entries, subscribed-channel activity, team milestones, related topics). Same content as the daily Lark push, refreshable on demand. Read-only — calling does NOT advance the brief\'s "since" anchor (next morning\'s push will still cover everything from last 10am Beijing).',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'router_memory_get',
          description: 'Read the FULL team Memory (all sections, raw markdown). Returns the same content already injected into your system context as TEAM MEMORY — use this only when an admin wants to see/edit the canonical doc (e.g., before calling router_memory_set). Normal questions should rely on the Memory already in context.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'router_memory_set',
          description: 'Replace the team Memory with new content (admin only). The previous version is automatically saved as a one-step undo. Use after router_memory_get to make targeted edits — read first, modify in place, then write back the FULL new content. Server validates content length (max 8000 chars).',
          inputSchema: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'The full new Memory content (markdown).' },
            },
            required: ['content'],
          },
        },
        ...channelTools,
      ],
    };
  });

  // ── Handle tool calls ──
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const user = await storage.getUserByKeyHash(keyHash);

    if (!user) {
      return { content: [{ type: 'text' as const, text: 'Error: Not registered. Create a team first.' }], isError: true };
    }

    // ── router_write ──
    if (name === 'router_write') {
      // Defensive arg parsing: some MCP clients serialize array params as
      // JSON-encoded strings or comma-separated strings. We accept any of
      // those so validation doesn't spuriously reject a legit call.
      const rawArgs = (args ?? {}) as Record<string, unknown>;
      // `channel` was removed from inputSchema in MCP schema v7 (tag unification).
      // Old clients may still send it; silently fold it into tags[] and warn so
      // we can verify nobody depends on it before dropping the fallback in
      // Phase 2.
      const { role, content, client, channel, model, oneliner, _skill_executed, _confirmed } = rawArgs as any;
      if (typeof channel === 'string' && channel.length > 0) {
        console.warn(`[router_write] deprecated 'channel' param received (channel="${channel}", handle=${user.handle}). Folding into tags[].`);
      }
      // `to` is the explicit @handle recipient list. Filter to non-empty
      // strings; '#channel' tokens (if any) are kept too — they coexist with
      // the channel-derived '#<channel>' and dedupe at storage level.
      const rawTo = rawArgs.to;
      const toFromArgs: string[] = Array.isArray(rawTo)
        ? rawTo.filter((t: unknown): t is string => typeof t === 'string' && t.length > 0)
        : [];
      const summary = typeof rawArgs.summary === 'string' ? rawArgs.summary : '';

      let tags: string[] = [];
      const rawTags = rawArgs.tags;
      if (Array.isArray(rawTags)) {
        tags = rawTags.filter((t): t is string => typeof t === 'string');
      } else if (typeof rawTags === 'string') {
        const trimmed = rawTags.trim();
        if (trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
              tags = parsed.filter((t: unknown): t is string => typeof t === 'string');
            }
          } catch { /* fall through to comma-split */ }
        }
        if (tags.length === 0) {
          tags = trimmed.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
        }
      }

      // Silent fallback: if a deprecated `channel` arg slipped in, treat it as
      // an additional tag so the tag unification stays a single concept.
      if (typeof channel === 'string' && channel.length > 0 && !tags.includes(channel)) {
        tags = [...tags, channel];
      }

      // Specific error messages so Claude can self-correct instead of guessing.
      const missing: string[] = [];
      if (!summary.trim()) missing.push('summary (plain text, 2-3 sentences)');
      if (tags.length === 0) missing.push('tags (array of at least 1, e.g. ["project-x","frontend"])');
      if (missing.length > 0) {
        const receivedKeys = Object.keys(rawArgs).filter(k => !k.startsWith('_'));
        return {
          content: [{
            type: 'text' as const,
            text: `router_write failed: missing ${missing.join(' and ')}. You sent keys: [${receivedKeys.join(', ') || 'none'}]. Please retry with summary and tags filled in.`,
          }],
          isError: true,
        };
      }

      // Tag count cap: entries with too many tags are usually noise. Keep the
      // focus on the 2-5 most relevant tags.
      const TAG_MAX = 5;
      if (tags.length > TAG_MAX) {
        return {
          content: [{
            type: 'text' as const,
            text: `router_write failed: too many tags (${tags.length}). Pick the ${TAG_MAX} most relevant tags from router_tags.`,
          }],
          isError: true,
        };
      }


      // Guard: only reject when we see the specific serialization-bug pattern
      // `</summary><parameter name="content">...` — i.e. a closing tag followed
      // by a parameter-opening tag. Individual words like "summary", "content",
      // or even `<summary>` in prose shouldn't trip this — users legitimately
      // discuss these terms in content (docs, error messages, etc.).
      const serializationBug = /<\/(summary|content)>\s*<parameter\s+name\s*=/i;
      if (serializationBug.test(summary)) {
        return {
          content: [{
            type: 'text' as const,
            text: `router_write failed: summary contains raw MCP tag envelope (e.g. </summary><parameter name=...). This means your tool call wasn't serialized cleanly — retry with all fields as pure strings.`,
          }],
          isError: true,
        };
      }

      // Length cap: 1500 chars comfortably fits 2–3 sentences in any
      // language; anything longer is usually the full body leaking into
      // the summary field.
      const SUMMARY_MAX = 1500;
      if (summary.length > SUMMARY_MAX) {
        return {
          content: [{
            type: 'text' as const,
            text: `router_write failed: summary is ${summary.length} chars, max ${SUMMARY_MAX}. Summary must be a 2–3 sentence headline — put the full body in the "content" field instead.`,
          }],
          isError: true,
        };
      }

      // ── Hash prewrite-skill roundtrip ──
      // For every tag that has a tag_configs row, walk its prewrite skills.
      // Skills are free-form instructions the team wrote — they may ask
      // Claude to look up related history, enforce formatting, add tags, etc.
      //
      // First call: short-circuit, return the combined skill text and ask
      // Claude to execute whatever the skills require (using its own tools),
      // then call back with _skill_executed: true.
      let appliedSkillNames: string[] = [];
      const prewriteSkillsByHash: Array<{ tag: string; skill: Skill }> = [];
      for (const candidate of tags) {
        const cfg = await storage.getTagConfig(user.teamId, candidate);
        if (!cfg) continue;
        for (const skill of cfg.skills) {
          if (skill.exposeAs === 'prewrite') prewriteSkillsByHash.push({ tag: candidate, skill });
        }
      }
      if (prewriteSkillsByHash.length > 0) {
        if (!_skill_executed) {
          const skillBlocks = prewriteSkillsByHash.map(({ tag, skill }) =>
            `[#${tag} / Skill: ${skill.name}]${skill.description ? `\n${skill.description}` : ''}\n\n${skill.instructions || '(no instructions)'}`
          ).join('\n\n---\n\n');
          const hashList = [...new Set(prewriteSkillsByHash.map(p => p.tag))];
          return {
            content: [{
              type: 'text' as const,
              text: `Tag skill — read these before writing

Your tags map to ${prewriteSkillsByHash.length} active prewrite skill${prewriteSkillsByHash.length > 1 ? 's' : ''} across ${hashList.length} tag${hashList.length > 1 ? 'es' : ''} (${hashList.map(h => `#${h}`).join(', ')}). They're free-form instructions the team wrote — background, terminology, formatting rules, history lookups, anything.

=== SKILLS ===

${skillBlocks}

=== WHAT TO DO ===

1. Read each skill and work out what it actually wants.
2. If a skill asks you to look something up (history, tags, a specific person's entries, related threads), use the Router tools to actually do it. Don't guess.
3. Apply everything you learned: follow the background and terminology, fold in relevant history, respect the format and tag rules.
4. Call router_write again with the refined summary, the same tags, and _skill_executed: true. Do NOT set _confirmed yet — the next call will return a preview for user approval first.

The entry is NOT saved until the user confirms the preview. Don't skip the lookups.

In your final reply, name each skill you applied (e.g. "Applied #feedling/Background and #decision/Writing rules") so the user knows what shaped the entry.`,
            }],
          };
        }
        // Second call — record which skills were applied so we can tell the user.
        appliedSkillNames = prewriteSkillsByHash.map(p => `#${p.tag}/${p.skill.name}`);
      }

      // ── Preview-then-confirm flow ──
      // First call (no _confirmed): return a formatted preview so the user
      // can read the entry in the CLI before it's actually written.
      // Second call (_confirmed: true): write for real.
      if (!_confirmed) {
        const cleanSummary = summary.trim().replace(/\\n/g, '\n');
        const cleanContent = content ? String(content).replace(/\\n/g, '\n') : '';
        const tagLine = tags.map((t: string) => `#${t}`).join('  ');
        const lines = [
          '┌─── Entry Preview ───────────────────────',
          '',
          `  Summary:`,
          ...cleanSummary.split('\n').map((l: string) => `  ${l}`),
          '',
        ];
        if (cleanContent) {
          // Show first ~500 chars of content to keep preview manageable
          const contentPreview = cleanContent.length > 500
            ? cleanContent.slice(0, 500) + '…'
            : cleanContent;
          lines.push(`  Content:`);
          lines.push(...contentPreview.split('\n').map((l: string) => `  ${l}`));
          lines.push('');
        }
        lines.push(`  Tags: ${tagLine}`);
        if (role) lines.push(`  Role: ${role}`);
        if (oneliner) lines.push(`  Oneliner: ${oneliner}`);
        lines.push('');
        lines.push('└──────────────────────────────────────────');
        lines.push('');
        lines.push('IMPORTANT: The CLI does not render tool-result formatting.');
        lines.push('You MUST re-output this preview as YOUR OWN reply text.');
        lines.push('Include ALL of the following in your response, each on its own line:');
        lines.push('  1. Summary (full text, preserve newlines)');
        if (cleanContent) lines.push('  2. Content (the markdown body preview shown above — include it verbatim)');
        lines.push(`  ${cleanContent ? '3' : '2'}. Tags`);
        lines.push('Then ask: "确认发布吗？" / "Ready to publish?"');
        lines.push('If the user approves, call router_write again with ALL the same parameters plus _confirmed: true.');

        return {
          content: [{
            type: 'text' as const,
            text: lines.join('\n'),
          }],
        };
      }

      // Build the unified to[] list: channel-derived '#<channel>' + caller-
      // supplied recipients (deduped, channel '#<channel>' wins over a
      // caller-supplied duplicate to keep ordering stable).
      const toAddresses: string[] = [];
      if (channel) toAddresses.push(`#${channel}`);
      for (const t of toFromArgs) {
        if (!toAddresses.includes(t)) toAddresses.push(t);
      }

      // Source tracking — derive from MCP clientInfo (set during the
      // initialize handshake). Falls back to 'unknown' if the client didn't
      // send a name (rare).
      const clientInfo = mcpServer.getClientVersion?.();
      const sourceApp = detectMcpClientApp(clientInfo?.name);

      const userDelay = user.stagingDelayMs ?? STAGING_DELAY_MS;
      const entry = await storage.addEntry({
        handle: user.handle,
        teamId: user.teamId,
        client: client || 'code',
        content: (content || summary).replace(/\\n/g, '\n'),
        summary: summary.trim().replace(/\\n/g, '\n'),
        tags: tags.map((t: string) => t.toLowerCase().trim()).filter(Boolean),
        role: role || undefined,
        timestamp: Date.now(),
        model: model || undefined,
        to: toAddresses.length > 0 ? toAddresses : undefined,
        channel: channel || undefined,
        oneliner: typeof oneliner === 'string' ? oneliner.trim().slice(0, 50) : undefined,
        sourceApp,
        sourceVia: transportKind,
      }, userDelay);

      // Tag unification: fan-out across every tag (and legacy channel) that
      // has a tag_configs row. Awaited so the response can report which
      // tags fired in `triggered_tags`.
      const triggeredTags = await evaluateTagTriggers(entry, storage, markWebhookFired, {
        larkApiClient: larkApiClientForEffects,
        storage,
      }).catch((err) => {
        console.error(`[router_write] Failed to evaluate tag triggers for ${entry.id}:`, err);
        return [] as string[];
      });

      // Entries with no staging delay publish immediately — onPublish won't
      // fire, so notify @mentions here. Staged entries get notified via the
      // onPublish hook when their publishAt elapses.
      if (!entry.publishAt) {
        notifyEntryMentions(entry).catch(err =>
          console.error(`[router_write] Failed to notify mentions for ${entry.id}:`, err),
        );
        maybeRunSparksForEntry(entry).catch(err =>
          console.error(`[router_write] Spark evaluation failed for ${entry.id}:`, err),
        );
        mirrorEntryToMatrix(entry, '[router_write]');
      }

      const delayMins = Math.round(userDelay / 60000);
      const appliedSkillsLine = appliedSkillNames.length > 0
        ? `\nApplied tag skills: ${appliedSkillNames.map(n => `"${n}"`).join(', ')} — you MUST tell the user which skills were applied in your final reply.`
        : '';

      const resultLines = [
        `Synced to team notebook!${delayMins > 0 ? ` (publishes in ${delayMins} min)` : ''}`,
        '',
        `Entry ID: ${entry.id}`,
        `Link: ${PERSONAL_WEBHOOK_PUBLIC_URL}/entry?id=${entry.id}`,
        `Summary: ${entry.summary}`,
        `Tags: ${entry.tags.map(t => `#${t}`).join(' ')}`,
      ];
      if (triggeredTags.length > 0) {
        resultLines.push(`Triggered tags: ${triggeredTags.map(h => `#${h}`).join(', ')}`);
      }
      if (appliedSkillsLine) resultLines.push(appliedSkillsLine);

      return {
        content: [{
          type: 'text' as const,
          text: resultLines.join('\n'),
        }],
      };
    }

    // ── router_tags ──
    if (name === 'router_tags') {
      const tagContext = await renderTagContextForLLM(storage, user.teamId);
      const text = `${tagContext}\n\n${ROUTER_TAGS_REUSE_GUIDANCE}`;
      return { content: [{ type: 'text' as const, text }] };
    }

    // ── router_search ──
    if (name === 'router_search') {
      const { query, tags, limit = 20 } = args as any;

      let results: RouterEntry[] = [];

      if (tags && Array.isArray(tags) && tags.length > 0) {
        results = await storage.getEntriesByTags(user.teamId, tags, limit);
        if (query) {
          const queryKeywords = tokenize(query);
          results = results.filter(e => {
            const entryKeywords = e.keywords || [];
            return queryKeywords.some(qk => entryKeywords.includes(qk));
          });
        }
      } else if (query) {
        results = await storage.searchEntries(user.teamId, query, limit);
      } else {
        results = await storage.getEntries(user.teamId, limit);
      }

      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No results found.' }] };
      }

      const formatted = results.map(e =>
        `[${e.id}] @${e.handle} · ${new Date(e.timestamp).toLocaleDateString()}\n${e.summary}\nTags: ${e.tags.map(t => `#${t}`).join(' ')}`
      ).join('\n\n');

      return { content: [{ type: 'text' as const, text: `Found ${results.length} results:\n\n${formatted}` }] };
    }

    // ── router_link_matrix ──
    if (name === 'router_link_matrix') {
      const { code } = args as any;
      if (!code || typeof code !== 'string') {
        return { content: [{ type: 'text' as const, text: 'Missing code. DM the Shape Router bot on Matrix and ask for "link"; it will send a MATRIX-... code to paste here.' }], isError: true };
      }

      if (user.matrixUserId) {
        return { content: [{ type: 'text' as const, text: `This Router account is already linked to ${user.matrixUserId}.` }], isError: true };
      }

      const token = redeemMatrixLinkCode(code, user.teamId);
      if (!token) {
        return { content: [{ type: 'text' as const, text: 'Invalid or expired Matrix link code. Codes last 10 minutes; ask the Matrix bot for a fresh one.' }], isError: true };
      }

      const existing = await storage.getUserByMatrixUserId(token.matrixUserId);
      if (existing && existing.handle !== user.handle) {
        return { content: [{ type: 'text' as const, text: `That Matrix account is already linked to @${existing.handle}.` }], isError: true };
      }

      const updated = await storage.bindMatrixAccount(user.handle, token.matrixUserId);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: 'Could not link Matrix account because it is already linked to another Router user.' }], isError: true };
      }

      return { content: [{ type: 'text' as const, text: `Linked Matrix account ${token.matrixUserId} to @${updated.handle}.` }] };
    }

    // ── router_search_sparks ──
    if (name === 'router_search_sparks') {
      try {
        const results = await searchSparkCandidatesForUser(user, args as any);
        return {
          content: [{
            type: 'text' as const,
            text: results.length > 0
              ? `Found ${results.length} potential private sparks:\n\n${results.join('\n')}`
              : 'No sparks found.',
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Spark search failed: ${err.message}` }], isError: true };
      }
    }

    // ── router_trigger_spark ──
    if (name === 'router_trigger_spark') {
      try {
        const a = args as any;
        const result = await triggerSparkForHandles(
          user,
          String(a.source_handle || ''),
          String(a.target_handle || ''),
          String(a.reason || '').trim(),
          typeof a.message === 'string' ? a.message.trim() : undefined,
        );
        return {
          content: [{ type: 'text' as const, text: result.roomId
            ? `Spark ${result.status} for @${a.source_handle} <-> @${a.target_handle} (${result.roomId})`
            : `Spark ${result.status} for @${a.source_handle} <-> @${a.target_handle}${result.reason ? `: ${result.reason}` : ''}` }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Trigger spark failed: ${err.message}` }], isError: true };
      }
    }

    // ── router_get_entry ──
    if (name === 'router_get_entry') {
      const { entry_id } = args as any;
      const entry = await storage.getEntry(entry_id);

      if (!entry || entry.teamId !== user.teamId) {
        return { content: [{ type: 'text' as const, text: 'Entry not found.' }], isError: true };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `Entry ${entry.id}\nAuthor: @${entry.handle}\nTime: ${new Date(entry.timestamp).toISOString()}\nRole: ${entry.role || 'N/A'}\nTags: ${entry.tags.map(t => `#${t}`).join(' ')}\nChannel: ${entry.channel ? `#${entry.channel}` : 'none'}\n\nSummary: ${entry.summary}\n\nContent: ${entry.content}`,
        }],
      };
    }

    // ── router_delete_entry ──
    if (name === 'router_delete_entry') {
      const { entry_id } = args as any;
      const entry = await storage.getEntry(entry_id);

      if (!entry || entry.teamId !== user.teamId) {
        return { content: [{ type: 'text' as const, text: 'Entry not found.' }], isError: true };
      }
      if (entry.handle !== user.handle && !user.isAdmin) {
        return { content: [{ type: 'text' as const, text: 'You can only delete your own entries.' }], isError: true };
      }

      await storage.deleteEntry(entry_id);
      return { content: [{ type: 'text' as const, text: `Deleted entry ${entry_id}.` }] };
    }

    // ── router_create_lark_task / router_create_lark_calendar_event ──
    // (M7 sub-B: write to Lark on user's behalf via user-token)
    if (name === 'router_create_lark_task') {
      if (!larkApiClientForEffects) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'lark_not_configured' }) }] };
      }
      if (!user.larkOpenId) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'caller_not_bound_to_lark', hint: 'Bind Lark at /settings/lark first' }) }] };
      }
      const a = (args ?? {}) as Record<string, unknown>;
      const title = typeof a.title === 'string' ? a.title.trim() : '';
      if (!title) return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'title_required' }) }] };
      const description = typeof a.description === 'string' ? a.description : undefined;
      const dueMs = typeof a.due_at === 'number' && Number.isFinite(a.due_at) ? a.due_at : undefined;
      const rawAssignee = typeof a.assignee_handle === 'string' ? a.assignee_handle.replace(/^@/, '').toLowerCase().trim() : '';
      const assigneeHandle = rawAssignee || user.handle;

      const warnings: string[] = [];
      let assigneeOpenId: string | undefined;
      const assigneeUser = await storage.getUser(assigneeHandle);
      if (!assigneeUser) {
        warnings.push(`@${assigneeHandle} not found in router; task will be unassigned`);
      } else if (!assigneeUser.larkOpenId) {
        warnings.push(`@${assigneeHandle} has no Lark binding; task will be unassigned`);
      } else {
        assigneeOpenId = assigneeUser.larkOpenId;
      }

      const created = await createTask(larkApiClientForEffects, user.handle, {
        title, description, due_ms: dueMs, assignee_open_id: assigneeOpenId,
      });
      if (!created) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'lark_create_failed', hint: 'Check server logs for [lark-task] warning. Most common cause: scope task:task not granted on the Lark app.' }) }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, task_guid: created.task_guid, lark_url: created.url, warnings: warnings.length > 0 ? warnings : undefined }) }] };
    }

    if (name === 'router_create_lark_calendar_event') {
      if (!larkApiClientForEffects) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'lark_not_configured' }) }] };
      }
      if (!user.larkOpenId) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'caller_not_bound_to_lark', hint: 'Bind Lark at /settings/lark first' }) }] };
      }
      const a = (args ?? {}) as Record<string, unknown>;
      const title = typeof a.title === 'string' ? a.title.trim() : '';
      const startMs = typeof a.start_at === 'number' && Number.isFinite(a.start_at) ? a.start_at : NaN;
      const endMs = typeof a.end_at === 'number' && Number.isFinite(a.end_at) ? a.end_at : NaN;
      if (!title || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'title_start_end_required' }) }] };
      }
      if (endMs <= startMs) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'end_must_be_after_start' }) }] };
      }
      const description = typeof a.description === 'string' ? a.description : undefined;
      const rawAttendees = Array.isArray(a.attendee_handles) ? a.attendee_handles : [];

      const warnings: string[] = [];
      const attendeeOpenIds: string[] = [];
      for (const raw of rawAttendees) {
        if (typeof raw !== 'string') continue;
        const h = raw.replace(/^@/, '').toLowerCase().trim();
        if (!h) continue;
        const u = await storage.getUser(h);
        if (!u) { warnings.push(`@${h} not found in router; skipped`); continue; }
        if (!u.larkOpenId) { warnings.push(`@${h} has no Lark binding; skipped`); continue; }
        attendeeOpenIds.push(u.larkOpenId);
      }

      const created = await createCalendarEvent(larkApiClientForEffects, user.handle, {
        title, description, start_ms: startMs, end_ms: endMs,
        attendee_open_ids: attendeeOpenIds.length > 0 ? attendeeOpenIds : undefined,
      });
      if (!created) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'lark_create_failed', hint: 'Check server logs for [lark-calendar] warning. Most common cause: scope calendar:calendar.event:create not granted on the Lark app.' }) }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, event_id: created.event_id, calendar_id: created.calendar_id, warnings: warnings.length > 0 ? warnings : undefined }) }] };
    }

    // ── router_brief ── (per-user "since you were gone" recap; same content as Lark push)
    if (name === 'router_brief') {
      if (user.conciergeRecapEnabled === false) {
        return { content: [{ type: 'text' as const, text: 'Brief is disabled for you (toggle in /settings/concierge).' }] };
      }
      const recap = await computeUserRecap(
        storage,
        { handle: user.handle, teamId: user.teamId, lastConciergeSeenAt: user.lastConciergeSeenAt },
        { publicUrl: PERSONAL_WEBHOOK_PUBLIC_URL },
      );
      // NOTE: do NOT update lastConciergeSeenAt here — only the daily cron
      // updates it (spec §5.4). Manual calls preview the next morning's push.
      return { content: [{ type: 'text' as const, text: renderRecap(recap) }] };
    }

    // ── router_memory_get ──
    if (name === 'router_memory_get') {
      const memory = await storage.getTeamMemory(user.teamId);
      const content = memory?.content ?? '';
      if (isTemplateOnly(content)) {
        return { content: [{ type: 'text' as const, text: '⚠ Memory has not been configured yet. An admin should fill it in at /settings/memory or via router_memory_set.\n\n(Reference template available via TEAM_MEMORY_EXAMPLE in the docs.)' }] };
      }
      const meta = `Last updated by @${memory!.updatedByHandle} at ${new Date(memory!.updatedAt).toISOString()}.`;
      return { content: [{ type: 'text' as const, text: `${meta}\n\n---\n\n${content}` }] };
    }

    // ── router_memory_set ──
    if (name === 'router_memory_set') {
      if (!user.isAdmin) {
        return { content: [{ type: 'text' as const, text: 'Only team admins can edit Memory. Ask an admin to run this for you, or use the web UI at /settings/memory.' }], isError: true };
      }
      const { content: newContent } = args as { content?: string };
      if (typeof newContent !== 'string') {
        return { content: [{ type: 'text' as const, text: 'content (string) is required.' }], isError: true };
      }
      if (newContent.length > TEAM_MEMORY_CHAR_LIMIT) {
        return { content: [{ type: 'text' as const, text: `Content too long: ${newContent.length} > ${TEAM_MEMORY_CHAR_LIMIT} char limit.` }], isError: true };
      }
      const memory = await storage.upsertTeamMemory(user.teamId, newContent, user.handle);
      return { content: [{ type: 'text' as const, text: `Memory updated (${memory.content.length} chars). Previous version saved — admin can restore via /settings/memory if needed. New CC sessions will pick up the change.` }] };
    }

    // ── router_channels ──
    if (name === 'router_channels') {
      const { action, channel_id: channelId, name: channelName, description: channelDesc, instructions: skillInstr, skill_name: targetSkillName, webhook_url: webhookUrl } = args as any;

      if (action === 'list') {
        const channels = await storage.listChannels(user.teamId);
        const subscribed = await storage.getSubscribedChannels(user.handle);
        const subIds = new Set(subscribed.map(c => c.id));
        const text = channels.map(c =>
          `#${c.id} (${c.name}) — ${c.subscribers.length} members, ${c.skills.length} skills${subIds.has(c.id) ? ' [subscribed]' : ''}`
        ).join('\n') || 'No channels yet.';
        return { content: [{ type: 'text' as const, text }] };
      }

      if (!channelId) return { content: [{ type: 'text' as const, text: 'channel_id is required.' }], isError: true };

      if (action === 'create') {
        if (!channelName) return { content: [{ type: 'text' as const, text: 'name is required.' }], isError: true };
        const id = channelId.toLowerCase().replace(/[^a-z0-9-]/g, '');
        const channel = await storage.createChannel({
          id, teamId: user.teamId, name: channelName, description: channelDesc || undefined,
          joinRule: 'open', createdBy: user.handle, createdAt: Date.now(),
          skills: [], subscribers: [{ handle: user.handle, role: 'admin', joinedAt: Date.now() }],
        });
        return { content: [{ type: 'text' as const, text: `Created #${channel.id} (${channel.name}).` }] };
      }

      if (action === 'info') {
        const channel = await storage.getChannel(channelId);
        if (!channel) return { content: [{ type: 'text' as const, text: `Channel #${channelId} not found.` }], isError: true };
        const skills = channel.skills.map(s => {
          const effectsTag = s.effects?.length ? ` [${s.effects.map(e => e.type).join(',')}]` : '';
          return `  - ${s.name} (${s.exposeAs}): ${s.description || '(no description)'}${effectsTag}`;
        }).join('\n') || '  (none)';
        const members = channel.subscribers.map(s => `  @${s.handle} (${s.role})`).join('\n');
        return { content: [{ type: 'text' as const, text: `#${channel.id} (${channel.name})\n${channel.description || ''}\n\nSkills:\n${skills}\n\nMembers:\n${members}` }] };
      }

      // Channels are now team-public — every team member sees & uses every
      // channel automatically. join / leave are no-ops kept for backward compat.
      if (action === 'join') {
        return { content: [{ type: 'text' as const, text: `All channels in your team are public — no need to join.` }] };
      }

      if (action === 'leave') {
        return { content: [{ type: 'text' as const, text: `Channels are team-public — there's nothing to leave.` }] };
      }

      if (action === 'add_skill') {
        const newSkillName = channelName?.toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (!newSkillName) return { content: [{ type: 'text' as const, text: 'name is required for add_skill.' }], isError: true };
        const channel = await storage.getChannel(channelId);
        if (!channel) return { content: [{ type: 'text' as const, text: `Channel #${channelId} not found.` }], isError: true };
        if (channel.teamId !== user.teamId) return { content: [{ type: 'text' as const, text: `Channel #${channelId} is in a different team.` }], isError: true };
        if (channel.skills.some(s => s.name === newSkillName)) return { content: [{ type: 'text' as const, text: `Skill "${newSkillName}" already exists. Use update_skill.` }], isError: true };

        // Translate legacy webhookUrl arg into the new effect+trigger shape
        const effects: SkillEffect[] | undefined = webhookUrl
          ? [{ type: 'lark_webhook', url: webhookUrl, template: 'card' }]
          : undefined;
        const triggers: SkillTrigger[] | undefined = webhookUrl
          ? [{ type: 'on_entry_write' }]
          : undefined;

        const newSkill: Skill = {
          id: `${channelId}_${newSkillName}`,
          name: newSkillName,
          description: channelDesc || '',
          instructions: skillInstr || '',
          exposeAs: webhookUrl ? 'context' : 'tool',
          triggers,
          effects,
          createdAt: Date.now(),
        };
        channel.skills.push(newSkill);
        await storage.updateChannel(channelId, { skills: channel.skills });
        return { content: [{ type: 'text' as const, text: `Added skill "${newSkillName}" to #${channelId}.\n\nSubscribers will see it as channel_${channelId}_${newSkillName} on their next MCP connection.\n\nDescription: ${newSkill.description}\nInstructions: ${newSkill.instructions || '(none)'}${webhookUrl ? '\nWebhook (Lark): ' + webhookUrl : ''}` }] };
      }

      if (action === 'update_skill') {
        const target = targetSkillName || channelName?.toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (!target) return { content: [{ type: 'text' as const, text: 'skill_name is required.' }], isError: true };
        const channel = await storage.getChannel(channelId);
        if (!channel) return { content: [{ type: 'text' as const, text: `Channel #${channelId} not found.` }], isError: true };
        if (channel.teamId !== user.teamId) return { content: [{ type: 'text' as const, text: `Channel #${channelId} is in a different team.` }], isError: true };
        const skill = channel.skills.find(s => s.name === target);
        if (!skill) return { content: [{ type: 'text' as const, text: `Skill "${target}" not found.` }], isError: true };
        if (channelDesc !== undefined) skill.description = channelDesc;
        if (skillInstr !== undefined) skill.instructions = skillInstr;
        if (webhookUrl !== undefined) {
          if (webhookUrl) {
            skill.effects = [{ type: 'lark_webhook', url: webhookUrl, template: 'card' }];
            skill.triggers = skill.triggers?.length ? skill.triggers : [{ type: 'on_entry_write' }];
            if (skill.exposeAs === 'tool') skill.exposeAs = 'context';
          } else {
            skill.effects = [];
          }
        }
        skill.updatedAt = Date.now();
        await storage.updateChannel(channelId, { skills: channel.skills });
        return { content: [{ type: 'text' as const, text: `Updated skill "${target}" in #${channelId}.` }] };
      }

      if (action === 'remove_skill') {
        const target = targetSkillName || channelName?.toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (!target) return { content: [{ type: 'text' as const, text: 'skill_name is required.' }], isError: true };
        const channel = await storage.getChannel(channelId);
        if (!channel) return { content: [{ type: 'text' as const, text: `Channel #${channelId} not found.` }], isError: true };
        if (channel.teamId !== user.teamId) return { content: [{ type: 'text' as const, text: `Channel #${channelId} is in a different team.` }], isError: true };
        channel.skills = channel.skills.filter(s => s.name !== target);
        await storage.updateChannel(channelId, { skills: channel.skills });
        return { content: [{ type: 'text' as const, text: `Removed skill "${target}" from #${channelId}.` }] };
      }

      return { content: [{ type: 'text' as const, text: `Unknown action: ${action}` }], isError: true };
    }

    // ── router_tag ──
    if (name === 'router_tag') {
      const {
        action,
        tag: rawHash,
        name: skillDisplayName,
        description: skillDesc,
        instructions: skillInstr,
        skill_name: targetSkillName,
        webhook_url: webhookUrl,
      } = args as any;
      const tag = typeof rawHash === 'string' ? rawHash.trim() : '';

      if (action === 'list') {
        const configs = await storage.listTagConfigs(user.teamId);
        const subscribed = await storage.getSubscribedTags(user.handle);
        const subSet = new Set(subscribed.map(c => c.tag));
        const text = configs.map(c =>
          `#${c.tag}${c.name && c.name !== c.tag ? ` (${c.name})` : ''} — ${c.subscribers.length} subscribers, ${c.skills.length} skills${subSet.has(c.tag) ? ' [subscribed]' : ''}`
        ).join('\n') || 'No tags have configs yet. Any tag is a tag — subscribe to one to spin up a config.';
        return { content: [{ type: 'text' as const, text }] };
      }

      if (!tag) {
        return { content: [{ type: 'text' as const, text: 'tag is required.' }], isError: true };
      }

      if (action === 'info') {
        const cfg = await storage.getTagConfig(user.teamId, tag);
        if (!cfg) {
          return { content: [{ type: 'text' as const, text: `#${tag} has no config row (it's a plain tag). Anyone can subscribe to start one.` }] };
        }
        const skills = cfg.skills.map(s => {
          const effectsTag = s.effects?.length ? ` [${s.effects.map(e => e.type).join(',')}]` : '';
          return `  - ${s.name} (${s.exposeAs}): ${s.description || '(no description)'}${effectsTag}`;
        }).join('\n') || '  (none)';
        const members = cfg.subscribers.map(s => `  @${s.handle} (${s.role})`).join('\n') || '  (none)';
        return {
          content: [{
            type: 'text' as const,
            text: `#${cfg.tag}${cfg.name && cfg.name !== cfg.tag ? ` (${cfg.name})` : ''}\n${cfg.description || ''}\n\nSkills:\n${skills}\n\nSubscribers:\n${members}`,
          }],
        };
      }

      if (action === 'subscribe') {
        const cfg = await storage.addTagSubscriber(user.teamId, tag, user.handle, 'member');
        return { content: [{ type: 'text' as const, text: `Subscribed to #${tag}. ${cfg.subscribers.length} subscriber(s) total.` }] };
      }

      if (action === 'unsubscribe') {
        const cfg = await storage.removeTagSubscriber(user.teamId, tag, user.handle);
        if (!cfg) return { content: [{ type: 'text' as const, text: `#${tag} has no config row — nothing to unsubscribe from.` }] };
        return { content: [{ type: 'text' as const, text: `Unsubscribed from #${tag}.` }] };
      }

      // Skill mutations are admin-only.
      if (action === 'add_skill') {
        const newSkillName = typeof skillDisplayName === 'string' ? skillDisplayName.toLowerCase().replace(/[^a-z0-9-]/g, '') : '';
        if (!newSkillName) return { content: [{ type: 'text' as const, text: 'name is required for add_skill.' }], isError: true };

        const existing = await storage.getTagConfig(user.teamId, tag);
        const currentSkills = existing?.skills ?? [];
        if (currentSkills.some(s => s.name === newSkillName)) {
          return { content: [{ type: 'text' as const, text: `Skill "${newSkillName}" already exists on #${tag}. Use update_skill.` }], isError: true };
        }

        const effects: SkillEffect[] | undefined = webhookUrl
          ? [{ type: 'lark_webhook', url: webhookUrl, template: 'card' }]
          : undefined;
        const triggers: SkillTrigger[] | undefined = webhookUrl
          ? [{ type: 'on_entry_write' }]
          : undefined;

        const newSkill: Skill = {
          id: `${tag}_${newSkillName}`,
          name: newSkillName,
          description: skillDesc || '',
          instructions: skillInstr || '',
          exposeAs: webhookUrl ? 'context' : 'tool',
          triggers, effects,
          createdAt: Date.now(),
        };
        await storage.upsertTagConfig(user.teamId, tag, {
          createdBy: existing?.createdBy ?? user.handle,
          skills: [...currentSkills, newSkill],
        });
        return {
          content: [{
            type: 'text' as const,
            text: `Added skill "${newSkillName}" to #${tag}.${webhookUrl ? '\nWebhook (Lark): ' + webhookUrl : ''}\nInstructions: ${newSkill.instructions || '(none)'}`,
          }],
        };
      }

      if (action === 'update_skill') {
        const target = (typeof targetSkillName === 'string' && targetSkillName) ||
          (typeof skillDisplayName === 'string' ? skillDisplayName.toLowerCase().replace(/[^a-z0-9-]/g, '') : '');
        if (!target) return { content: [{ type: 'text' as const, text: 'skill_name is required.' }], isError: true };
        const cfg = await storage.getTagConfig(user.teamId, tag);
        if (!cfg) return { content: [{ type: 'text' as const, text: `#${tag} has no config row.` }], isError: true };
        const skill = cfg.skills.find(s => s.name === target);
        if (!skill) return { content: [{ type: 'text' as const, text: `Skill "${target}" not found on #${tag}.` }], isError: true };
        if (skillDesc !== undefined) skill.description = skillDesc;
        if (skillInstr !== undefined) skill.instructions = skillInstr;
        if (webhookUrl !== undefined) {
          if (webhookUrl) {
            skill.effects = [{ type: 'lark_webhook', url: webhookUrl, template: 'card' }];
            skill.triggers = skill.triggers?.length ? skill.triggers : [{ type: 'on_entry_write' }];
            if (skill.exposeAs === 'tool') skill.exposeAs = 'context';
          } else {
            skill.effects = [];
          }
        }
        skill.updatedAt = Date.now();
        await storage.upsertTagConfig(user.teamId, tag, { skills: cfg.skills });
        return { content: [{ type: 'text' as const, text: `Updated skill "${target}" on #${tag}.` }] };
      }

      if (action === 'remove_skill') {
        const target = (typeof targetSkillName === 'string' && targetSkillName) ||
          (typeof skillDisplayName === 'string' ? skillDisplayName.toLowerCase().replace(/[^a-z0-9-]/g, '') : '');
        if (!target) return { content: [{ type: 'text' as const, text: 'skill_name is required.' }], isError: true };
        const cfg = await storage.getTagConfig(user.teamId, tag);
        if (!cfg) return { content: [{ type: 'text' as const, text: `#${tag} has no config row.` }], isError: true };
        const remaining = cfg.skills.filter(s => s.name !== target);
        await storage.upsertTagConfig(user.teamId, tag, { skills: remaining });
        return { content: [{ type: 'text' as const, text: `Removed skill "${target}" from #${tag}.` }] };
      }

      return { content: [{ type: 'text' as const, text: `Unknown action: ${action}` }], isError: true };
    }

    // ── channel_* skill execution (two-call pattern) ──
    if (name.startsWith('channel_')) {
      const firstUnderscore = name.indexOf('_');
      const lastUnderscore = name.lastIndexOf('_');
      if (firstUnderscore === lastUnderscore) {
        return { content: [{ type: 'text' as const, text: `Invalid channel tool name: ${name}` }], isError: true };
      }
      const channelId = name.substring(firstUnderscore + 1, lastUnderscore);
      const skillName = name.substring(lastUnderscore + 1);

      const channel = await storage.getChannel(channelId);
      if (!channel) return { content: [{ type: 'text' as const, text: `Channel #${channelId} not found.` }], isError: true };
      if (channel.teamId !== user.teamId) {
        return { content: [{ type: 'text' as const, text: `Channel #${channelId} is in a different team.` }], isError: true };
      }
      const skill = channel.skills.find(s => s.name === skillName);
      if (!skill) return { content: [{ type: 'text' as const, text: `Skill "${skillName}" not found in #${channelId}.` }], isError: true };

      const result = (args as any)?.result;

      if (result) {
        // Auto-post mode: create entry in channel
        const skillClientInfo = mcpServer.getClientVersion?.();
        const userDelay = user.stagingDelayMs ?? STAGING_DELAY_MS;
        const saved = await storage.addEntry({
          handle: user.handle, teamId: user.teamId, client: 'code',
          content: result.trim().replace(/\\n/g, '\n'),
          summary: result.trim().replace(/\\n/g, '\n').split('\n')[0].slice(0, 200),
          tags: [`channel:${channelId}`, `skill:${skillName}`],
          timestamp: Date.now(), model: 'channel-skill',
          channel: channelId, to: [`#${channelId}`],
          sourceApp: detectMcpClientApp(skillClientInfo?.name),
          sourceVia: transportKind,
        }, userDelay);

        // Path A: fire on_entry_write triggers from other skills on this channel
        evaluateChannelTriggers(saved, channel, markWebhookFired, { larkApiClient: larkApiClientForEffects, storage }).catch(() => {});

        // Path B: this skill's own manual trigger fires its effects directly
        if (skill.triggers?.some(t => t.type === 'manual') && skill.effects?.length) {
          runEffects(saved, channel, skill.effects, { larkApiClient: larkApiClientForEffects, storage }).catch(err =>
            console.error('[Path B] manual effects failed:', err),
          );
        }

        const delayMins = Math.round(userDelay / 60000);
        return { content: [{ type: 'text' as const, text: `Posted to #${channelId} via "${skillName}"${delayMins > 0 ? ` (publishes in ${delayMins} min)` : ''}:\n\n"${result.trim().slice(0, 200)}"\n\nEntry ID: ${saved.id}\nLink: ${PERSONAL_WEBHOOK_PUBLIC_URL}/entry?id=${saved.id}` }] };
      }

      // Instructions mode: return skill instructions
      const paramValues: Record<string, any> = {};
      for (const param of (skill.parameters || [])) {
        const value = (args as Record<string, any>)?.[param.name];
        if (value !== undefined) paramValues[param.name] = value;
      }

      let text = `Channel: #${channelId}\nSkill: ${skill.name}\n`;
      if (skill.description) text += `\nDescription: ${skill.description}\n`;
      if (skill.instructions) text += `\nInstructions:\n${skill.instructions}\n`;
      if (Object.keys(paramValues).length > 0) {
        text += `\nParameters:\n${Object.entries(paramValues).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n')}\n`;
      }
      text += `\nTo post the result to #${channelId}, call this tool again with the "result" parameter.`;

      return { content: [{ type: 'text' as const, text }] };
    }

    return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
  });

  // ── Prompts (user-invokable commands, shown as slash commands in Claude Code) ──
  // team_memory is special — it's filtered out at list-time when the team
  // hasn't actually edited their Memory yet (only the template is stored),
  // so CC doesn't get fed placeholder content like "我们是...(一句话)" as
  // if it were authoritative team context.

  const STATIC_PROMPTS = [
    {
      name: 'sync',
      description: 'Sync the current conversation to Router. Generates summary, tags, and posts to the team notebook.',
    },
    {
      name: 'sync-to',
      description: 'Sync the current conversation to a specific Router channel.',
      arguments: [
        { name: 'channel', description: 'Channel id (e.g. my-project, design, infra)', required: true },
      ],
    },
    {
      name: 'search',
      description: 'Search Router for past entries by keyword, tag, or author.',
      arguments: [
        { name: 'query', description: 'What to search for (keywords, #tag, or @handle)', required: true },
      ],
    },
    {
      name: 'recent',
      description: 'Show the most recent entries from the team notebook.',
      arguments: [
        { name: 'limit', description: 'How many entries to show (default 10)', required: false },
      ],
    },
    {
      name: 'channels',
      description: 'List all channels with their skills and member counts.',
    },
    {
      name: 'my-entries',
      description: 'Show your own recent entries.',
      arguments: [
        { name: 'limit', description: 'How many entries to show (default 10)', required: false },
      ],
    },
    {
      name: 'weekly-digest',
      description: 'Generate a digest of what the team synced this week — grouped by channel and author.',
    },
  ];

  const TEAM_MEMORY_PROMPT = {
    name: 'team_memory',
    description: 'Load the team\'s static Memory (people, tech stack, conventions, long-term goals) into context. Call once at session start — these are team-wide ground truth that should inform all your answers.',
  };

  mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => {
    const promptUser = await storage.getUserByKeyHash(keyHash);
    const teamId = promptUser?.teamId;
    let prompts = [...STATIC_PROMPTS];
    if (teamId) {
      const memory = await storage.getTeamMemory(teamId);
      if (memory && !isTemplateOnly(memory.content)) {
        prompts.push(TEAM_MEMORY_PROMPT);
      }
    }
    return { prompts };
  });

  mcpServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: promptArgs } = request.params;
    const promptUser = await storage.getUserByKeyHash(keyHash);

    if (name === 'sync') {
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Sync the current conversation to Router now. Review everything we've discussed and:

1. Call router_tags to check existing tags.
2. Generate:
   - oneliner: a 10-15 char headline
   - summary: 2-3 plain-text sentences capturing the key outcome
   - content: full markdown body with details, decisions, code references
   - tags: 1-5, from router_tags output (server rejects unknown tags); aim for 2-4 dimensions
   - role: frontend/backend/design/pm/infra based on what we discussed
3. Call router_write with all fields.
4. Report back what you synced — summary, tags with reasoning, entry ID, and link.

If we're inside a project directory, prefix the summary with [project: <repo> @ <branch>].
Write in the same language we've been using in this conversation.`,
          },
        }],
      };
    }

    if (name === 'sync-to') {
      const channel = promptArgs?.channel || 'general';
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Sync the current conversation to #${channel} in Router.

1. Call router_tags to check existing tags.
2. Generate summary, content, oneliner, and tags as usual — include "${channel}" in tags.
3. Call router_write.
4. If #${channel} has prewrite tag skills, follow the roundtrip (the server will tell you what to do).
5. Report back what you synced (including any "Triggered tags" the response surfaces).

Write in the same language we've been using in this conversation.`,
          },
        }],
      };
    }

    if (name === 'search') {
      const query = promptArgs?.query || '';
      const isTag = query.startsWith('#');
      const isAuthor = query.startsWith('@');
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Search Router for: ${query}

${isTag ? `Call router_search with tags: ["${query.slice(1)}"].` : isAuthor ? `Call router_search with query: "${query}".` : `Call router_search with query: "${query}".`}

Show the results clearly:
- For each entry: author, time, tags, summary
- If there are many results, group them by theme or shared tag
- Highlight anything that seems most relevant to "${query}"
- If no results found, suggest alternative search terms`,
          },
        }],
      };
    }

    if (name === 'recent') {
      const limit = parseInt(promptArgs?.limit || '10') || 10;
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Show the ${limit} most recent entries from Router.

Call router_search with no query (it returns recent entries by default) and limit ${limit}.

Display each entry with:
- Author (@handle) and timestamp
- Channel (if any)
- Summary
- Tags

Group by today / yesterday / earlier if the entries span multiple days.`,
          },
        }],
      };
    }

    if (name === 'channels') {
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `List all Router channels.

Call router_channels with action: "list".

For each channel show:
- #id — display name
- Description (if any)
- Number of members and skills
- What each skill does (name + short description)

Highlight which channels I'm subscribed to vs not.`,
          },
        }],
      };
    }

    if (name === 'my-entries') {
      const limit = parseInt(promptArgs?.limit || '10') || 10;
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Show my ${limit} most recent entries in Router.

Call router_search with query: "@${promptUser?.handle || 'me'}" and limit ${limit}.

Display each entry with:
- Timestamp
- Channel (if any)
- Summary
- Tags

If I haven't synced anything yet, let me know and suggest I try /sync after our next conversation.`,
          },
        }],
      };
    }

    if (name === 'weekly-digest') {
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Generate a weekly digest of what the team synced to Router this week.

1. Call router_search to get entries from the past 7 days (use a broad search, limit 50).
2. Organize the results into a readable digest:

## This Week on Router

### By Channel
Group entries by channel. For each channel:
- Channel name
- Number of entries this week
- Key highlights (1-2 sentence summary of the most important entries)

### By Person
Who was most active? What were they working on?

### Key Decisions
Pull out any entries tagged with #decision or that describe a decision.

### Open Items
Any entries tagged #blocker, #urgent, or #review-needed.

3. End with a one-paragraph summary of the team's focus this week.

Write the digest in the same language the majority of entries are in.`,
          },
        }],
      };
    }

    if (name === 'team_memory') {
      const teamId = promptUser?.teamId;
      if (!teamId) {
        return {
          messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'No team — cannot load Memory.' } }],
        };
      }
      const memory = await storage.getTeamMemory(teamId);
      if (!memory || isTemplateOnly(memory.content)) {
        return {
          messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'Team Memory is not configured yet. Ask an admin to fill it in at /settings/memory.' } }],
        };
      }
      const instructionalText = `This is the **team's static Memory** — the official record of People / Tech Stack / Conventions / Long-term Goals. Treat it as ground truth for any "我们 / our / the team" questions.

**HOW TO USE THIS:**
1. Show the user the full Memory below verbatim in a code block so they can review what got loaded.
2. After showing it, give a 1-line summary of the team (e.g. "Acme — 3-person team building KnowMate on Next.js + Postgres") + ask what they need.
3. For the rest of this conversation, when the user asks **WHY/WHEN/WHO/HISTORY** about anything Memory mentions (e.g. "why did we pick Zustand", "andrew 这周做啥"), call \`router_search\` to dig into past entries — **Memory has WHAT, router has WHY**. Don't refuse with "I don't have decision context" — search router first.
4. For pure team facts (what stack, who's the lead, conventions) — answer directly from Memory below, no search needed.

---

# Team Memory

\`\`\`markdown
${memory.content}
\`\`\`

---

(Updated by @${memory.updatedByHandle} at ${new Date(memory.updatedAt).toISOString()})`;
      return {
        description: 'Team Memory (static — admin-maintained team context)',
        messages: [{
          role: 'user' as const,
          content: { type: 'text' as const, text: instructionalText },
        }],
      };
    }

    return {
      messages: [{
        role: 'user' as const,
        content: { type: 'text' as const, text: `Unknown prompt: ${name}` },
      }],
    };
  });

  return mcpServer;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// CLI version negotiation headers (consumed by Router CLI v1).
// Bumping these requires a coordinated CLI release.
const CLI_LATEST_VERSION = '1.0.0';
const CLI_MIN_SUPPORTED_VERSION = '1.0.0';

function json(res: ServerResponse, status: number, data: any) {
  res.setHeader('X-Router-CLI-Latest', CLI_LATEST_VERSION);
  res.setHeader('X-Router-CLI-Min-Supported', CLI_MIN_SUPPORTED_VERSION);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, status: number, message: string) {
  json(res, status, { error: message });
}

// ── Cookie helpers ────────────────────────────────────────────

const SESSION_COOKIE = 'router_session';

function parseCookies(req: IncomingMessage): Map<string, string> {
  const out = new Map<string, string>();
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const pair of raw.split(/;\s*/)) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    out.set(pair.slice(0, eq), decodeURIComponent(pair.slice(eq + 1)));
  }
  return out;
}

function cookieAttrs(): string {
  // Secure only when actually serving HTTPS. Local dev is HTTP, so leave it off.
  // SameSite=Lax: cookie is sent on top-level navigations (OAuth callback works)
  // but not on cross-site sub-requests (CSRF mitigation).
  const parts = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${30 * 86400}`];
  if (process.env.COOKIE_SECURE === '1') parts.push('Secure');
  return parts.join('; ');
}

function setSessionCookie(res: ServerResponse, token: string): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttrs()}`);
}

function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/**
 * Authenticate request: key (?key=) preferred, then session cookie fallback.
 * On cookie hit, refreshes expires_at (sliding expiry).
 * Returns null if neither is valid.
 */
async function authenticate(req: IncomingMessage, url: URL): Promise<RouterUser | null> {
  // 1. ?key= takes precedence (CC / MCP / scripts)
  const key = url.searchParams.get('key');
  if (key && isValidSecretKey(key)) {
    return storage.getUserByKeyHash(hashSecretKey(key));
  }
  // 2. Session cookie (browsers)
  const cookies = parseCookies(req);
  const token = cookies.get(SESSION_COOKIE);
  if (!token) return null;
  const session = await storage.getSession(token);
  if (!session) return null;
  // Sliding expiry — fire-and-forget (don't block the request)
  storage.touchSession(token).catch(err => console.warn('[auth] touchSession failed:', err));
  return storage.getUser(session.handle);
}

/** Require auth, return user or send 401 */
async function requireAuth(req: IncomingMessage, url: URL, res: ServerResponse): Promise<RouterUser | null> {
  const user = await authenticate(req, url);
  if (!user) {
    error(res, 401, 'Valid key (?key=) or session cookie required.');
    return null;
  }
  return user;
}

function matrixLinkServiceHandles(): Set<string> {
  return new Set(
    (process.env.MATRIX_LINK_SERVICE_HANDLES || '')
      .split(',')
      .map(h => normalizeHandle(h.trim()))
      .filter(Boolean),
  );
}

function canUseMatrixLinkService(user: RouterUser): boolean {
  return !!user.isAdmin || matrixLinkServiceHandles().has(user.handle);
}

async function requireMatrixLinkServiceAuth(req: IncomingMessage, url: URL, res: ServerResponse): Promise<RouterUser | null> {
  const user = await requireAuth(req, url, res);
  if (!user) return null;
  if (!canUseMatrixLinkService(user)) {
    error(res, 403, 'Matrix link service requires an admin key or MATRIX_LINK_SERVICE_HANDLES allowlist.');
    return null;
  }
  return user;
}

function matrixBindingFor(user: RouterUser | null | undefined) {
  return user?.matrixUserId ? {
    userId: user.matrixUserId,
    boundAt: user.matrixBoundAt,
  } : undefined;
}

const matrixProvisionReplayCache = new MatrixProvisionReplayCache();

function publicUrlBaseFromEnv(): string | undefined {
  return process.env.PUBLIC_URL?.trim().replace(/\/$/, '') || undefined;
}

function matrixSetupUrlFromEnv(): string | undefined {
  const publicUrl = publicUrlBaseFromEnv();
  return publicUrl ? `${publicUrl}/setup` : undefined;
}

function matrixProvisionReplayKey(teamId: string, matrixUserId: string): string {
  return `${teamId}:${matrixUserId.toLowerCase()}`;
}

function matrixAlreadyLinkedResult(user: RouterUser, setupUrl = matrixSetupUrlFromEnv()): MatrixProvisionResult {
  const copy = buildMatrixAlreadyLinkedCopy({ handle: user.handle, setupUrl });
  return {
    status: 200,
    body: {
      alreadyLinked: true,
      handle: user.handle,
      matrixBinding: matrixBindingFor(user),
      setup_url: setupUrl,
      message: copy.message,
      agent_prompt: copy.agentPrompt,
    },
  };
}

async function availableMatrixHandle(matrixUserId: string): Promise<string> {
  const base = matrixHandleBase(matrixUserId);
  const trimmedBase = base.slice(0, 15);
  if (isValidHandle(trimmedBase) && await storage.isHandleAvailable(trimmedBase)) {
    return trimmedBase;
  }

  for (let i = 1; i <= 99; i++) {
    const suffix = `_${i}`;
    const candidate = `${trimmedBase.slice(0, 15 - suffix.length)}${suffix}`;
    if (isValidHandle(candidate) && await storage.isHandleAvailable(candidate)) {
      return candidate;
    }
  }

  for (let i = 0; i < 10; i++) {
    const suffix = `_${randomBytes(2).toString('hex')}`;
    const candidate = `${trimmedBase.slice(0, 15 - suffix.length)}${suffix}`;
    if (isValidHandle(candidate) && await storage.isHandleAvailable(candidate)) {
      return candidate;
    }
  }

  throw new Error('Could not allocate a Router handle for this Matrix user.');
}

async function provisionMatrixRouterUser(
  serviceUser: RouterUser,
  matrixUserId: string,
  body: any,
): Promise<MatrixProvisionResult> {
  const publicUrl = requireEnv('PUBLIC_URL').replace(/\/$/, '');
  const setupUrl = `${publicUrl}/setup`;

  const existing = await storage.getUserByMatrixUserId(matrixUserId);
  if (existing) {
    if (existing.teamId !== serviceUser.teamId) {
      return { status: 409, body: { error: 'Matrix account is linked in a different team.' } };
    }
    return matrixAlreadyLinkedResult(existing, setupUrl);
  }

  const requestedHandle = body?.handle != null ? normalizeHandle(String(body.handle)) : '';
  const handle = requestedHandle || await availableMatrixHandle(matrixUserId);
  if (!isValidHandle(handle)) {
    return {
      status: 400,
      body: { error: 'Invalid handle. Use 3-15 lowercase letters, numbers, and underscores. Must start with a letter.' },
    };
  }
  if (!(await storage.isHandleAvailable(handle))) {
    const raced = await storage.getUserByMatrixUserId(matrixUserId);
    if (raced && raced.teamId === serviceUser.teamId) return matrixAlreadyLinkedResult(raced, setupUrl);
    return { status: 409, body: { error: `Handle @${handle} is already taken.` } };
  }

  const secretKey = generateSecretKey();
  const keyHash = hashSecretKey(secretKey);
  let created: RouterUser;
  try {
    created = await storage.createUser({
      handle,
      secretKeyHash: keyHash,
      teamId: serviceUser.teamId,
      displayName: typeof body?.display_name === 'string' ? body.display_name.trim().slice(0, 80) || undefined : undefined,
      isAdmin: false,
      stagingDelayMs: 0,
    });
  } catch (err) {
    const raced = await storage.getUserByMatrixUserId(matrixUserId);
    if (raced && raced.teamId === serviceUser.teamId) return matrixAlreadyLinkedResult(raced, setupUrl);
    throw err;
  }

  const linked = await storage.bindMatrixAccount(created.handle, matrixUserId);
  if (!linked) {
    await storage.deleteUser(created.handle);
    const raced = await storage.getUserByMatrixUserId(matrixUserId);
    if (raced && raced.teamId === serviceUser.teamId) return matrixAlreadyLinkedResult(raced, setupUrl);
    return { status: 409, body: { error: 'Matrix account was linked while provisioning. Try again.' } };
  }

  const mcpUrl = `${publicUrl}/mcp/sse?key=${secretKey}`;
  const copy = buildMatrixProvisionCopy({
    handle: linked.handle,
    secretKey,
    setupUrl,
    mcpUrl,
  });
  return {
    status: 201,
    body: {
      user: {
        handle: linked.handle,
        teamId: linked.teamId,
        displayName: linked.displayName,
        matrixBinding: matrixBindingFor(linked),
      },
      secret_key: secretKey,
      setup_url: setupUrl,
      mcp_url: mcpUrl,
      message: copy.message,
      agent_prompt: copy.agentPrompt,
    },
  };
}

function sparksEnabled(): boolean {
  return ['1', 'true', 'yes'].includes((process.env.SPARKS_ENABLED || '').trim().toLowerCase());
}

function formatSparkCandidate(sourceHandle: string, candidate: SparkCandidate): string {
  return `@${sourceHandle} <-> @${candidate.handle}: ${candidate.overlapTopics.join(', ') || 'overlap'} (${candidate.matchingEntries.length} matching entries)`;
}

async function searchSparkCandidatesForUser(user: RouterUser, args: { handle?: string; query?: string; limit?: number }) {
  const limit = Math.min(Math.max(Number(args.limit || 10), 1), 25);
  const query = args.query?.trim();
  const explicitHandle = !!args.handle?.trim();
  const canModerate = canModerateSparks(user);
  const requestedHandle = args.handle ? normalizeHandle(args.handle.replace(/^@/, '')) : user.handle;
  if (requestedHandle !== user.handle && !canModerate) {
    throw new Error('Only admins or spark moderators can search sparks for another user.');
  }
  const targetUser = await storage.getUser(requestedHandle);
  if (!targetUser || targetUser.teamId !== user.teamId) {
    throw new Error(`Router user @${requestedHandle} not found in this team.`);
  }

  const collectForHandle = async (handle: string, queryTerms?: string[]): Promise<string[]> => {
    const entries = (await storage.getEntriesByHandle(user.teamId, handle, 5))
      .filter(entry => isPublishedVisibleForSparks(entry));
    const results: string[] = [];
    for (const entry of entries.slice(0, 2)) {
      const candidates = await detectSparks(entry, storage, queryTerms);
      for (const candidate of candidates) {
        results.push(formatSparkCandidate(handle, candidate));
        if (results.length >= limit) return results;
      }
    }
    return results;
  };

  if (query && (!canModerate || explicitHandle)) {
    const queryTerms = query.split(/\s+/).map(term => term.trim()).filter(Boolean).slice(0, 8);
    return collectForHandle(requestedHandle, queryTerms);
  }

  if (query) {
    const entries = (await storage.searchEntries(user.teamId, query, 50))
      .filter(entry => isPublishedVisibleForSparks(entry));
    const handles = [...new Set(entries.map(entry => entry.handle).filter(Boolean))];
    const pairs: string[] = [];
    for (let i = 0; i < handles.length - 1 && pairs.length < limit; i++) {
      for (let j = i + 1; j < handles.length && pairs.length < limit; j++) {
        pairs.push(`@${handles[i]} <-> @${handles[j]}: both have private entries matching "${query}"`);
      }
    }
    return pairs;
  }

  return collectForHandle(requestedHandle);
}

async function triggerSparkForHandles(
  user: RouterUser,
  sourceHandle: string,
  targetHandle: string,
  reason: string,
  message?: string,
) {
  if (!canModerateSparks(user)) {
    throw new Error('Only admins or spark moderators can manually trigger sparks.');
  }
  const source = normalizeHandle(sourceHandle.replace(/^@/, ''));
  const target = normalizeHandle(targetHandle.replace(/^@/, ''));
  if (!source || !target || source === target) throw new Error('source_handle and target_handle must be different.');
  const [sourceUser, targetUser] = await Promise.all([storage.getUser(source), storage.getUser(target)]);
  if (!sourceUser || !targetUser || sourceUser.teamId !== user.teamId || targetUser.teamId !== user.teamId) {
    throw new Error('Both source_handle and target_handle must exist in this team.');
  }
  const matrix = createMatrixSparkGatewayFromEnv();
  if (!matrix) throw new Error('Matrix spark execution is not configured.');

  const [sourceEntries, targetEntries] = await Promise.all([
    storage.getEntriesByHandle(user.teamId, source, 1),
    storage.getEntriesByHandle(user.teamId, target, 3),
  ]);
  const sourceEntry = sourceEntries.find(e => isPublishedVisibleForSparks(e)) || {
    id: `manual-spark-${Date.now()}`,
    handle: source,
    teamId: user.teamId,
    client: 'code' as const,
    content: reason,
    summary: reason,
    tags: ['spark'],
    timestamp: Date.now(),
  };
  const candidate: SparkCandidate = {
    handle: target,
    matchingEntries: targetEntries.filter(e => isPublishedVisibleForSparks(e)).slice(0, 3),
    overlapTopics: [],
  };
  return executeSpark(user.teamId, {
    action: 'introduce',
    confidence: 'high',
    sourceHandle: source,
    targetHandle: target,
    reason,
    message,
  }, candidate, sourceEntry, storage, matrix, { debounceMatrix: false });
}

async function maybeRunSparksForEntry(entry: RouterEntry): Promise<void> {
  if (!sparksEnabled()) return;
  if (!process.env.OPENROUTER_API_KEY) return;
  if (!isPublishedVisibleForSparks(entry)) return;
  const matrix = createMatrixSparkGatewayFromEnv();
  if (!matrix) return;

  const candidates = await detectSparks(entry, storage);
  for (const candidate of candidates.slice(0, 3)) {
    const connectionInfo = await getConnectionInfo(entry.teamId, entry.handle, candidate.handle, storage);
    const action = await evaluateSpark(entry, candidate, connectionInfo, callLLM, {
      evaluationModel: process.env.SPARK_EVALUATION_MODEL,
      copyModel: process.env.SPARK_COPY_MODEL,
    });
    if (action.action !== 'skip') {
      const result = await executeSpark(entry.teamId, action, candidate, entry, storage, matrix);
      if (result.status !== 'skipped') {
        console.log(`[sparks] ${result.status} @${action.sourceHandle} <-> @${action.targetHandle}${result.roomId ? ` (${result.roomId})` : ''}`);
      }
    }
  }
}

function mirrorEntryToMatrix(entry: RouterEntry, logPrefix: string): void {
  maybeMirrorEntryToMatrix(entry, storage)
    .then(result => {
      if (result.status === 'mirrored') {
        console.log(`${logPrefix} Mirrored entry ${entry.id} to Matrix room ${result.roomId}`);
      }
    })
    .catch(err => {
      console.error(`${logPrefix} Matrix mirror failed for ${entry.id}:`, err);
    });
}

// ── Lark Phase 0 helpers ──────────────────────────────────────

const larkNonces: NonceStore = new Map();

// In-memory store keyed by pendingToken; logic lives in ./lark-pending.ts
const pendingLarkRegs: PendingLarkStore = new Map();
const getPendingReg = (token: string) => pendingRegGet(pendingLarkRegs, token);

function requireLarkConfig(res: ServerResponse): LarkRuntimeConfig | null {
  const cfg = loadLarkConfig();
  if (!cfg) {
    error(res, 503, 'lark_not_configured');
    return null;
  }
  return cfg;
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

// ─────────────────────────────────────────────────────────────
// Request handler
// ─────────────────────────────────────────────────────────────

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // CORS headers — echo specific origin (required when credentials=include).
  // Allow-list: PUBLIC_URL + ALLOWED_ORIGINS env (comma-separated). In dev,
  // also accept any http://localhost:* origin so :3000/:4000 webs can hit
  // their respective server :3001/:4001 with cookies.
  const reqOrigin = req.headers.origin;
  if (reqOrigin) {
    const allowed: string[] = [];
    const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, '');
    if (publicUrl) allowed.push(publicUrl);
    if (process.env.ALLOWED_ORIGINS) {
      for (const o of process.env.ALLOWED_ORIGINS.split(',')) {
        const trimmed = o.trim().replace(/\/$/, '');
        if (trimmed) allowed.push(trimmed);
      }
    }
    const isDev = process.env.NODE_ENV !== 'production';
    const isLocalhost = /^https?:\/\/localhost(:\d+)?$/.test(reqOrigin);
    if (allowed.includes(reqOrigin) || (isDev && isLocalhost)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // ── Health check ──
    if (req.method === 'GET' && url.pathname === '/health') {
      const larkWs = larkEventClient ? larkEventClient.state : { connected: false, lastEventAt: null };
      json(res, 200, { status: 'ok', timestamp: Date.now(), lark_ws: larkWs });
      return;
    }

    // GET /api — API documentation (no auth required)
    if (req.method === 'GET' && (url.pathname === '/api' || url.pathname === '/api/')) {
      const publicUrl = requireEnv('PUBLIC_URL').replace(/\/$/, '');
      json(res, 200, {
        name: 'Teleport Router API',
        version: '0.1.1',
        auth: 'All endpoints require ?key=YOUR_SECRET_KEY (except /api, /health, /api/server-info, /api/identity/generate)',
        docs: `${publicUrl}/settings#guide`,
        mcp: {
          sse: `${publicUrl}/mcp/sse?key=YOUR_KEY`,
          messages: `POST ${publicUrl}/mcp/messages?sessionId=SESSION_ID`,
          note: 'SSE connection sends heartbeat comments every 30s to keep the connection alive through proxies.',
        },
        endpoints: [
          { method: 'GET',    path: '/api/entries',                desc: 'List entries (supports ?tags, ?author, ?limit, ?offset)' },
          { method: 'POST',   path: '/api/entries',                desc: 'Create entry (summary, tags, content, channel, oneliner)' },
          { method: 'GET',    path: '/api/entries/:id',            desc: 'Get entry detail' },
          { method: 'DELETE', path: '/api/entries/:id',            desc: 'Delete entry (own only)' },
          { method: 'PATCH',  path: '/api/entries/:id',            desc: 'Update entry (summary, tags, hidden)' },
          { method: 'POST',   path: '/api/entries/:id/publish',    desc: 'Publish pending entry immediately' },
          { method: 'POST',   path: '/api/entries/:id/comments',   desc: 'Add comment (supports @mentions)' },
          { method: 'DELETE', path: '/api/entries/:id/comments/:commentId', desc: 'Delete comment' },
          { method: 'GET',    path: '/api/channels',               desc: 'List team channels (legacy; prefer /api/tags)' },
          { method: 'GET',    path: '/api/channels/:id',           desc: 'Get channel detail + skills + subscribers' },
          { method: 'GET',    path: '/api/channels/:id/timeline',  desc: 'Channel timeline (node-tagged entries within N days)' },
          { method: 'POST',   path: '/api/channels',               desc: 'Create channel (id, name, description)' },
          { method: 'DELETE', path: '/api/channels/:id',           desc: 'Delete channel (admin, keeps entries)' },
          { method: 'POST',   path: '/api/channels/:id/skills',    desc: 'Add skill to channel' },
          { method: 'PATCH',  path: '/api/channels/:id/skills/:name', desc: 'Update skill' },
          { method: 'DELETE', path: '/api/channels/:id/skills/:name', desc: 'Remove skill' },
          { method: 'POST',   path: '/api/channels/:id/join',      desc: 'Join channel' },
          { method: 'POST',   path: '/api/channels/:id/leave',     desc: 'Leave channel' },
          { method: 'GET',    path: '/api/tag-configs',          desc: 'List every tag_config row for the team' },
          { method: 'GET',    path: '/api/tag-configs/:tag',    desc: 'Entries + optional config block for a tag' },
          { method: 'POST',   path: '/api/tag-configs/:tag/subscribe', desc: 'Subscribe (auto-creates tag_config if absent)' },
          { method: 'POST',   path: '/api/tag-configs/:tag/unsubscribe', desc: 'Drop caller from subscribers' },
          { method: 'POST',   path: '/api/tag-configs/:tag/skills', desc: 'Add a skill to a tag (admin)' },
          { method: 'PATCH',  path: '/api/tag-configs/:tag/skills/:name', desc: 'Update a tag skill (admin)' },
          { method: 'DELETE', path: '/api/tag-configs/:tag/skills/:name', desc: 'Remove a tag skill (admin)' },
          { method: 'GET',    path: '/api/me',                     desc: 'Current user info (handle, team, settings, mcpSchemaVersion)' },
          { method: 'PATCH',  path: '/api/users/me',               desc: 'Update profile (displayName, bio, email, role, stagingDelayMs, notificationWebhook)' },
          { method: 'DELETE', path: '/api/users/:handle',          desc: 'Delete user (admin only, keeps entries)' },
          { method: 'GET',    path: '/api/team',                   desc: 'Team info + member list' },
          { method: 'GET',    path: '/api/preset-tags',            desc: 'List all preset tags' },
          { method: 'POST',   path: '/api/preset-tags',            desc: 'Add preset tag (admin, {name, description})' },
          { method: 'PATCH',  path: '/api/preset-tags/:name',      desc: 'Update preset tag description (admin)' },
          { method: 'DELETE', path: '/api/preset-tags/:name',      desc: 'Delete preset tag (admin)' },
          { method: 'POST',   path: '/api/tags',                   desc: 'Create custom tag ({name})' },
          { method: 'POST',   path: '/api/tags/merge',             desc: 'Merge tags (admin, {from, to})' },
          { method: 'DELETE', path: '/api/tags/:name',             desc: 'Delete tag from all entries (admin)' },
          { method: 'POST',   path: '/api/feedback',               desc: 'Submit feedback (content, category, page)' },
          { method: 'POST',   path: '/api/identity/generate',      desc: 'Generate new secret key (no auth)' },
          { method: 'POST',   path: '/api/identity/link-matrix',   desc: 'Redeem a Matrix link code for current user' },
          { method: 'GET',    path: '/api/matrix/link-status',     desc: 'Matrix service: resolve Matrix/Router link status' },
          { method: 'POST',   path: '/api/matrix/link-code',       desc: 'Matrix service: create short-lived link code' },
          { method: 'POST',   path: '/api/matrix/provision',       desc: 'Matrix service: provision a linked Router user' },
          { method: 'GET',    path: '/api/sparks',                 desc: 'Search private-team spark candidates' },
          { method: 'POST',   path: '/api/sparks/trigger',         desc: 'Admin/moderator: manually trigger a Matrix spark room' },
          { method: 'POST',   path: '/api/team/create',            desc: 'Create team (secret_key, handle, team_name)' },
          { method: 'POST',   path: '/api/team/join',              desc: 'Join team (secret_key, handle, invite_code)' },
          { method: 'POST',   path: '/api/invite/generate',        desc: 'Generate invite code (admin)' },
          { method: 'GET',    path: '/api/notifications',          desc: 'Get notifications' },
          { method: 'GET',    path: '/api/notifications/unread-count', desc: 'Unread count' },
          { method: 'POST',   path: '/api/notifications/read-all', desc: 'Mark all read' },
          { method: 'GET',    path: '/health',                     desc: 'Health check' },
          { method: 'GET',    path: '/api/server-info',            desc: 'Feature flags for web frontend (no auth)' },
        ],
      });
      return;
    }

    // GET /api/server-info — feature flags for the web frontend (no auth)
    if (req.method === 'GET' && url.pathname === '/api/server-info') {
      json(res, 200, buildServerInfo());
      return;
    }

    // ════════════════════════════════════════════════════════
    // Identity endpoints (no auth required for generate)
    // ════════════════════════════════════════════════════════

    // POST /api/identity/generate — Generate a new secret key
    if (req.method === 'POST' && url.pathname === '/api/identity/generate') {
      const secretKey = generateSecretKey();
      const pseudonym = derivePseudonym(secretKey);
      json(res, 200, {
        secret_key: secretKey,
        pseudonym,
        warning: 'Save this key securely. If lost, this identity cannot be recovered.',
      });
      return;
    }

    // POST /api/team/create — Create a new team + register admin
    if (req.method === 'POST' && url.pathname === '/api/team/create') {
      const body = JSON.parse(await readBody(req));
      const { secret_key, handle: rawHandle, team_name, display_name } = body;

      // Validate key
      if (!secret_key || !isValidSecretKey(secret_key)) {
        error(res, 400, 'Invalid secret key');
        return;
      }

      // Validate handle
      const handle = normalizeHandle(rawHandle || '');
      if (!isValidHandle(handle)) {
        error(res, 400, 'Invalid handle. Use 3-15 lowercase letters, numbers, and underscores. Must start with a letter.');
        return;
      }

      // Validate team name
      if (!team_name || typeof team_name !== 'string' || team_name.trim().length < 2) {
        error(res, 400, 'Team name must be at least 2 characters.');
        return;
      }

      const teamId = teamNameToId(team_name.trim());
      if (!isValidTeamId(teamId)) {
        error(res, 400, `Invalid team ID derived from name: "${teamId}". Use 2-30 alphanumeric + hyphens.`);
        return;
      }

      // Check availability
      const keyHash = hashSecretKey(secret_key);
      const existingUser = await storage.getUserByKeyHash(keyHash);
      if (existingUser) {
        error(res, 409, 'This key already has an account.');
        return;
      }

      if (!(await storage.isHandleAvailable(handle))) {
        error(res, 409, `Handle @${handle} is already taken.`);
        return;
      }

      if (!(await storage.isTeamIdAvailable(teamId))) {
        error(res, 409, `Team "${teamId}" already exists.`);
        return;
      }

      // Create team + admin user
      const team = await storage.createTeam({
        id: teamId,
        name: team_name.trim(),
        createdBy: handle,
        createdAt: Date.now(),
      });

      const user = await storage.createUser({
        handle,
        secretKeyHash: keyHash,
        teamId: team.id,
        displayName: display_name || undefined,
        isAdmin: true,
      });

      json(res, 201, {
        team: { id: team.id, name: team.name },
        user: { handle: user.handle, teamId: user.teamId, isAdmin: user.isAdmin },
        mcp_url: `${protocol}://localhost:${PORT}/mcp/sse?key=${secret_key}`,
      });
      return;
    }

    // POST /api/identity/register — Join a team with invite code
    if (req.method === 'POST' && url.pathname === '/api/identity/register') {
      const body = JSON.parse(await readBody(req));
      const { secret_key, handle: rawHandle, invite_code, display_name } = body;

      // Validate key
      if (!secret_key || !isValidSecretKey(secret_key)) {
        error(res, 400, 'Invalid secret key');
        return;
      }

      // Validate handle
      const handle = normalizeHandle(rawHandle || '');
      if (!isValidHandle(handle)) {
        error(res, 400, 'Invalid handle. Use 3-15 lowercase letters, numbers, and underscores. Must start with a letter.');
        return;
      }

      // Require invite code
      if (!invite_code || typeof invite_code !== 'string') {
        error(res, 400, 'Invite code is required to join a team. Create a new team via POST /api/team/create instead.');
        return;
      }

      // Validate invite
      const invite = await storage.getTeamInvite(invite_code);
      if (!invite) {
        error(res, 403, 'Invalid invite code.');
        return;
      }

      // Check availability
      const keyHash = hashSecretKey(secret_key);
      const existingUser = await storage.getUserByKeyHash(keyHash);
      if (existingUser) {
        error(res, 409, 'This key already has an account.');
        return;
      }

      if (!(await storage.isHandleAvailable(handle))) {
        error(res, 409, `Handle @${handle} is already taken.`);
        return;
      }

      // Use invite (validates expiry + max uses)
      try {
        await storage.useTeamInvite(invite_code);
      } catch (err: any) {
        error(res, 403, err.message);
        return;
      }

      // Create user
      const user = await storage.createUser({
        handle,
        secretKeyHash: keyHash,
        teamId: invite.teamId,
        displayName: display_name || undefined,
        isAdmin: false,
      });

      json(res, 201, {
        user: { handle: user.handle, teamId: user.teamId, isAdmin: user.isAdmin },
        mcp_url: `${protocol}://localhost:${PORT}/mcp/sse?key=${secret_key}`,
      });
      return;
    }

    // POST /api/invite/generate — Admin generates invite code
    if (req.method === 'POST' && url.pathname === '/api/invite/generate') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      if (!user.isAdmin) {
        error(res, 403, 'Only team admins can generate invite codes.');
        return;
      }

      const body = JSON.parse(await readBody(req));
      const { max_uses, expires_days } = body || {};

      const invite = await storage.createTeamInvite({
        code: generateInviteCode(),
        teamId: user.teamId,
        createdBy: user.handle,
        createdAt: Date.now(),
        expiresAt: expires_days ? Date.now() + expires_days * 24 * 60 * 60 * 1000 : undefined,
        maxUses: max_uses || undefined,
        uses: 0,
      });

      json(res, 201, {
        invite_code: invite.code,
        teamId: invite.teamId,
        max_uses: invite.maxUses || 'unlimited',
        expires_at: invite.expiresAt ? new Date(invite.expiresAt).toISOString() : 'never',
      });
      return;
    }

    // GET /api/identity/check/:handle — Check handle availability
    if (req.method === 'GET' && url.pathname.startsWith('/api/identity/check/')) {
      const handle = decodeURIComponent(url.pathname.slice('/api/identity/check/'.length));
      const available = await storage.isHandleAvailable(normalizeHandle(handle));
      json(res, 200, { handle: normalizeHandle(handle), available });
      return;
    }

    // POST /api/identity/link-matrix — current user redeems a Matrix DM code
    if (req.method === 'POST' && url.pathname === '/api/identity/link-matrix') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const body = JSON.parse(await readBody(req));
      const code = typeof body?.code === 'string' ? body.code : '';
      if (!code.trim()) {
        error(res, 400, 'code is required.');
        return;
      }
      if (user.matrixUserId) {
        error(res, 409, `This Router account is already linked to ${user.matrixUserId}.`);
        return;
      }

      const token = redeemMatrixLinkCode(code, user.teamId);
      if (!token) {
        error(res, 400, 'Invalid or expired Matrix link code.');
        return;
      }

      const existing = await storage.getUserByMatrixUserId(token.matrixUserId);
      if (existing && existing.handle !== user.handle) {
        error(res, 409, `That Matrix account is already linked to @${existing.handle}.`);
        return;
      }

      const updated = await storage.bindMatrixAccount(user.handle, token.matrixUserId);
      if (!updated) {
        error(res, 409, 'That Matrix account is already linked to another Router user.');
        return;
      }

      json(res, 200, {
        ok: true,
        handle: updated.handle,
        matrixBinding: matrixBindingFor(updated),
      });
      return;
    }

    // GET /api/matrix/link-status — Matrix service resolves link state
    if (req.method === 'GET' && url.pathname === '/api/matrix/link-status') {
      const serviceUser = await requireMatrixLinkServiceAuth(req, url, res);
      if (!serviceUser) return;

      const matrixUserId = url.searchParams.get('matrix_user_id') || '';
      const handle = normalizeHandle(url.searchParams.get('handle') || '');
      if (matrixUserId) {
        if (!isMatrixUserId(matrixUserId)) {
          error(res, 400, 'Invalid Matrix user ID.');
          return;
        }
        const linked = await storage.getUserByMatrixUserId(matrixUserId);
        if (!linked) {
          json(res, 200, { linked: false, matrixUserId });
          return;
        }
        if (linked.teamId !== serviceUser.teamId) {
          error(res, 409, 'Matrix account is linked in a different team.');
          return;
        }
        json(res, 200, {
          linked: true,
          handle: linked.handle,
          matrixBinding: matrixBindingFor(linked),
        });
        return;
      }

      if (handle) {
        const linked = await storage.getUser(handle);
        if (!linked || linked.teamId !== serviceUser.teamId) {
          error(res, 404, 'Router user not found.');
          return;
        }
        json(res, 200, {
          linked: !!linked.matrixUserId,
          handle: linked.handle,
          matrixBinding: matrixBindingFor(linked),
        });
        return;
      }

      error(res, 400, 'matrix_user_id or handle is required.');
      return;
    }

    // POST /api/matrix/link-code — Matrix service creates a short-lived link code
    if (req.method === 'POST' && url.pathname === '/api/matrix/link-code') {
      const serviceUser = await requireMatrixLinkServiceAuth(req, url, res);
      if (!serviceUser) return;

      const body = JSON.parse(await readBody(req));
      const matrixUserId = String(body?.matrix_user_id || '').trim();
      if (!isMatrixUserId(matrixUserId)) {
        error(res, 400, 'Invalid Matrix user ID.');
        return;
      }

      const existing = await storage.getUserByMatrixUserId(matrixUserId);
      if (existing) {
        if (existing.teamId !== serviceUser.teamId) {
          error(res, 409, 'Matrix account is linked in a different team.');
          return;
        }
        const linked = matrixAlreadyLinkedResult(existing);
        json(res, 200, {
          ...linked.body,
        });
        return;
      }

      const token = generateMatrixLinkCode({
        matrixUserId,
        teamId: serviceUser.teamId,
        issuedByHandle: serviceUser.handle,
      });
      const copy = buildMatrixLinkCopy({
        code: token.code,
        expiresAt: token.expiresAt,
        setupUrl: matrixSetupUrlFromEnv(),
      });
      json(res, 201, {
        code: token.code,
        expiresAt: token.expiresAt,
        matrixUserId: token.matrixUserId,
        message: copy.message,
        agent_prompt: copy.agentPrompt,
      });
      return;
    }

    // POST /api/matrix/provision — Matrix service creates and links a Router user
    if (req.method === 'POST' && url.pathname === '/api/matrix/provision') {
      const serviceUser = await requireMatrixLinkServiceAuth(req, url, res);
      if (!serviceUser) return;

      const body = JSON.parse(await readBody(req));
      const matrixUserId = String(body?.matrix_user_id || '').trim();
      if (!isMatrixUserId(matrixUserId)) {
        error(res, 400, 'Invalid Matrix user ID.');
        return;
      }

      const result = await matrixProvisionReplayCache.run(
        matrixProvisionReplayKey(serviceUser.teamId, matrixUserId),
        () => provisionMatrixRouterUser(serviceUser, matrixUserId, body),
      );
      json(res, result.status, result.body);
      return;
    }

    // GET /api/sparks — private team spark candidate search
    if (req.method === 'GET' && url.pathname === '/api/sparks') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      try {
        const results = await searchSparkCandidatesForUser(user, {
          handle: url.searchParams.get('handle') || undefined,
          query: url.searchParams.get('query') || undefined,
          limit: Number(url.searchParams.get('limit') || 10),
        });
        json(res, 200, { sparks: results });
      } catch (err: any) {
        error(res, 400, err.message || 'Spark search failed.');
      }
      return;
    }

    // POST /api/sparks/trigger — admin/moderator manual Matrix spark
    if (req.method === 'POST' && url.pathname === '/api/sparks/trigger') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      try {
        const body = JSON.parse(await readBody(req));
        const result = await triggerSparkForHandles(
          user,
          String(body?.source_handle || ''),
          String(body?.target_handle || ''),
          String(body?.reason || '').trim(),
          typeof body?.message === 'string' ? body.message.trim() : undefined,
        );
        json(res, 200, result);
      } catch (err: any) {
        error(res, 400, err.message || 'Spark trigger failed.');
      }
      return;
    }

    // ════════════════════════════════════════════════════════
    // M2a.5 — Web sessions (cookie-based browser auth)
    // ════════════════════════════════════════════════════════

    // POST /api/auth/session — create a session from a secret_key
    //   Body: { secret_key: string }
    //   Used by: frontend on mount when localStorage has key but no cookie;
    //   also by the secret_key login form to get a cookie alongside.
    if (req.method === 'POST' && url.pathname === '/api/auth/session') {
      let body: any = {};
      try { body = JSON.parse(await readBody(req)); } catch { /* empty body */ }
      const key: string | undefined = body?.secret_key;
      if (!key || !isValidSecretKey(key)) {
        error(res, 400, 'invalid_secret_key');
        return;
      }
      const user = await storage.getUserByKeyHash(hashSecretKey(key));
      if (!user) {
        error(res, 401, 'unknown_secret_key');
        return;
      }
      const ua = (req.headers['user-agent'] || '').toString().slice(0, 200);
      const { token, expiresAt } = await storage.createSession(user.handle, undefined, ua || undefined);
      setSessionCookie(res, token);
      json(res, 200, { handle: user.handle, expiresAt });
      return;
    }

    // POST /api/auth/verify-key — check if a plaintext secret_key matches the
    //   currently-authenticated user (cookie or ?key=). Lets a logged-in user
    //   restore their localStorage cache without rotating: paste key → server
    //   says "yes that's yours" → frontend writes it to localStorage.
    //   No-op if user authed with the same ?key= already.
    if (req.method === 'POST' && url.pathname === '/api/auth/verify-key') {
      const user = await requireAuth(req, url, res); if (!user) return;
      let body: any = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const candidate: string | undefined = body?.secret_key;
      if (!candidate || !isValidSecretKey(candidate)) {
        error(res, 400, 'invalid_secret_key_format');
        return;
      }
      const candidateHash = hashSecretKey(candidate);
      const matches = candidateHash === user.secretKeyHash;
      json(res, 200, { matches, handle: user.handle });
      return;
    }

    // POST /api/auth/mcp-credential — explicit MCP key rotation (user-initiated)
    //   Auth required. Rotates secret_key (old enters 7-day grace),
    //   returns new key plaintext ONCE. Caller is expected to copy it
    //   into their CC / Codex / mobile MCP config.
    //
    //   This is the ONLY way secret_key changes after M2a.5 — Feishu
    //   login no longer rotates.
    if (req.method === 'POST' && url.pathname === '/api/auth/mcp-credential') {
      const user = await requireAuth(req, url, res); if (!user) return;
      const result = await storage.rotateSecretKey(user.handle);
      if (!result) {
        error(res, 500, 'rotate_failed');
        return;
      }
      json(res, 200, {
        secret_key: result.newKey,
        grace_until: result.user.previousSecretKeyExpiresAt,
        warning: 'Save this key now. It will not be shown again. Old key works for 7 days during grace.',
      });
      return;
    }

    // DELETE /api/auth/session — revoke current session (logout)
    if (req.method === 'DELETE' && url.pathname === '/api/auth/session') {
      const cookies = parseCookies(req);
      const token = cookies.get(SESSION_COOKIE);
      if (token) await storage.deleteSession(token).catch(() => {});
      clearSessionCookie(res);
      json(res, 200, { ok: true });
      return;
    }

    // ════════════════════════════════════════════════════════
    // Lark Phase 0 — OAuth binding + recovery
    // ════════════════════════════════════════════════════════

    // POST /api/lark/authorize — bind flow start (auth required)
    if (req.method === 'POST' && url.pathname === '/api/lark/authorize') {
      const cfg = requireLarkConfig(res); if (!cfg) return;
      const user = await requireAuth(req, url, res); if (!user) return;

      const state = signState({
        nonce: newNonce(),
        intent: 'bind',
        handle: user.handle,
        exp: Date.now() + 5 * 60 * 1000,
      }, cfg.stateSecret);

      const authorizeUrl = buildAuthorizeUrl({
        appId: cfg.appId,
        redirectUri: cfg.redirectUri,
        scopes: LARK_OAUTH_USER_SCOPES,
        state,
        domain: cfg.domain,
      });

      json(res, 200, { authorize_url: authorizeUrl });
      return;
    }

    // POST /api/lark/login — login/recovery flow start (no auth required)
    //   Body: { caller_key?: string, invite_code?: string }
    //   - caller_key: localStorage key tag for D5 (skip rotation if same user)
    //   - invite_code: when user came from /register?invite=XXX, prefill the
    //                  team invite on /register/lark form
    if (req.method === 'POST' && url.pathname === '/api/lark/login') {
      const cfg = requireLarkConfig(res); if (!cfg) return;
      const body = req.headers['content-length'] && Number(req.headers['content-length']) > 0
        ? JSON.parse(await readBody(req))
        : {};
      const callerKey: string | undefined = body?.caller_key;
      const callerKeyHash = callerKey && isValidSecretKey(callerKey)
        ? hashSecretKey(callerKey)
        : undefined;
      const inviteCode: string | undefined = typeof body?.invite_code === 'string' && body.invite_code.trim()
        ? body.invite_code.trim()
        : undefined;

      const state = signState({
        nonce: newNonce(),
        intent: 'login',
        callerKeyHash,
        inviteCode,
        exp: Date.now() + 5 * 60 * 1000,
      }, cfg.stateSecret);

      const authorizeUrl = buildAuthorizeUrl({
        appId: cfg.appId,
        redirectUri: cfg.redirectUri,
        scopes: LARK_OAUTH_USER_SCOPES,
        state,
        domain: cfg.domain,
      });

      json(res, 200, { authorize_url: authorizeUrl });
      return;
    }

    // GET /api/lark/callback — OAuth redirect target (handles bind + login)
    if (req.method === 'GET' && url.pathname === '/api/lark/callback') {
      const cfg = requireLarkConfig(res); if (!cfg) return;
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const err = url.searchParams.get('error');

      if (!state) return redirect(res, '/?error=invalid_state');
      const verified = verifyState(state, cfg.stateSecret);
      if (!verified.ok) return redirect(res, '/?error=invalid_state');
      const { payload } = verified;

      // Single-use nonce (TTL = state.exp)
      if (!claimNonce(larkNonces, payload.nonce, payload.exp)) {
        return redirect(res, '/?error=invalid_state');
      }

      const fallbackPath = payload.intent === 'bind' ? '/settings' : '/';

      // User denied at Lark side
      if (err) {
        return redirect(res, `${fallbackPath}?error=user_denied`);
      }

      if (!code) {
        return redirect(res, `${fallbackPath}?error=lark_error&detail=missing_code`);
      }

      // Exchange code → tokens, fetch user info
      let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
      let info: Awaited<ReturnType<typeof fetchLarkUserInfo>>;
      try {
        tokens = await exchangeCodeForTokens({
          domain: cfg.domain,
          appId: cfg.appId,
          appSecret: cfg.appSecret,
          code,
          redirectUri: cfg.redirectUri,
        });
        info = await fetchLarkUserInfo({ domain: cfg.domain, accessToken: tokens.accessToken });
      } catch (e: any) {
        console.error('[lark/callback] token/info fetch failed', e);
        return redirect(res, `${fallbackPath}?error=lark_error&detail=${encodeURIComponent(e.message || 'fetch_failed')}`);
      }

      if (payload.intent === 'bind') {
        const handle = payload.handle;
        if (!handle) return redirect(res, '/settings?error=lark_error&detail=missing_handle');
        const bound = await storage.bindLarkAccount(handle, {
          larkOpenId: info.openId,
          larkUnionId: info.unionId,
          larkName: info.name,
          larkAvatarUrl: info.avatarUrl,
          larkRefreshToken: tokens.refreshToken,
          larkRefreshTokenExpiresAt: Date.now() + tokens.refreshExpiresIn * 1000,
          larkScopes: tokens.scopes,
          larkBoundAt: Date.now(),
        });
        if (!bound) return redirect(res, '/settings?error=conflict');
        return redirect(res, '/settings?status=success');
      }

      // intent=login: sign in to the router account bound to this lark open_id.
      // M2a.5: NO key rotation. We set a session cookie instead, leaving the
      // user's secret_key (and therefore their CC MCP) untouched. Multi-device
      // users get one session per device; everyone keeps the same secret_key.
      const targetUser = await storage.getUserByLarkOpenId(info.openId);

      // Came from an invite link (state has inviteCode). The user's intent
      // was to REGISTER a new account into a team — not to log into an
      // existing one. If their Lark is already bound to some other router
      // user, redirect back to /register?invite=… with an error so they can
      // either (a) use plain Lark login from the home page if they meant to
      // log in, or (b) use a different Lark account to actually register.
      if (payload.inviteCode && targetUser) {
        const errParams = new URLSearchParams({
          invite: payload.inviteCode,
          error: 'lark_already_bound',
          handle: targetUser.handle,
        });
        return redirect(res, `/register?${errParams.toString()}`);
      }

      if (!targetUser) {
        // M2a.5b: no router account for this Lark user → start a registration
        // pending row + redirect to /register/lark to collect handle + invite_code.
        const pendingToken = makePendingRegToken();
        pendingRegPut(pendingLarkRegs, pendingToken, {
          openId: info.openId,
          unionId: info.unionId,
          name: info.name,
          avatarUrl: info.avatarUrl,
          refreshToken: tokens.refreshToken,
          refreshExpiresAt: Date.now() + tokens.refreshExpiresIn * 1000,
          scopes: tokens.scopes,
          expiresAt: Date.now() + DEFAULT_PENDING_TTL_MS,
        });
        const params = new URLSearchParams({ pending: pendingToken });
        if (info.name) params.set('name', info.name);
        if (info.avatarUrl) params.set('avatar', info.avatarUrl);
        if (payload.inviteCode) params.set('invite_code', payload.inviteCode);
        return redirect(res, `/register/lark?${params.toString()}`);
      }

      const ua = (req.headers['user-agent'] || '').toString().slice(0, 200);
      const { token } = await storage.createSession(targetUser.handle, undefined, ua || undefined);
      setSessionCookie(res, token);
      // Frontend reads ?lark_login=1 to know it just came back from a successful
      // Lark login (so it can refetch /api/me, since cookie auth is now in effect).
      return redirect(res, `/?lark_login=1&handle=${encodeURIComponent(targetUser.handle)}`);
    }

    // DELETE /api/lark/binding — unbind current user
    if (req.method === 'DELETE' && url.pathname === '/api/lark/binding') {
      const user = await requireAuth(req, url, res); if (!user) return;
      await storage.unbindLarkAccount(user.handle);
      json(res, 200, { ok: true });
      return;
    }

    // ── M2b: Lark card callback (signature-verified) ──
    if (req.method === 'POST' && url.pathname === '/api/lark/card-callback') {
      const cfg = loadLarkConfig();
      if (!cfg) return error(res, 503, 'lark_not_configured');
      const raw = await readBody(req);
      const ts = req.headers['x-lark-request-timestamp'] as string | undefined;
      const nonce = req.headers['x-lark-request-nonce'] as string | undefined;
      const sig = req.headers['x-lark-signature'] as string | undefined;
      if (cfg.verificationToken && (!ts || !nonce || !sig)) return error(res, 401, 'missing_signature');
      if (cfg.verificationToken && !verifyCardSignature({ token: cfg.verificationToken, timestamp: ts!, nonce: nonce!, body: raw, signature: sig! })) {
        return error(res, 401, 'bad_signature');
      }
      let payload: any;
      try { payload = JSON.parse(raw); } catch { return error(res, 400, 'bad_json'); }
      // Lark URL-verification challenge
      if (payload?.type === 'url_verification' && typeof payload.challenge === 'string') {
        return json(res, 200, { challenge: payload.challenge });
      }
      // Card action
      if (payload?.action) {
        const result = await handleCardAction(payload, {
          storage,
          tokenCache: summaryTokenCache ?? undefined,
          apiClient: larkApiClientForEffects ?? undefined,
          publicUrl: process.env.PUBLIC_URL ?? '',
        });
        return json(res, 200, { toast: { type: 'info', content: result.toast } });
      }
      return json(res, 200, {});
    }

    // GET /api/lark/bindings?channel_id=...
    if (req.method === 'GET' && url.pathname === '/api/lark/bindings') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const channelId = url.searchParams.get('channel_id');
      if (!channelId) return error(res, 400, 'channel_id required');
      // Scope tag lookup to the caller's team — `getChannel(id)` walks
      // `tag_configs` without team filter and `LIMIT 1`s, so the same tag name
      // in two teams would return whichever row Postgres picked first.
      const tagConfig = await storage.getTagConfig(user.teamId, channelId);
      if (!tagConfig) return error(res, 404, 'channel_not_found');
      const list = await storage.listLarkChatBindingsByChannel(channelId);
      // Hydrate chat-level prefs (style lives in lark_chat_prefs, not on the binding).
      const hydrated = await Promise.all(list.map(async b => {
        const style = await storage.getLarkChatStyle(b.chatId);
        return { ...b, summaryStyle: style ?? b.summaryStyle ?? 'person' };
      }));
      return json(res, 200, { bindings: hydrated });
    }

    // GET /api/lark/watch-observations?chat_id=...&limit=20
    if (req.method === 'GET' && url.pathname === '/api/lark/watch-observations') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const chatId = url.searchParams.get('chat_id');
      if (!chatId) return error(res, 400, 'chat_id required');
      // Verify the user's team owns the binding for this chat
      const binding = await storage.getLarkChatBinding(chatId);
      if (!binding) return error(res, 404, 'binding_not_found');
      if (binding.teamId !== user.teamId) return error(res, 403, 'forbidden');
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 100);
      const observations = await storage.listLarkWatchObservationsRecent(chatId, limit);
      // Storage returns oldest-first; reverse for newest-first display
      return json(res, 200, { observations: observations.reverse() });
    }

    // DELETE / PATCH /api/lark/bindings/:chat_id
    {
      const m = url.pathname.match(/^\/api\/lark\/bindings\/([^/]+)$/);
      if (m && (req.method === 'DELETE' || req.method === 'PATCH')) {
        const user = await requireAuth(req, url, res);
        if (!user) return;
        const chatId = decodeURIComponent(m[1]);
        const existing = await storage.getLarkChatBinding(chatId);
        if (!existing) return error(res, 404, 'binding_not_found');
        if (existing.teamId !== user.teamId) return error(res, 403, 'forbidden');
        if (req.method === 'DELETE') {
          await storage.deleteLarkChatBinding(chatId);
          return json(res, 204, null);
        }
        // PATCH — accepts pushEnabled / watchEnabled / archiveChannelId
        let body: any = {};
        try { body = JSON.parse(await readBody(req)); } catch {}
        if (typeof body.pushEnabled === 'boolean') {
          await storage.updateLarkBindingPushEnabled(chatId, body.pushEnabled);
        }
        if (typeof body.watchEnabled === 'boolean') {
          await storage.updateLarkBindingWatchEnabled(chatId, body.watchEnabled);
        }
        if (typeof body.archiveChannelId === 'string' || body.archiveChannelId === null) {
          // Validate archive target if non-null
          if (body.archiveChannelId) {
            const archiveCh = await storage.getChannel(body.archiveChannelId);
            if (!archiveCh || archiveCh.teamId !== user.teamId) {
              return error(res, 400, 'invalid_archive_channel');
            }
          }
          await storage.updateLarkBindingArchive(chatId, body.archiveChannelId);
        }
        if (body.summaryStyle === 'person' || body.summaryStyle === 'topic' || body.summaryStyle === 'free') {
          // Style is a chat-level pref, stored in lark_chat_prefs (not on the
          // binding row) — works whether bound or not.
          await storage.setLarkChatStyle(chatId, body.summaryStyle);
        }
        const updated = await storage.getLarkChatBinding(chatId);
        const style = await storage.getLarkChatStyle(chatId);
        const hydrated = updated ? { ...updated, summaryStyle: style ?? updated.summaryStyle ?? 'person' } : null;
        return json(res, 200, { binding: hydrated });
      }
    }

    // GET / PATCH /api/lark/bindings/:chat_id/auto-summary
    // Requires a binding (team-scoped). Unbound chats can still configure
    // auto-summary via the Lark `/settings` card directly.
    {
      const m = url.pathname.match(/^\/api\/lark\/bindings\/([^/]+)\/auto-summary$/);
      if (m && (req.method === 'GET' || req.method === 'PATCH')) {
        const user = await requireAuth(req, url, res);
        if (!user) return;
        const chatId = decodeURIComponent(m[1]);
        const binding = await storage.getLarkChatBinding(chatId);
        if (!binding) return error(res, 404, 'binding_not_found');
        if (binding.teamId !== user.teamId) return error(res, 403, 'forbidden');

        const toView = (p: import('./storage.js').LarkAutoSummaryPrefs | null) => {
          // Map storage shape → web wire format. Defaults when no row exists.
          const cadence = !p
            ? 'daily'
            : p.cadenceKind === 'hourly'
              ? (p.cadenceValue === 12 ? 'hourly:12' : 'hourly:6')
              : p.cadenceKind === 'weekly'
                ? 'weekly'
                : 'daily';
          return {
            chatId,
            enabled: !!p?.enabled,
            cadence,
            fireHour: p?.fireHour ?? 9,
            lastRunAt: p?.lastRunAt ?? null,
          };
        };

        if (req.method === 'GET') {
          const cur = await storage.getLarkAutoSummary(chatId);
          return json(res, 200, { prefs: toView(cur) });
        }

        // PATCH — partial update; missing fields keep current value.
        let body: any = {};
        try { body = JSON.parse(await readBody(req)); } catch {}
        const cur = await storage.getLarkAutoSummary(chatId);

        let cadenceKind: 'daily' | 'weekly' | 'hourly' = cur?.cadenceKind ?? 'daily';
        let cadenceValue: number | null = cur?.cadenceValue ?? null;
        if (typeof body.cadence === 'string') {
          if (body.cadence === 'daily') { cadenceKind = 'daily'; cadenceValue = null; }
          else if (body.cadence === 'weekly') { cadenceKind = 'weekly'; cadenceValue = null; }
          else if (body.cadence === 'hourly:6') { cadenceKind = 'hourly'; cadenceValue = 6; }
          else if (body.cadence === 'hourly:12') { cadenceKind = 'hourly'; cadenceValue = 12; }
          else return error(res, 400, 'invalid_cadence');
        }

        let fireHour = cur?.fireHour ?? 9;
        if (typeof body.fireHour === 'number') {
          if (!Number.isInteger(body.fireHour) || body.fireHour < 0 || body.fireHour > 23) {
            return error(res, 400, 'invalid_fire_hour');
          }
          fireHour = body.fireHour;
        }

        const enabled = typeof body.enabled === 'boolean' ? body.enabled : cur?.enabled ?? false;

        await storage.setLarkAutoSummary(chatId, {
          enabled,
          cadenceKind,
          cadenceValue,
          fireHour,
          // Preserve original setupByOpenId if it exists; web-driven changes
          // don't overwrite (we don't know the requester's lark open_id here).
          setupByOpenId: cur?.setupByOpenId ?? null,
        });
        const after = await storage.getLarkAutoSummary(chatId);
        return json(res, 200, { prefs: toView(after) });
      }
    }

    // GET /api/lark/register-pending?token=plr_xxx — fetch the pending Lark
    // identity for the registration form to display (name, avatar). Doesn't
    // consume the pending row.
    if (req.method === 'GET' && url.pathname === '/api/lark/register-pending') {
      const token = url.searchParams.get('token');
      if (!token) { error(res, 400, 'token required'); return; }
      const p = getPendingReg(token);
      if (!p) { error(res, 404, 'pending_not_found_or_expired'); return; }
      json(res, 200, { openId: p.openId, name: p.name, avatarUrl: p.avatarUrl, expiresAt: p.expiresAt });
      return;
    }

    // POST /api/lark/register-complete — finalize Lark-direct registration.
    //   Body: { pending: token, handle, invite_code }
    //   Atomically: creates user with auto-generated secret_key, joins team
    //   via invite_code, binds Lark, sets session cookie, returns the
    //   plaintext key once for the user to copy (optional — they can also
    //   rotate it later from settings).
    if (req.method === 'POST' && url.pathname === '/api/lark/register-complete') {
      const cfg = requireLarkConfig(res); if (!cfg) return;
      let body: any = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const pendingToken: string | undefined = body?.pending;
      const rawHandle: string | undefined = body?.handle;
      const inviteCode: string | undefined = body?.invite_code;

      if (!pendingToken || !rawHandle || !inviteCode) {
        error(res, 400, 'pending, handle, and invite_code are required');
        return;
      }
      const pending = getPendingReg(pendingToken);
      if (!pending) { error(res, 404, 'pending_not_found_or_expired'); return; }

      const handle = normalizeHandle(rawHandle);
      if (!isValidHandle(handle)) {
        error(res, 400, 'invalid_handle (3-15 lowercase letters/digits, must start with letter)');
        return;
      }

      // Re-check open_id not bound to anyone (race-protection)
      const conflictUser = await storage.getUserByLarkOpenId(pending.openId);
      if (conflictUser) {
        // Someone else completed binding for this open_id while form was open
        pendingRegConsume(pendingLarkRegs, pendingToken);
        error(res, 409, 'lark_account_already_bound');
        return;
      }

      const invite = await storage.getTeamInvite(inviteCode);
      if (!invite) { error(res, 403, 'invalid_invite_code'); return; }
      if (!(await storage.isHandleAvailable(handle))) {
        error(res, 409, `handle_taken:@${handle}`);
        return;
      }

      // Generate secret_key, create user, consume invite, bind Lark — best-effort
      // ordering: we use invite first so we don't create a stranded user if it
      // fails; createUser if useTeamInvite throws is impossible since it's the
      // first storage write here.
      try {
        await storage.useTeamInvite(inviteCode);
      } catch (err: any) {
        error(res, 403, err.message || 'invite_use_failed');
        return;
      }

      const newKey = generateSecretKey();
      const newKeyHash = hashSecretKey(newKey);
      const user = await storage.createUser({
        handle,
        secretKeyHash: newKeyHash,
        teamId: invite.teamId,
        displayName: pending.name || undefined,
        isAdmin: false,
      });

      const bound = await storage.bindLarkAccount(handle, {
        larkOpenId: pending.openId,
        larkUnionId: pending.unionId,
        larkName: pending.name,
        larkAvatarUrl: pending.avatarUrl,
        larkRefreshToken: pending.refreshToken,
        larkRefreshTokenExpiresAt: pending.refreshExpiresAt,
        larkScopes: pending.scopes,
        larkBoundAt: Date.now(),
      });
      // bindLarkAccount returns null on conflict, but we already checked
      // conflictUser above; treat any null here as an internal error
      if (!bound) {
        error(res, 500, 'bind_failed');
        return;
      }

      // Set session cookie so the user is immediately logged in via cookie
      const ua = (req.headers['user-agent'] || '').toString().slice(0, 200);
      const { token: sessionToken } = await storage.createSession(handle, undefined, ua || undefined);
      setSessionCookie(res, sessionToken);

      // Consume the pending row
      pendingLarkRegs.delete(pendingToken);

      json(res, 201, {
        handle: user.handle,
        teamId: user.teamId,
        secret_key: newKey,
        warning: 'Save this key now if you plan to use CC MCP. You can also generate a new one anytime from /settings.',
      });
      return;
    }

    // ════════════════════════════════════════════════════════
    // All endpoints below require authentication
    // ════════════════════════════════════════════════════════

    // ── Entries ──

    // GET /api/entries — List entries (team-scoped)
    if (req.method === 'GET' && url.pathname === '/api/entries') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const limit = parseInt(url.searchParams.get('limit') || '50');
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const cursor = url.searchParams.get('cursor') || undefined;
      const tagsParam = url.searchParams.get('tags');
      const author = url.searchParams.get('author');

      let entries: RouterEntry[];

      if (tagsParam) {
        const tags = tagsParam.split(',').map(t => t.trim()).filter(Boolean);
        entries = await storage.getEntriesByTags(user.teamId, tags, limit, offset);
      } else if (author) {
        entries = await storage.getEntriesByHandle(user.teamId, author, limit);
      } else {
        entries = await storage.getEntries(user.teamId, limit, offset, cursor);
      }

      // Merge user's pending entries into results (visible only to author)
      const staged = storage as any;
      if (staged.getPendingEntriesByHandle) {
        const pending: RouterEntry[] = await staged.getPendingEntriesByHandle(user.handle);
        const pendingForTeam = pending.filter((e: RouterEntry) => e.teamId === user.teamId);
        // Filter pending by current query
        let matchingPending = pendingForTeam;
        if (tagsParam) {
          const tags = tagsParam.split(',').map((t: string) => t.trim()).filter(Boolean);
          matchingPending = pendingForTeam.filter((e: RouterEntry) => tags.every((t: string) => e.tags.includes(t)));
        } else if (author) {
          matchingPending = pendingForTeam.filter((e: RouterEntry) => e.handle === author);
        }
        // Merge and dedupe
        const existingIds = new Set(entries.map(e => e.id));
        const newPending = matchingPending.filter((e: RouterEntry) => !existingIds.has(e.id));
        entries = [...newPending, ...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
      }

      // Filter hidden entries (only visible to author)
      const visible = entries.filter(e => !e.hidden || e.handle === user.handle);

      // For filtered queries, get the filtered total rather than team-wide total
      let total: number;
      if (tagsParam) {
        const tags = tagsParam.split(',').map(t => t.trim()).filter(Boolean);
        const allFiltered = await storage.getEntriesByTags(user.teamId, tags);
        total = allFiltered.filter(e => !e.hidden || e.handle === user.handle).length;
      } else {
        total = await storage.getEntryCount(user.teamId);
      }
      const nextCursor = visible.length > 0 ? encodePageCursor(visible[visible.length - 1]) : null;

      json(res, 200, { entries: await enrichEntries(visible), total, limit, offset, nextCursor });
      return;
    }

    // POST /api/entries — Create entry
    if (req.method === 'POST' && url.pathname === '/api/entries') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const body = JSON.parse(await readBody(req));
      const { summary, tags, content, role, client, model, to, in_reply_to, channel, oneliner } = body;

      if (!summary || typeof summary !== 'string' || summary.trim().length === 0) {
        error(res, 400, 'Summary is required.');
        return;
      }

      if (!tags || !Array.isArray(tags) || tags.length === 0) {
        error(res, 400, 'At least one tag is required.');
        return;
      }

      const userDelay = user.stagingDelayMs ?? STAGING_DELAY_MS;
      const entry = await storage.addEntry({
        handle: user.handle,
        teamId: user.teamId,
        client: client || 'code',
        content: (content || summary).replace(/\\n/g, '\n'),
        summary: summary.trim().replace(/\\n/g, '\n'),
        tags: tags.map((t: string) => t.toLowerCase().trim()).filter(Boolean),
        role: role || undefined,
        timestamp: Date.now(),
        model: model || undefined,
        to: to || (channel ? [`#${channel}`] : undefined),
        inReplyTo: in_reply_to || undefined,
        channel: channel || to?.find((d: string) => d.startsWith('#'))?.slice(1) || undefined,
        oneliner: typeof oneliner === 'string' ? oneliner.trim().slice(0, 50) : undefined,
        sourceApp: detectHttpClientApp(
          req.headers['user-agent'] as string | undefined,
          req.headers.origin as string | undefined,
          ['router.feedling.app', 'shaperotator.teleport.computer'],
        ),
        sourceVia: 'http-api',
      }, userDelay);

      // Tag unification: fan-out across every tag (and legacy channel) that
      // has a tag_configs row. Fire-and-forget at the API boundary.
      evaluateTagTriggers(entry, storage, markWebhookFired, {
        larkApiClient: larkApiClientForEffects,
        storage,
      }).catch((err) =>
        console.error(`[POST /api/entries] Failed to evaluate tag triggers for ${entry.id}:`, err),
      );

      if (!entry.publishAt) {
        notifyEntryMentions(entry).catch(err =>
          console.error(`[POST /api/entries] Failed to notify mentions for ${entry.id}:`, err),
        );
        maybeRunSparksForEntry(entry).catch(err =>
          console.error(`[POST /api/entries] Spark evaluation failed for ${entry.id}:`, err),
        );
        mirrorEntryToMatrix(entry, '[POST /api/entries]');
      }

      json(res, 201, { entry });
      return;
    }

    // POST /api/entries/:id/publish — Publish a pending entry immediately
    if (req.method === 'POST' && url.pathname.match(/^\/api\/entries\/[^/]+\/publish$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const entryId = url.pathname.split('/')[3];
      const staged = storage as any;

      if (!staged.isPending?.(entryId)) {
        error(res, 404, 'Entry not found or already published.');
        return;
      }

      const entry = await storage.getEntry(entryId);
      if (!entry || (entry.handle !== user.handle && !user.isAdmin)) {
        error(res, 403, 'You can only publish your own entries.');
        return;
      }

      const published = await staged.publishEntry(entryId);

      // Tag unification: fan-out triggers now that entry is published.
      evaluateTagTriggers(published, storage, markWebhookFired, {
        larkApiClient: larkApiClientForEffects,
        storage,
      }).catch((err) =>
        console.error(`[Publish] Failed to evaluate tag triggers for ${published.id}:`, err),
      );

      notifyEntryMentions(published).catch(err =>
        console.error(`[Publish] Failed to notify mentions for ${published.id}:`, err),
      );
      maybeRunSparksForEntry(published).catch(err =>
        console.error(`[Publish] Spark evaluation failed for ${published.id}:`, err),
      );
      mirrorEntryToMatrix(published, '[Publish]');

      autoTranslateEntry(published.id);

      json(res, 200, { entry: published, status: 'published' });
      return;
    }

    // GET /api/entries/:id — Entry detail
    if (req.method === 'GET' && url.pathname.match(/^\/api\/entries\/[^/]+$/) && !url.pathname.includes('/tags')) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const entryId = decodeURIComponent(url.pathname.slice('/api/entries/'.length));
      const entry = await storage.getEntry(entryId);

      if (!entry || entry.teamId !== user.teamId) {
        error(res, 404, 'Entry not found.');
        return;
      }

      const replies = await storage.getRepliesTo(entryId);
      json(res, 200, { entry: await enrichEntry(entry), replies: await enrichEntries(replies) });
      return;
    }

    // GET /api/entries/:id/reactions — Aggregated Lark reactions on bot-sent
    // cards that represent this entry. Public to anyone who can read the entry.
    if (req.method === 'GET' && url.pathname.match(/^\/api\/entries\/[^/]+\/reactions$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const entryId = decodeURIComponent(url.pathname.slice('/api/entries/'.length).replace(/\/reactions$/, ''));
      const entry = await storage.getEntry(entryId);
      if (!entry || entry.teamId !== user.teamId) {
        error(res, 404, 'Entry not found.');
        return;
      }
      const reactions = await storage.getEntryReactionSummary(entryId);
      json(res, 200, { reactions });
      return;
    }

    // GET /api/entries/:id/replies — Get replies to an entry
    if (req.method === 'GET' && url.pathname.match(/^\/api\/entries\/[^/]+\/replies$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const entryId = url.pathname.split('/')[3];
      const replies = await storage.getRepliesTo(entryId);
      json(res, 200, { replies, count: replies.length });
      return;
    }

    // GET /api/users/:handle — User profile + entries
    if (req.method === 'GET' && url.pathname.match(/^\/api\/users\/[^/]+$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const handle = decodeURIComponent(url.pathname.split('/')[3]);
      const profileUser = await storage.getUser(handle);

      if (!profileUser || profileUser.teamId !== user.teamId) {
        error(res, 404, 'User not found.');
        return;
      }

      const entries = await storage.getEntriesByHandle(user.teamId, handle, 50);

      json(res, 200, {
        user: {
          handle: profileUser.handle,
          displayName: profileUser.displayName,
          bio: profileUser.bio,
          role: profileUser.role,
          isAdmin: profileUser.isAdmin,
          createdAt: profileUser.createdAt,
          larkBinding: profileUser.larkOpenId ? {
            name: profileUser.larkName,
            avatarUrl: profileUser.larkAvatarUrl,
          } : undefined,
        },
        entries,
        entryCount: entries.length,
      });
      return;
    }

    // GET / PUT /api/users/me/notification-prefs — Lark IM notification preferences
    if (url.pathname === '/api/users/me/notification-prefs') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (req.method === 'GET') {
        json(res, 200, {
          mention: user.larkNotificationPrefs?.mention ?? true,
          comment: user.larkNotificationPrefs?.comment ?? true,
          reply: user.larkNotificationPrefs?.reply ?? true,
          digest: user.larkNotificationPrefs?.digest ?? true,
          larkBound: !!user.larkOpenId,
        });
        return;
      }
      if (req.method === 'PUT') {
        let body: any = {};
        try { body = JSON.parse(await readBody(req)); } catch { error(res, 400, 'invalid_json'); return; }
        const next: import('./storage.js').LarkNotificationPrefs = {};
        for (const k of ['mention', 'comment', 'reply', 'digest'] as const) {
          if (k in body) {
            if (typeof body[k] !== 'boolean') { error(res, 400, `${k}_must_be_boolean`); return; }
            next[k] = body[k];
          }
        }
        await storage.updateUser(user.handle, {
          larkNotificationPrefs: { ...(user.larkNotificationPrefs ?? {}), ...next },
        });
        const updated = await storage.getUser(user.handle);
        json(res, 200, {
          mention: updated?.larkNotificationPrefs?.mention ?? true,
          comment: updated?.larkNotificationPrefs?.comment ?? true,
          reply: updated?.larkNotificationPrefs?.reply ?? true,
          digest: updated?.larkNotificationPrefs?.digest ?? true,
          larkBound: !!updated?.larkOpenId,
        });
        return;
      }
    }

    // GET / PATCH /api/users/me/preferences — CLI v1 sync/preview/privacy preferences
    if (url.pathname === '/api/users/me/preferences') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (req.method === 'GET') {
        json(res, 200, userToPreferences(user));
        return;
      }
      if (req.method === 'PATCH') {
        let body: any = {};
        try { body = JSON.parse(await readBody(req)); } catch { /* empty body */ }
        const v = validatePreferencesPatch(body);
        if (!v.ok) { error(res, 400, v.error); return; }
        await applyPreferencesPatch(storage, user.handle, v.value);
        const updated = await storage.getUser(user.handle);
        json(res, 200, userToPreferences(updated!));
        return;
      }
    }

    // GET /api/skill-template (CLI v1) — public, no auth (skill is public content)
    if (req.method === 'GET' && url.pathname === '/api/skill-template') {
      const { buildSkillTemplate } = await import('./cli-skill-template.js');
      json(res, 200, buildSkillTemplate({ publicUrl: PERSONAL_WEBHOOK_PUBLIC_URL }));
      return;
    }

    // GET /api/context — CLI v1 onboarding context (5min cache + channel filtering)
    if (req.method === 'GET' && url.pathname === '/api/context') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const ctx = await buildContext(storage, user);
      json(res, 200, ctx);
      return;
    }

    // GET /api/brief — Concierge module A: per-user "since you were gone" recap
    // GET /api/concierge/recap — alias used by MCP tool / future UI; same behavior
    if (req.method === 'GET' && (url.pathname === '/api/brief' || url.pathname === '/api/concierge/recap')) {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (user.conciergeRecapEnabled === false) {
        // User has opted out — return empty recap but don't 403, callers expect
        // a normal response shape so they can render "recap disabled" UX.
        json(res, 200, {
          enabled: false,
          since: 0, now: Date.now(), totalItems: 0,
          groups: { mentioned: [], replied: [], subscribed_channels: [], milestones: [], related_topics: [] },
        });
        return;
      }
      const recap = await computeUserRecap(
        storage,
        { handle: user.handle, teamId: user.teamId, lastConciergeSeenAt: user.lastConciergeSeenAt },
        { publicUrl: PERSONAL_WEBHOOK_PUBLIC_URL },
      );
      // Read-only: lastConciergeSeenAt is updated only by the daily cron
      // (spec §5.4). Manual calls preview the next morning's brief.
      json(res, 200, { enabled: true, ...recap });
      return;
    }

    // GET / PUT /api/users/me/concierge-prefs — toggle recap on/off
    if (url.pathname === '/api/users/me/concierge-prefs') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (req.method === 'GET') {
        json(res, 200, { enabled: user.conciergeRecapEnabled !== false });
        return;
      }
      if (req.method === 'PUT') {
        let body: any = {};
        try { body = JSON.parse(await readBody(req)); } catch { error(res, 400, 'invalid_json'); return; }
        if (typeof body?.enabled !== 'boolean') { error(res, 400, 'enabled_must_be_boolean'); return; }
        await storage.updateUser(user.handle, { conciergeRecapEnabled: body.enabled });
        json(res, 200, { enabled: body.enabled });
        return;
      }
    }

    // POST /api/admin/concierge/run-now — admin-only; manually triggers the
    // weekly Lark push without waiting for the Monday 10am cron. Useful for
    // verifying the wiring after deploys.
    //
    // Add `?dryRun=1` to compute targeting + return outcome stats WITHOUT
    // any side effects (no LLM, no inbox notifications, no Lark push, no
    // lastConciergeSeenAt update). Lets admins repeat-poke without
    // double-pushing real users.
    if (req.method === 'POST' && url.pathname === '/api/admin/concierge/run-now') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (!user.isAdmin) {
        error(res, 403, 'admin_only');
        return;
      }
      if (!larkApiClientForEffects) {
        error(res, 503, 'lark_not_configured');
        return;
      }
      const dryRun = url.searchParams.get('dryRun') === '1';
      try {
        const stats = await runConciergeForAllUsers({
          storage,
          apiClient: larkApiClientForEffects,
          publicUrl: PERSONAL_WEBHOOK_PUBLIC_URL,
          // LLM is optional — if OPENROUTER_API_KEY isn't set, callLLM will throw on first
          // use and the cron gracefully falls back to structured channel-list rendering.
          // Dry-run skips LLM internally regardless of this flag (saves cost previewing).
          callLLM: process.env.OPENROUTER_API_KEY ? callLLM : undefined,
          dryRun,
        });
        json(res, 200, {
          ok: true,
          dryRun,
          stats,
          note: dryRun
            ? 'Dry run — no notifications written, no Lark push, no lastConciergeSeenAt update. Remove dryRun=1 to actually fire.'
            : 'Real run — notifications written, Lark push fired (where prefs allow), lastSeen updated.',
        });
      } catch (e: any) {
        error(res, 500, `cron_run_failed: ${e?.message ?? e}`);
      }
      return;
    }

    // GET /api/memory — Team Memory (static markdown, used as CC system context)
    // When the team hasn't configured Memory yet we return empty content
    // (front-end shows a placeholder) plus the example markdown separately
    // so the UI can offer a "show example / starter template" panel without
    // pre-filling the editor.
    if (req.method === 'GET' && url.pathname === '/api/memory') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const memory = await storage.getTeamMemory(user.teamId);
      const content = memory?.content ?? '';
      const teamUsers = await storage.getAllUsers(user.teamId);
      const adminHandles = teamUsers.filter(u => u.isAdmin).map(u => u.handle);
      json(res, 200, {
        content,
        example: TEAM_MEMORY_EXAMPLE,
        updatedAt: memory?.updatedAt ?? 0,
        updatedByHandle: memory?.updatedByHandle ?? null,
        canEdit: !!user.isAdmin,
        isTemplateOnly: isTemplateOnly(content),
        hasPrevious: !!(memory?.previousContent),
        charCount: content.length,
        charLimit: TEAM_MEMORY_CHAR_LIMIT,
        adminHandles,
      });
      return;
    }

    // PUT /api/memory — admin only; saves new content, snapshots prior as previousContent
    if (req.method === 'PUT' && url.pathname === '/api/memory') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (!user.isAdmin) { error(res, 403, 'admin_only'); return; }
      let body: any = {};
      try { body = JSON.parse(await readBody(req)); } catch { error(res, 400, 'invalid_json'); return; }
      const content = typeof body?.content === 'string' ? body.content : '';
      if (content.length > TEAM_MEMORY_CHAR_LIMIT) {
        error(res, 400, `over_char_limit (${content.length} > ${TEAM_MEMORY_CHAR_LIMIT})`);
        return;
      }
      const memory = await storage.upsertTeamMemory(user.teamId, content, user.handle);
      const teamUsersAfterPut = await storage.getAllUsers(user.teamId);
      json(res, 200, {
        content: memory.content,
        updatedAt: memory.updatedAt,
        updatedByHandle: memory.updatedByHandle,
        canEdit: true,
        isTemplateOnly: isTemplateOnly(memory.content),
        hasPrevious: memory.previousContent !== null,
        charCount: memory.content.length,
        charLimit: TEAM_MEMORY_CHAR_LIMIT,
        adminHandles: teamUsersAfterPut.filter(u => u.isAdmin).map(u => u.handle),
      });
      return;
    }

    // GET /api/memory/sections — list section headings + 1-line summary
    // (cheap index for CLI / scripts. The MCP equivalent was removed —
    // CC now sees full Memory content directly in its system prompt.)
    if (req.method === 'GET' && url.pathname === '/api/memory/sections') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const memory = await storage.getTeamMemory(user.teamId);
      const content = memory?.content ?? '';
      if (!content || isTemplateOnly(content)) {
        json(res, 200, { sections: [], isTemplateOnly: true });
        return;
      }
      const sections = parseMemorySections(content).map(s => ({ name: s.name, summary: s.summary }));
      json(res, 200, { sections, isTemplateOnly: false });
      return;
    }

    // GET /api/memory/sections/:name — one section's full body
    {
      const m = url.pathname.match(/^\/api\/memory\/sections\/([^/]+)$/);
      if (req.method === 'GET' && m) {
        const user = await requireAuth(req, url, res);
        if (!user) return;
        const memory = await storage.getTeamMemory(user.teamId);
        const content = memory?.content ?? '';
        if (!content || isTemplateOnly(content)) {
          error(res, 404, 'memory_not_configured');
          return;
        }
        const section = findMemorySection(content, decodeURIComponent(m[1]));
        if (!section) {
          const available = parseMemorySections(content).map(s => s.name);
          json(res, 404, { error: 'section_not_found', available });
          return;
        }
        json(res, 200, { name: section.name, body: section.body, summary: section.summary });
        return;
      }
    }

    // POST /api/memory/rollback — admin only; swap content with previousContent
    if (req.method === 'POST' && url.pathname === '/api/memory/rollback') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (!user.isAdmin) { error(res, 403, 'admin_only'); return; }
      const memory = await storage.rollbackTeamMemory(user.teamId, user.handle);
      if (!memory) { error(res, 400, 'no_previous_version'); return; }
      const teamUsersAfterRollback = await storage.getAllUsers(user.teamId);
      json(res, 200, {
        content: memory.content,
        updatedAt: memory.updatedAt,
        updatedByHandle: memory.updatedByHandle,
        canEdit: true,
        isTemplateOnly: isTemplateOnly(memory.content),
        hasPrevious: memory.previousContent !== null,
        charCount: memory.content.length,
        charLimit: TEAM_MEMORY_CHAR_LIMIT,
        adminHandles: teamUsersAfterRollback.filter(u => u.isAdmin).map(u => u.handle),
      });
      return;
    }

    // POST /api/cli/generate-key — issue a fresh secret key for CLI use (browser-assisted login)
    if (req.method === 'POST' && url.pathname === '/api/cli/generate-key') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const newKey = await storage.generateAdditionalKeyForUser(user.handle);
      json(res, 200, { key: newKey });
      return;
    }

    // PATCH /api/users/me — Update own profile
    if (req.method === 'PATCH' && url.pathname === '/api/users/me') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const body = JSON.parse(await readBody(req));
      const { displayName, bio, email, role, stagingDelayMs, notificationWebhook, lang } = body;

      const updates: Record<string, any> = {};
      if (displayName !== undefined) updates.displayName = displayName;
      if (bio !== undefined) updates.bio = bio;
      if (email !== undefined) updates.email = email;
      if (role !== undefined) updates.role = role;
      if (stagingDelayMs !== undefined) updates.stagingDelayMs = stagingDelayMs;
      if (notificationWebhook !== undefined) {
        const trimmed = String(notificationWebhook).trim();
        if (trimmed && !/^https?:\/\//i.test(trimmed)) {
          error(res, 400, 'notificationWebhook must be an http(s) URL.');
          return;
        }
        // Pass null (not undefined) to clear — PostgresStorage skips fields
        // with `!== undefined`, so undefined would silently no-op the save.
        updates.notificationWebhook = trimmed || null;
      }
      if (lang !== undefined) {
        if (lang !== 'en' && lang !== 'zh' && lang !== null) {
          error(res, 400, 'lang must be "en" or "zh".');
          return;
        }
        updates.lang = lang || undefined;
      }

      const updated = await storage.updateUser(user.handle, updates);
      json(res, 200, { user: updated });
      return;
    }

    // GET /api/admin/usage-stats — observability for MCP-vs-CLI deprecation
    // decision. Admin-only. Reports: live MCP session count, per-client entry
    // counts (7d / 30d), unique-users-by-client (30d).
    if (req.method === 'GET' && url.pathname === '/api/admin/usage-stats') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (!user.isAdmin) { error(res, 403, 'Admin only.'); return; }

      const dbStats = baseStorage instanceof PostgresStorage
        ? await baseStorage.getUsageStats()
        : { by_client_30d: [], by_client_7d: [], unique_users_30d: [] };

      json(res, 200, {
        mcp_sessions_now: mcpSessions.size,
        ...dbStats,
        note: baseStorage instanceof PostgresStorage
          ? undefined
          : 'DB-backed stats unavailable (non-Postgres storage backend).',
      });
      return;
    }

    // POST /api/admin/retranslate — admin-only: re-run auto-translate for recent
    // entries. Useful after lowering the language-detection threshold to backfill
    // entries that were misclassified as English (bilingual heavy on Chinese
    // narrative + English technical terms).
    //
    // Query params:
    //   days=N        — re-check entries from the last N days (default 30)
    //   id=<entryId>  — retranslate a single entry by ID
    //   dryRun=1      — only report what WOULD be translated, don't call LLM
    if (req.method === 'POST' && url.pathname === '/api/admin/retranslate') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (!user.isAdmin) { error(res, 403, 'Admin only.'); return; }

      const singleId = url.searchParams.get('id');
      const dryRun = url.searchParams.get('dryRun') === '1';
      const days = Math.max(1, parseInt(url.searchParams.get('days') || '30', 10));
      const since = Date.now() - days * 24 * 60 * 60 * 1000;

      let candidates: RouterEntry[] = [];
      if (singleId) {
        const one = await storage.getEntry(singleId);
        if (one) candidates = [one];
      } else {
        // Iterate user's team for now (admin's team scope). Server-wide audit
        // is a larger-scope tool; this is the common path.
        candidates = await storage.getEntriesSince(user.teamId, since, 500);
      }

      const eligible: { id: string; reason: string }[] = [];
      const skipped: { id: string; reason: string }[] = [];
      for (const e of candidates) {
        const sample = (e.summary || '') + ' ' + (e.oneliner || '');
        const sourceLang = detectSourceLangFromSample(sample);
        const targetLang: 'en' | 'zh' = sourceLang === 'zh' ? 'en' : 'zh';
        if (e.translations?.[targetLang]) { skipped.push({ id: e.id, reason: `already has ${targetLang} translation` }); continue; }
        eligible.push({ id: e.id, reason: `queued ${sourceLang}→${targetLang}` });
      }

      if (!dryRun) {
        // Fire-and-forget — autoTranslateEntry already has internal guards
        // (lang detect + already-translated check), so it's safe to invoke
        // even though we just pre-filtered.
        for (const e of eligible) autoTranslateEntry(e.id);
      }

      json(res, 200, {
        dryRun,
        days,
        candidates_scanned: candidates.length,
        eligible_count: eligible.length,
        eligible,
        skipped_count: skipped.length,
        skipped: skipped.slice(0, 20),
        note: dryRun
          ? 'Dry run — no translations queued. Remove dryRun=1 to actually retranslate.'
          : 'Translations queued (fire-and-forget). Re-check entry in 30-60s.',
      });
      return;
    }

    // DELETE /api/users/:handle — Delete a team member (admin only).
    // Removes the user record. Does NOT delete their entries — those stay on
    // the dashboard with handle intact. Also cleans up channel subscriptions.
    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/users\/[^/]+$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (!user.isAdmin) { error(res, 403, 'Only team admins can delete users.'); return; }

      const targetHandle = decodeURIComponent(url.pathname.split('/').pop() || '');
      if (!targetHandle) { error(res, 400, 'Handle is required.'); return; }
      if (targetHandle === user.handle) { error(res, 400, 'Cannot delete yourself.'); return; }

      const target = await storage.getUser(targetHandle);
      if (!target || target.teamId !== user.teamId) {
        error(res, 404, `User @${targetHandle} not found in your team.`);
        return;
      }

      // Remove from all channel subscriber lists
      const channels = await storage.listChannels(user.teamId);
      for (const ch of channels) {
        if (ch.subscribers.some(s => s.handle === targetHandle)) {
          await storage.updateChannel(ch.id, {
            subscribers: ch.subscribers.filter(s => s.handle !== targetHandle),
          });
        }
      }

      // Delete user record (entries stay)
      await storage.deleteUser(targetHandle);
      json(res, 200, { deleted: targetHandle });
      return;
    }

    // PATCH /api/users/:handle/admin — Promote or demote a team member.
    // Admin-only. Refuses to demote the last remaining admin so the team is
    // never left without one.
    if (req.method === 'PATCH' && url.pathname.match(/^\/api\/users\/[^/]+\/admin$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (!user.isAdmin) { error(res, 403, 'Only team admins can change admin status.'); return; }

      const parts = url.pathname.split('/');
      const targetHandle = decodeURIComponent(parts[3]);
      if (!targetHandle) { error(res, 400, 'Handle is required.'); return; }

      const body = JSON.parse(await readBody(req).catch(() => '{}'));
      if (typeof body.isAdmin !== 'boolean') {
        error(res, 400, 'Body must include { isAdmin: boolean }.');
        return;
      }

      const target = await storage.getUser(targetHandle);
      if (!target || target.teamId !== user.teamId) {
        error(res, 404, `User @${targetHandle} not found in your team.`);
        return;
      }

      // Last-admin guard: refuse to demote if this would leave zero admins
      // in the team. Covers both "admin demotes themselves" and "admin
      // demotes the one other admin" when there are only two.
      if (target.isAdmin && body.isAdmin === false) {
        const allUsers = await storage.getAllUsers(user.teamId);
        const adminCount = allUsers.filter(u => u.isAdmin).length;
        if (adminCount <= 1) {
          error(res, 400, 'Cannot demote the last remaining admin. Promote someone else first.');
          return;
        }
      }

      const updated = await storage.updateUser(targetHandle, { isAdmin: body.isAdmin });

      // Let the target know their admin status changed. Only notify if this
      // is an actual change (no-op PATCH shouldn't spam).
      if (target.isAdmin !== body.isAdmin) {
        const notifType = body.isAdmin ? 'admin_granted' : 'admin_revoked';
        const preview = body.isAdmin
          ? `@${user.handle} made you a team admin.`
          : `@${user.handle} revoked your admin access.`;

        await storage.addNotification({
          id: `n-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
          recipientHandle: targetHandle,
          teamId: user.teamId,
          type: notifType,
          fromHandle: user.handle,
          preview,
          read: false,
          timestamp: Date.now(),
        });

        // Fire-and-forget personal webhook if the target has one configured.
        if (target.notificationWebhook) {
          sendPersonalWebhook(target.notificationWebhook, {
            type: 'other',
            fromHandle: user.handle,
            recipient: targetHandle,
            preview,
            lang: target.lang,
          }).catch(() => {});
        }
      }

      json(res, 200, { handle: targetHandle, isAdmin: !!updated?.isAdmin });
      return;
    }

    // POST /api/feedback — Submit user feedback (lazy-creates a team-scoped #feedback channel
    // and writes the feedback as a normal Router entry, so all the existing dashboard,
    // tagging, comment, and webhook-skill machinery applies for free).
    if (req.method === 'POST' && url.pathname === '/api/feedback') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const body = JSON.parse(await readBody(req));
      const { content, category, page } = body as {
        content?: string;
        category?: string;
        page?: string;
      };

      if (!content || typeof content !== 'string' || !content.trim()) {
        error(res, 400, 'Feedback content is required.');
        return;
      }
      const trimmed = content.trim();
      if (trimmed.length > 4000) {
        error(res, 400, 'Feedback too long (max 4000 chars).');
        return;
      }

      // Lazy-create the per-team #feedback channel if it doesn't exist.
      // Channel ID is "feedback" but we scope by teamId in storage so each team has its own.
      let feedbackChannel = await storage.getChannel('feedback');
      if (!feedbackChannel || feedbackChannel.teamId !== user.teamId) {
        // Either no #feedback at all, or it belongs to another team — try to find one.
        // If multi-team support requires unique IDs across teams, fall back to a per-team id.
        feedbackChannel = null;
      }
      if (!feedbackChannel) {
        try {
          feedbackChannel = await storage.createChannel({
            id: 'feedback',
            teamId: user.teamId,
            name: 'Feedback',
            description: 'Product feedback collected from the in-app form.',
            joinRule: 'open',
            createdBy: user.handle,
            createdAt: Date.now(),
            skills: [],
            subscribers: [{ handle: user.handle, role: 'admin', joinedAt: Date.now() }],
          });
        } catch (err) {
          // Race or already exists under a different team — best effort, just write the entry without channel.
          console.error('[feedback] failed to create channel:', err);
        }
      }

      // Put the specific tags first (category, originating page) and the
      // generic "feedback" last, so the most informative tag is shown first
      // in the card and the catch-all marker sits at the end.
      const tags: string[] = [];
      if (category && typeof category === 'string') {
        const cat = category.toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (cat) tags.push(`feedback:${cat}`);
      }
      if (page && typeof page === 'string') {
        const p = page.toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (p) tags.push(`page:${p}`);
      }
      tags.push('feedback');

      const summaryFirstLine = trimmed.split('\n')[0].slice(0, 200);
      const userDelay = user.stagingDelayMs ?? STAGING_DELAY_MS;
      const entry = await storage.addEntry({
        handle: user.handle,
        teamId: user.teamId,
        client: 'desktop',
        content: trimmed,
        summary: summaryFirstLine,
        tags,
        timestamp: Date.now(),
        channel: feedbackChannel ? 'feedback' : undefined,
        to: feedbackChannel ? ['#feedback'] : undefined,
        // Feedback float widget always lives in our web; record as `web`.
        sourceApp: 'web',
        sourceVia: 'http-api',
      }, userDelay);

      // Fire any webhook skills that the team has configured on #feedback
      // (e.g. push to a Lark Bitable for spreadsheet view).
      if (feedbackChannel) {
        evaluateChannelTriggers(entry, feedbackChannel, markWebhookFired, { larkApiClient: larkApiClientForEffects, storage }).catch(() => {});
      }

      json(res, 201, { entry, channelCreated: !!feedbackChannel });
      return;
    }

    // DELETE /api/entries/:id
    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/entries\/[^/]+$/) && !url.pathname.includes('/tags') && !url.pathname.includes('/replies')) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const entryId = decodeURIComponent(url.pathname.slice('/api/entries/'.length));
      const entry = await storage.getEntry(entryId);

      if (!entry) {
        error(res, 404, 'Entry not found.');
        return;
      }

      if (entry.handle !== user.handle && !user.isAdmin) {
        error(res, 403, 'You can only delete your own entries.');
        return;
      }

      await storage.deleteEntry(entryId);
      json(res, 200, { deleted: entryId });
      return;
    }

    // PATCH /api/entries/:id/tags — Edit tags
    if (req.method === 'PATCH' && url.pathname.match(/^\/api\/entries\/[^/]+\/tags$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const entryId = url.pathname.split('/')[3];
      const entry = await storage.getEntry(entryId);

      if (!entry) {
        error(res, 404, 'Entry not found.');
        return;
      }

      if (entry.teamId !== user.teamId) {
        error(res, 403, 'Entry belongs to another team.');
        return;
      }

      const body = JSON.parse(await readBody(req));
      const { tags } = body;

      if (!tags || !Array.isArray(tags)) {
        error(res, 400, 'Tags array is required.');
        return;
      }

      const updated = await storage.updateEntryTags(
        entryId,
        tags.map((t: string) => t.toLowerCase().trim()).filter(Boolean)
      );

      json(res, 200, { entry: updated });
      return;
    }

    // PATCH /api/entries/:id — Edit entry (owner only)
    if (req.method === 'PATCH' && url.pathname.match(/^\/api\/entries\/[^/]+$/) && !url.pathname.includes('/tags') && !url.pathname.includes('/comments')) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const entryId = url.pathname.split('/')[3];
      const entry = await storage.getEntry(entryId);

      if (!entry || entry.teamId !== user.teamId) {
        error(res, 404, 'Entry not found.');
        return;
      }
      if (entry.handle !== user.handle && !user.isAdmin) {
        error(res, 403, 'You can only edit your own entries.');
        return;
      }

      const body = JSON.parse(await readBody(req));
      const updates: Record<string, any> = {};
      if (body.summary !== undefined) updates.summary = body.summary;
      if (body.content !== undefined) updates.content = body.content;
      if (body.tags !== undefined) updates.tags = body.tags.map((t: string) => t.toLowerCase().trim()).filter(Boolean);
      if (body.role !== undefined) updates.role = body.role;
      if (body.hidden !== undefined) updates.hidden = body.hidden;
      // Channel edit: null / empty string means "remove from channel".
      // Also rewrite the `to` array to keep #channel addressing in sync.
      if (body.channel !== undefined) {
        const newChannel = body.channel ? String(body.channel).toLowerCase().trim().replace(/^#/, '') : null;
        updates.channel = newChannel;
        // Strip old #channel tokens from `to`, then add the new one (if any)
        const existingTo = (entry.to || []).filter(t => !t.startsWith('#'));
        updates.to = newChannel ? [...existingTo, `#${newChannel}`] : existingTo;
      }

      // Clear cached translations when the entry's content changes — they're
      // based on the old text. A fresh translation is fired asynchronously
      // below so en readers see the updated copy without clicking.
      const contentChanged = updates.summary !== undefined
        || updates.content !== undefined
        || updates.oneliner !== undefined;
      if (contentChanged) {
        updates.translations = null;
      }

      const updated = await storage.updateEntry(entryId, updates);

      if (contentChanged && updated) {
        autoTranslateEntry(updated.id);
      }

      json(res, 200, { entry: updated });
      return;
    }

    // POST /api/entries/:id/translate — On-demand translation via Gemini
    if (req.method === 'POST' && url.pathname.match(/^\/api\/entries\/[^/]+\/translate$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const entryId = url.pathname.split('/')[3];
      const entry = await storage.getEntry(entryId);
      if (!entry || entry.teamId !== user.teamId) {
        error(res, 404, 'Entry not found.');
        return;
      }

      // Auto-detect source language and pick target: Chinese ↔ English.
      const sample = (entry.summary + ' ' + (entry.oneliner || '')).slice(0, 200);
      const chineseCharCount = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
      const sourceLang = chineseCharCount > sample.length * 0.15 ? 'zh' : 'en';
      const targetLang = sourceLang === 'zh' ? 'en' : 'zh';

      // Return cached translation if available.
      if (entry.translations?.[targetLang]) {
        json(res, 200, {
          translation: entry.translations[targetLang],
          targetLang,
          sourceLang,
          cached: true,
        });
        return;
      }

      if (!process.env.OPENROUTER_API_KEY) {
        error(res, 503, 'Translation service not configured (missing OPENROUTER_API_KEY).');
        return;
      }

      const targetLabel = targetLang === 'zh' ? 'Chinese (Simplified)' : 'English';
      const prompt = `Translate the following into ${targetLabel}. Keep technical terms (Channel, Skill, Webhook, MCP, Tag, Entry, Router, handle, etc.) in their original form. Preserve markdown formatting. Return ONLY the translation, nothing else.

---
SUMMARY (plain text):
${entry.summary}

${entry.content ? `CONTENT (markdown):\n${entry.content}` : ''}

${entry.oneliner ? `ONELINER (headline):\n${entry.oneliner}` : ''}
---

Return your response in this exact format (preserve the labels):
SUMMARY: <translated summary>
${entry.content ? 'CONTENT: <translated content>' : ''}
${entry.oneliner ? 'ONELINER: <translated oneliner>' : ''}`;

      try {
        const raw = await callLLM(prompt, { temperature: 0.2 });

        // Parse structured response.
        const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]*?)(?=\n(?:CONTENT|ONELINER):|$)/i);
        const contentMatch = raw.match(/CONTENT:\s*([\s\S]*?)(?=\nONELINER:|$)/i);
        const onelinerMatch = raw.match(/ONELINER:\s*(.*)/i);

        // If the LLM didn't emit a SUMMARY: label, refuse to cache. Falling
        // back to the entire raw response stuffs the whole markdown body
        // into the summary field, which then renders as a wall of pre-wrap
        // plain text — see also `translateEntry`.
        const summary = summaryMatch?.[1]?.trim();
        if (!summary) {
          console.warn(`[translate] LLM response missing SUMMARY: label; not caching (entry=${entryId}, lang=${targetLang}, raw=${raw.slice(0, 80)}…)`);
          error(res, 502, 'Translation produced an unexpected format. Try again.');
          return;
        }
        const translation = {
          summary,
          content: contentMatch?.[1]?.trim() || undefined,
          oneliner: onelinerMatch?.[1]?.trim() || undefined,
        };

        // Cache the translation on the entry.
        const existingTranslations = entry.translations || {};
        existingTranslations[targetLang] = translation;
        await storage.updateEntry(entryId, { translations: existingTranslations });

        json(res, 200, {
          translation,
          targetLang,
          sourceLang,
          cached: false,
        });
      } catch (err) {
        console.error('[translate] failed:', err);
        error(res, 500, 'Translation failed.');
      }
      return;
    }

    // POST /api/entries/:id/comments/:commentId/translate — On-demand comment translation
    if (req.method === 'POST' && url.pathname.match(/^\/api\/entries\/[^/]+\/comments\/[^/]+\/translate$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const parts = url.pathname.split('/');
      const entryId = parts[3];
      const commentId = parts[5];

      const entry = await storage.getEntry(entryId);
      if (!entry || entry.teamId !== user.teamId) {
        error(res, 404, 'Entry not found.');
        return;
      }

      const comment = entry.comments?.find(c => c.id === commentId);
      if (!comment) {
        error(res, 404, 'Comment not found.');
        return;
      }

      const sample = comment.content.slice(0, 200);
      const chineseCharCount = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
      const sourceLang = chineseCharCount > sample.length * 0.15 ? 'zh' : 'en';
      const targetLang = sourceLang === 'zh' ? 'en' : 'zh';

      if (comment.translations?.[targetLang]) {
        json(res, 200, {
          translation: comment.translations[targetLang],
          targetLang,
          sourceLang,
          cached: true,
        });
        return;
      }

      if (!process.env.OPENROUTER_API_KEY) {
        error(res, 503, 'Translation service not configured (missing OPENROUTER_API_KEY).');
        return;
      }

      const targetLabel = targetLang === 'zh' ? 'Chinese (Simplified)' : 'English';
      const prompt = `Translate the following comment into ${targetLabel}. Keep technical terms (Channel, Skill, Webhook, MCP, Tag, Entry, Router, handle, etc.) in their original form. Preserve markdown formatting. Return ONLY the translation, nothing else.

---
${comment.content}`;

      try {
        const translated = (await callLLM(prompt, { temperature: 0.2 })).trim();
        const existing = comment.translations || {};
        existing[targetLang] = translated;
        await storage.updateComment(entryId, commentId, { translations: existing });

        json(res, 200, {
          translation: translated,
          targetLang,
          sourceLang,
          cached: false,
        });
      } catch (err) {
        console.error('[translate-comment] failed:', err);
        error(res, 500, 'Translation failed.');
      }
      return;
    }

    // POST /api/channels/:id/digest — Generate a digest (weekly/monthly summary) for a channel.
    // Can be triggered manually via this endpoint or automatically by the cron runner.
    if (req.method === 'POST' && url.pathname.match(/^\/api\/channels\/[^/]+\/digest$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const channelId = url.pathname.split('/')[3];
      const channel = await storage.getChannel(channelId);
      if (!channel || channel.teamId !== user.teamId) {
        error(res, 404, 'Channel not found.');
        return;
      }

      if (!process.env.OPENROUTER_API_KEY) {
        error(res, 503, 'Digest service not configured (missing OPENROUTER_API_KEY).');
        return;
      }

      // Find the digest skill for this channel, or use query params as override
      const body = req.method === 'POST' ? JSON.parse(await readBody(req).catch(() => '{}')) : {};
      const digestSkill = channel.skills.find(s => s.exposeAs === 'digest');
      const schedule = body.schedule || digestSkill?.digestConfig?.schedule || 'weekly';
      const lookbackDays = body.lookbackDays || digestSkill?.digestConfig?.lookbackDays || (schedule === 'monthly' ? 30 : 7);
      const postToChannel = body.postToChannel ?? digestSkill?.digestConfig?.postToChannel ?? true;
      const webhookUrl = body.webhookUrl || digestSkill?.digestConfig?.webhookUrl;
      const customInstructions = digestSkill?.instructions || '';

      // Fetch entries from the lookback window
      const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
      const allEntries = await storage.getChannelEntries(user.teamId, channelId, 200);
      const windowEntries = allEntries.filter(e => e.timestamp >= since);
      const entries = excludeAutoDigest(windowEntries);

      if (entries.length === 0) {
        json(res, 200, { digest: null, message: `No entries in #${channelId} in the past ${lookbackDays} days.` });
        return;
      }

      // Build the prompt
      const periodLabel = schedule === 'monthly' ? 'Monthly' : 'Weekly';
      const entrySummaries = entries.map(e => {
        const date = new Date(e.timestamp).toLocaleDateString();
        return `[@${e.handle} · ${date}] ${e.summary}\nTags: ${e.tags.map(t => '#' + t).join(' ')}`;
      }).join('\n\n');

      const defaultTemplate = `You are generating a ${periodLabel} Digest for the #${channelId} channel.

Below are ${entries.length} entries from the past ${lookbackDays} days. Organize them into a clear, scannable digest:

## ${periodLabel} Digest — #${channelId}

### By Author
Group entries by author. For each person: their name, how many entries, and 1-2 sentence highlights.

### Key Decisions
Pull out entries that describe decisions, architecture choices, or direction changes.

### Open Items
Flag anything tagged #blocker, #urgent, or #review-needed.

### Summary
End with a 2-3 sentence overview of the channel's focus this period.

Write in the same language as the majority of the entries.`;

      const prompt = `${customInstructions || defaultTemplate}

---
ENTRIES (${entries.length} total, past ${lookbackDays} days):

${entrySummaries}`;

      try {
        const digestContent = await callLLM(prompt, { temperature: 0.3, maxTokens: 4096 });

        const result: { entryId?: string; webhookSent?: boolean; content: string } = { content: digestContent };

        // See startDigestCron for rationale — promote the LLM's `### Summary`
        // section to the entry's summary field.
        const summaryFallback = `${periodLabel} digest for #${channelId} — ${entries.length} entries over ${lookbackDays} days.`;
        const realSummary = extractDigestSummary(digestContent, summaryFallback);

        // Post as entry to the channel — always authored by the system bot
        // (not the triggering user) so cron-generated and manually-triggered
        // digests look identical in the feed.
        if (postToChannel) {
          const digestEntry = await storage.addEntry({
            handle: 'router-bot',
            teamId: user.teamId,
            client: 'code',
            content: digestContent,
            summary: `${BOT_DIGEST_SUMMARY_PREFIX}${realSummary}`,
            tags: [AUTO_DIGEST_TAG, schedule],
            timestamp: Date.now(),
            channel: channelId,
            to: [`#${channelId}`],
            oneliner: `${periodLabel} digest #${channelId}`,
            ...INTERNAL_SOURCE,
          }, 0); // No staging delay for digests
          result.entryId = digestEntry.id;

          // Trigger channel webhooks (so if there's a Lark webhook skill, it fires)
          evaluateChannelTriggers(digestEntry, channel, markWebhookFired, { larkApiClient: larkApiClientForEffects, storage }).catch(() => {});
        }

        // Also push directly to a digest-specific webhook if configured
        if (webhookUrl) {
          try {
            const isLark = isLarkWebhook(webhookUrl);
            const webhookBody = isLark ? {
              msg_type: 'interactive',
              card: {
                header: {
                  title: { tag: 'plain_text', content: `${periodLabel} Digest — #${channelId}` },
                  template: 'purple',
                },
                elements: [
                  { tag: 'markdown', content: digestContent.slice(0, 2000) },
                  ...(result.entryId ? [{ tag: 'markdown', content: `[View full digest →](${PERSONAL_WEBHOOK_PUBLIC_URL}/entry?id=${result.entryId})` }] : []),
                ],
              },
            } : { type: 'digest', channel: channelId, schedule, content: digestContent, entryId: result.entryId };

            await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(webhookBody),
            });
            result.webhookSent = true;
          } catch (err) {
            console.error(`[digest] webhook push failed:`, err);
            result.webhookSent = false;
          }
        }

        // Update lastRunAt on the skill
        if (digestSkill?.digestConfig) {
          digestSkill.digestConfig.lastRunAt = Date.now();
          await storage.updateChannel(channelId, { skills: channel.skills });
        }

        json(res, 200, { digest: result });
      } catch (err: any) {
        console.error('[digest] LLM failed:', err?.message || err);
        error(res, 500, `Digest generation failed: ${err?.message || 'unknown error'}`);
      }
      return;
    }

    // POST /api/entries/:id/comments — Add comment
    if (req.method === 'POST' && url.pathname.match(/^\/api\/entries\/[^/]+\/comments$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const entryId = url.pathname.split('/')[3];
      const entry = await storage.getEntry(entryId);

      if (!entry || entry.teamId !== user.teamId) {
        error(res, 404, 'Entry not found.');
        return;
      }

      const body = JSON.parse(await readBody(req));
      const { content: commentContent } = body;

      if (!commentContent || typeof commentContent !== 'string' || !commentContent.trim()) {
        error(res, 400, 'Comment content is required.');
        return;
      }

      const comment = {
        id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        handle: user.handle,
        content: commentContent.trim(),
        timestamp: Date.now(),
      };

      const updated = await storage.addComment(entryId, comment);

      autoTranslateComment(entryId, comment.id);

      // Generate notifications
      const mentionedHandles = (commentContent.match(/@(\w+)/g) || []).map((m: string) => m.slice(1));
      const notifyHandles = new Set<string>();

      // Notify entry author (if not self)
      if (entry.handle !== user.handle) notifyHandles.add(entry.handle);

      // Notify @mentioned users
      for (const h of mentionedHandles) {
        if (h !== user.handle) notifyHandles.add(h);
      }

      const preview = commentContent.trim().slice(0, 80);
      for (const handle of notifyHandles) {
        const notifType: 'mention' | 'comment' = mentionedHandles.includes(handle) ? 'mention' : 'comment';
        await storage.addNotification({
          id: `n-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
          recipientHandle: handle,
          teamId: user.teamId,
          type: notifType,
          fromHandle: user.handle,
          entryId,
          commentId: comment.id,
          preview,
          read: false,
          timestamp: Date.now(),
        });

        // Fire-and-forget personal webhook if the recipient has one.
        const recipientUser = await storage.getUser(handle);
        if (recipientUser?.notificationWebhook) {
          sendPersonalWebhook(recipientUser.notificationWebhook, {
            type: notifType,
            fromHandle: user.handle,
            recipient: handle,
            preview,
            entryId,
            lang: recipientUser.lang,
          }).catch(() => {});
        }
      }

      json(res, 201, { comment, entry: updated });
      return;
    }

    // DELETE /api/entries/:id/comments/:commentId — Delete comment
    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/entries\/[^/]+\/comments\/[^/]+$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const parts = url.pathname.split('/');
      const entryId = parts[3];
      const commentId = parts[5];

      const entry = await storage.getEntry(entryId);
      if (!entry || entry.teamId !== user.teamId) {
        error(res, 404, 'Entry not found.');
        return;
      }

      const comment = entry.comments?.find(c => c.id === commentId);
      if (!comment) {
        error(res, 404, 'Comment not found.');
        return;
      }

      // Only comment author or team admin can delete
      if (comment.handle !== user.handle && !user.isAdmin) {
        error(res, 403, 'You can only delete your own comments.');
        return;
      }

      const updated = await storage.deleteComment(entryId, commentId);
      json(res, 200, { deleted: commentId, entry: updated });
      return;
    }

    // ── Search + Tags ──

    // GET /api/search — Search entries
    if (req.method === 'GET' && url.pathname === '/api/search') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const query = url.searchParams.get('q') || '';
      const limit = parseInt(url.searchParams.get('limit') || '50');

      if (!query.trim()) {
        error(res, 400, 'Query parameter "q" is required.');
        return;
      }

      const results = await storage.searchEntries(user.teamId, query, limit);
      json(res, 200, { query, results, count: results.length });
      return;
    }

    // GET /api/preset-tags — List all preset tags
    if (req.method === 'GET' && url.pathname === '/api/preset-tags') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const presetTags = await storage.getPresetTags();
      json(res, 200, { presetTags });
      return;
    }

    // POST /api/preset-tags — Add preset tag (admin only)
    if (req.method === 'POST' && url.pathname === '/api/preset-tags') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (!user.isAdmin) { error(res, 403, 'Admin only.'); return; }
      const body = JSON.parse(await readBody(req));
      const name = (body.name || '').toString().toLowerCase().trim();
      const description = (body.description || '').toString().trim();
      if (!name || !description) { error(res, 400, 'name and description are required.'); return; }
      if (!/^[a-z0-9][a-z0-9-:]*$/.test(name)) { error(res, 400, 'Invalid tag name format.'); return; }
      try {
        const tag = await storage.addPresetTag({ name, description, createdAt: Date.now() });
        json(res, 201, { tag });
      } catch (e: any) {
        error(res, 409, e.message || 'Preset tag already exists.');
      }
      return;
    }

    // PATCH /api/preset-tags/:name — Update preset tag description (admin only)
    if (req.method === 'PATCH' && url.pathname.match(/^\/api\/preset-tags\/[^/]+$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (!user.isAdmin) { error(res, 403, 'Admin only.'); return; }
      const name = decodeURIComponent(url.pathname.split('/').pop() || '').toLowerCase().trim();
      const body = JSON.parse(await readBody(req));
      const description = (body.description || '').toString().trim();
      if (!description) { error(res, 400, 'description is required.'); return; }
      const tag = await storage.updatePresetTag(name, description);
      if (!tag) { error(res, 404, 'Preset tag not found.'); return; }
      json(res, 200, { tag });
      return;
    }

    // DELETE /api/preset-tags/:name — Delete preset tag (admin only)
    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/preset-tags\/[^/]+$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (!user.isAdmin) { error(res, 403, 'Admin only.'); return; }
      const name = decodeURIComponent(url.pathname.split('/').pop() || '').toLowerCase().trim();
      const deleted = await storage.deletePresetTag(name);
      if (!deleted) { error(res, 404, 'Preset tag not found.'); return; }
      json(res, 200, { ok: true });
      return;
    }

    // GET /api/tags — Tag aggregation stats
    if (req.method === 'GET' && url.pathname === '/api/tags') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const stats = await storage.getTagStats(user.teamId);
      json(res, 200, { tags: stats });
      return;
    }

    // POST /api/tags/merge — Merge one tag into another (admin only)
    if (req.method === 'POST' && url.pathname === '/api/tags/merge') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (!user.isAdmin) { error(res, 403, 'Admin only.'); return; }
      const body = JSON.parse(await readBody(req));
      const from = (body.from || '').toString().toLowerCase().trim();
      const to = (body.to || '').toString().toLowerCase().trim();
      if (!from || !to || from === to) {
        error(res, 400, 'from and to are required and must differ.');
        return;
      }
      // Guard: tag and channel are separate namespaces in the data model, but
      // users see them both as "#xxx". Refuse to merge a tag whose name
      // collides with an existing channel — otherwise the entry's `channel`
      // column would still point at #from while its tags say #to.
      const collidingChannel = await storage.getChannel(from);
      if (collidingChannel && collidingChannel.teamId === user.teamId) {
        error(res, 409,
          `"#${from}" is also a channel. Delete the channel first (its entries will keep their tags), then merge the tag.`);
        return;
      }
      const all = await storage.getEntries(user.teamId, 100000);
      let updated = 0;
      for (const e of all) {
        if (!e.tags.includes(from)) continue;
        const next = Array.from(new Set(e.tags.map(t => (t === from ? to : t))));
        await storage.updateEntryTags(e.id, next);
        updated++;
      }
      json(res, 200, { ok: true, updated });
      return;
    }

    // DELETE /api/tags/:name — Remove a tag from all entries (admin only)
    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/tags\/[^/]+$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      if (!user.isAdmin) { error(res, 403, 'Admin only.'); return; }
      const name = decodeURIComponent(url.pathname.split('/').pop() || '').toLowerCase().trim();
      if (!name) { error(res, 400, 'Tag name required.'); return; }
      // Same guard as merge: don't let users delete a tag that shares a name
      // with a live channel — entries would still belong to the channel but
      // lose their tag, creating a confusing inconsistency.
      const collidingChannel = await storage.getChannel(name);
      if (collidingChannel && collidingChannel.teamId === user.teamId) {
        error(res, 409,
          `"#${name}" is also a channel. Delete the channel first, then delete the tag.`);
        return;
      }
      const all = await storage.getEntries(user.teamId, 100000);
      let updated = 0;
      for (const e of all) {
        if (!e.tags.includes(name)) continue;
        await storage.updateEntryTags(e.id, e.tags.filter(t => t !== name));
        updated++;
      }
      json(res, 200, { ok: true, updated });
      return;
    }

    // POST /api/tags — Create a custom tag (any member)
    if (req.method === 'POST' && url.pathname === '/api/tags') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const body = JSON.parse(await readBody(req));
      const name = (body.name || '').toString().toLowerCase().trim();
      if (!name) { error(res, 400, 'name is required.'); return; }
      if (!/^[a-z0-9][a-z0-9-:]*$/.test(name)) { error(res, 400, 'Invalid tag name format.'); return; }
      const presets = await storage.getPresetTags();
      if (presets.some(p => p.name === name)) {
        error(res, 409, `"${name}" is a preset tag — it already exists.`);
        return;
      }
      json(res, 201, { ok: true, tag: name });
      return;
    }

    // ── Channels ──

    // GET /api/channels — List team channels
    if (req.method === 'GET' && url.pathname === '/api/channels') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const channels = await storage.listChannels(user.teamId);
      json(res, 200, { channels });
      return;
    }

    // POST /api/channels — Create channel
    if (req.method === 'POST' && url.pathname === '/api/channels') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const body = JSON.parse(await readBody(req));
      const { id, name, description } = body;

      if (!id || !isValidChannelId(id)) {
        error(res, 400, 'Invalid channel ID. Use 2-30 lowercase alphanumeric + hyphens.');
        return;
      }

      const existing = await storage.getChannel(id);
      if (existing) {
        error(res, 409, `Channel #${id} already exists.`);
        return;
      }

      const channel = await storage.createChannel({
        id,
        teamId: user.teamId,
        name: name || id,
        description: description || undefined,
        joinRule: 'open',
        createdBy: user.handle,
        createdAt: Date.now(),
        skills: [],
        subscribers: [{ handle: user.handle, role: 'admin', joinedAt: Date.now() }],
      });

      json(res, 201, { channel });
      return;
    }

    // POST /api/channels/:id/join — Join a channel
    if (req.method === 'POST' && url.pathname.match(/^\/api\/channels\/[^/]+\/join$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const channelId = url.pathname.split('/')[3];
      const channel = await storage.getChannel(channelId);
      if (!channel || channel.teamId !== user.teamId) { error(res, 404, 'Channel not found.'); return; }
      await storage.addSubscriber(channelId, user.handle, 'member');
      json(res, 200, { joined: channelId });
      return;
    }

    // POST /api/channels/:id/leave — Leave a channel
    if (req.method === 'POST' && url.pathname.match(/^\/api\/channels\/[^/]+\/leave$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const channelId = url.pathname.split('/')[3];
      await storage.removeSubscriber(channelId, user.handle);
      json(res, 200, { left: channelId });
      return;
    }

    // GET /api/channels/:id/entries — Channel entries
    if (req.method === 'GET' && url.pathname.match(/^\/api\/channels\/[^/]+\/entries$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const channelId = url.pathname.split('/')[3];
      const limit = parseInt(url.searchParams.get('limit') || '50');

      let entries = await storage.getChannelEntries(user.teamId, channelId, limit);

      // Merge user's pending channel entries
      const staged = storage as any;
      if (staged.getPendingEntriesByHandle) {
        const pending: RouterEntry[] = await staged.getPendingEntriesByHandle(user.handle);
        const channelDest = `#${channelId}`;
        const matchingPending = pending.filter((e: RouterEntry) =>
          e.teamId === user.teamId && (e.channel === channelId || e.to?.includes(channelDest))
        );
        const existingIds = new Set(entries.map(e => e.id));
        const newPending = matchingPending.filter((e: RouterEntry) => !existingIds.has(e.id));
        entries = [...newPending, ...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
      }

      json(res, 200, { entries: await enrichEntries(entries), count: entries.length });
      return;
    }

    // GET /api/channels/:id/timeline — Channel timeline (节点 entries by node tags)
    if (req.method === 'GET' && url.pathname.match(/^\/api\/channels\/[^/]+\/timeline$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const channelId = decodeURIComponent(url.pathname.split('/')[3]);

      const channel = await storage.getChannel(channelId);
      if (!channel || channel.teamId !== user.teamId) {
        error(res, 404, 'Channel not found.');
        return;
      }

      const daysRaw = parseInt(url.searchParams.get('days') || '30', 10);
      if (!isValidTimelineDays(daysRaw)) {
        error(res, 400, 'days must be 7, 30, or 90');
        return;
      }
      const days: TimelineDays = daysRaw;

      // Pull a generous slice of entries; v1 trades an extra in-memory pass for simplicity.
      const raw = await storage.getChannelEntries(user.teamId, channelId, 1000);
      const entries = filterTimelineEntries(raw, days);

      json(res, 200, {
        entries: await enrichEntries(entries),
        count: entries.length,
        days,
      });
      return;
    }

    // GET /api/channels/:id — Channel detail
    if (req.method === 'GET' && url.pathname.match(/^\/api\/channels\/[^/]+$/) && !url.pathname.includes('/entries')) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const channelId = decodeURIComponent(url.pathname.split('/')[3]);
      const channel = await storage.getChannel(channelId);

      if (!channel || channel.teamId !== user.teamId) {
        error(res, 404, 'Channel not found.');
        return;
      }

      json(res, 200, { channel });
      return;
    }

    // POST /api/channels/:id/skills — Add a skill to channel
    if (req.method === 'POST' && url.pathname.match(/^\/api\/channels\/[^/]+\/skills$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const channelId = url.pathname.split('/')[3];
      const channel = await storage.getChannel(channelId);

      if (!channel || channel.teamId !== user.teamId) {
        error(res, 404, 'Channel not found.');
        return;
      }

      // Channels are team-public — any team member can add/edit skills.
      // (Membership-gating removed; team match was already enforced above.)

      const body = JSON.parse(await readBody(req));
      const {
        name,
        description,
        instructions,
        exposeAs,
        parameters,
        triggers,
        effects,
        digestConfig,
      } = body as {
        name?: string;
        description?: string;
        instructions?: string;
        exposeAs?: 'tool' | 'context' | 'both' | 'prewrite' | 'digest';
        parameters?: SkillParameter[];
        triggers?: SkillTrigger[];
        effects?: SkillEffect[];
        digestConfig?: any;
      };

      if (!name || typeof name !== 'string') {
        error(res, 400, 'Skill name is required.');
        return;
      }
      if (!exposeAs || !['tool', 'context', 'both', 'prewrite', 'digest'].includes(exposeAs)) {
        error(res, 400, 'exposeAs must be one of: tool, context, both, prewrite, digest.');
        return;
      }

      const skillName = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (channel.skills.some(s => s.name === skillName)) {
        error(res, 409, `Skill "${skillName}" already exists.`);
        return;
      }

      // For digest skills, seed lastRunAt = now so the first automatic run
      // happens one full schedule interval later — not immediately when the
      // cron scanner next ticks.
      const seededDigestConfig = exposeAs === 'digest' && digestConfig
        ? { ...digestConfig, lastRunAt: digestConfig.lastRunAt ?? Date.now() }
        : undefined;

      const newSkill: Skill = {
        id: `${channelId}_${skillName}`,
        name: skillName,
        description: description || '',
        instructions: instructions || '',
        exposeAs,
        parameters: parameters || undefined,
        triggers: triggers || undefined,
        effects: effects || undefined,
        digestConfig: seededDigestConfig,
        createdAt: Date.now(),
      };

      channel.skills.push(newSkill);
      await storage.updateChannel(channelId, { skills: channel.skills });

      json(res, 201, { skill: newSkill, channel_id: channelId });
      return;
    }

    // PATCH /api/channels/:id/skills/:name — Update an existing skill
    if (req.method === 'PATCH' && url.pathname.match(/^\/api\/channels\/[^/]+\/skills\/[^/]+$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const parts = url.pathname.split('/');
      const channelId = parts[3];
      const skillName = parts[5];

      const channel = await storage.getChannel(channelId);
      if (!channel || channel.teamId !== user.teamId) {
        error(res, 404, 'Channel not found.');
        return;
      }
      // Channels are team-public — team membership is sufficient.
      // (Team match was already enforced above.)

      const skill = channel.skills.find(s => s.name === skillName);
      if (!skill) {
        error(res, 404, `Skill "${skillName}" not found.`);
        return;
      }

      const body = JSON.parse(await readBody(req));
      const updatable: (keyof Skill)[] = ['description', 'instructions', 'exposeAs', 'parameters', 'triggers', 'effects', 'digestConfig'];
      for (const key of updatable) {
        if (body[key] !== undefined) (skill as any)[key] = body[key];
      }
      skill.updatedAt = Date.now();

      await storage.updateChannel(channelId, { skills: channel.skills });
      json(res, 200, { skill, channel_id: channelId });
      return;
    }

    // DELETE /api/channels/:id — Delete a channel (does NOT delete the entries
    // that were posted to it; they remain visible on the dashboard with their
    // tags + channel reference intact, they just lose their channel home).
    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/channels\/[^/]+$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const channelId = url.pathname.split('/')[3];
      const channel = await storage.getChannel(channelId);
      if (!channel || channel.teamId !== user.teamId) {
        error(res, 404, 'Channel not found.');
        return;
      }

      // Channel deletion is destructive — keep it gated to team admins.
      if (!user.isAdmin) {
        error(res, 403, 'Only team admins can delete a channel.');
        return;
      }

      await storage.deleteChannel(channelId);
      json(res, 200, { deleted: channelId });
      return;
    }

    // DELETE /api/channels/:id/skills/:name — Remove a skill
    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/channels\/[^/]+\/skills\/[^/]+$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const parts = url.pathname.split('/');
      const channelId = parts[3];
      const skillName = parts[5];

      const channel = await storage.getChannel(channelId);
      if (!channel || channel.teamId !== user.teamId) {
        error(res, 404, 'Channel not found.');
        return;
      }

      // Channels are team-public — team membership is sufficient.
      // (Team match was already enforced above.)

      channel.skills = channel.skills.filter(s => s.name !== skillName);
      await storage.updateChannel(channelId, { skills: channel.skills });

      json(res, 200, { deleted: skillName, channel_id: channelId });
      return;
    }

    // ── Hash API (B-plus successor to /api/channels) ──
    //
    // Any tag in entries.tags[] can have a tag_configs row attached. Anyone
    // on the team can read; subscribe is open; skill mutations are admin-only.
    // See docs/superpowers/specs/2026-05-15-tag-unification-design.md.

    // GET /api/tag-configs — list every tag_config row for caller's team
    if (req.method === 'GET' && url.pathname === '/api/tag-configs') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const tags = await storage.listTagConfigs(user.teamId);
      json(res, 200, { tags });
      return;
    }

    // POST /api/tag-configs/:tag/subscribe — anyone joins; auto-creates row if missing
    if (req.method === 'POST' && url.pathname.match(/^\/api\/tag-configs\/[^/]+\/subscribe$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const tag = decodeURIComponent(url.pathname.split('/')[3]);
      const config = await storage.addTagSubscriber(user.teamId, tag, user.handle, 'member');
      json(res, 200, { config });
      return;
    }

    // POST /api/tag-configs/:tag/unsubscribe — drop caller from subscribers
    if (req.method === 'POST' && url.pathname.match(/^\/api\/tag-configs\/[^/]+\/unsubscribe$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const tag = decodeURIComponent(url.pathname.split('/')[3]);
      const config = await storage.removeTagSubscriber(user.teamId, tag, user.handle);
      json(res, 200, { config });
      return;
    }

    // POST /api/tag-configs/:tag/skills — admin-only, add a skill (creates row if absent)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/tag-configs\/[^/]+\/skills$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const tag = decodeURIComponent(url.pathname.split('/')[3]);
      const body = JSON.parse(await readBody(req));
      const {
        name, description, instructions, exposeAs, parameters, triggers, effects, digestConfig,
      } = body as {
        name?: string; description?: string; instructions?: string;
        exposeAs?: 'tool' | 'context' | 'both' | 'prewrite' | 'digest';
        parameters?: SkillParameter[]; triggers?: SkillTrigger[];
        effects?: SkillEffect[]; digestConfig?: any;
      };

      if (!name || typeof name !== 'string') { error(res, 400, 'Skill name is required.'); return; }
      if (!exposeAs || !['tool', 'context', 'both', 'prewrite', 'digest'].includes(exposeAs)) {
        error(res, 400, 'exposeAs must be one of: tool, context, both, prewrite, digest.');
        return;
      }

      const existing = await storage.getTagConfig(user.teamId, tag);
      const currentSkills = existing?.skills ?? [];
      const skillName = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (currentSkills.some(s => s.name === skillName)) {
        error(res, 409, `Skill "${skillName}" already exists.`); return;
      }

      const seededDigestConfig = exposeAs === 'digest' && digestConfig
        ? { ...digestConfig, lastRunAt: digestConfig.lastRunAt ?? Date.now() }
        : undefined;

      const newSkill: Skill = {
        id: `${tag}_${skillName}`,
        name: skillName,
        description: description || '',
        instructions: instructions || '',
        exposeAs,
        parameters: parameters || undefined,
        triggers: triggers || undefined,
        effects: effects || undefined,
        digestConfig: seededDigestConfig,
        createdAt: Date.now(),
      };

      const config = await storage.upsertTagConfig(user.teamId, tag, {
        createdBy: existing?.createdBy ?? user.handle,
        skills: [...currentSkills, newSkill],
      });
      json(res, 201, { skill: newSkill, config });
      return;
    }

    // PATCH /api/tag-configs/:tag/skills/:name — admin-only, mutate existing skill fields
    if (req.method === 'PATCH' && url.pathname.match(/^\/api\/tag-configs\/[^/]+\/skills\/[^/]+$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const parts = url.pathname.split('/');
      const tag = decodeURIComponent(parts[3]);
      const skillName = decodeURIComponent(parts[5]);

      const existing = await storage.getTagConfig(user.teamId, tag);
      if (!existing) { error(res, 404, 'Tag config not found.'); return; }
      const skill = existing.skills.find(s => s.name === skillName);
      if (!skill) { error(res, 404, `Skill "${skillName}" not found.`); return; }

      const body = JSON.parse(await readBody(req));
      const updatable: (keyof Skill)[] = ['description', 'instructions', 'exposeAs', 'parameters', 'triggers', 'effects', 'digestConfig'];
      for (const key of updatable) {
        if (body[key] !== undefined) (skill as any)[key] = body[key];
      }
      skill.updatedAt = Date.now();
      const config = await storage.upsertTagConfig(user.teamId, tag, { skills: existing.skills });
      json(res, 200, { skill, config });
      return;
    }

    // DELETE /api/tag-configs/:tag/skills/:name — admin-only, drop a skill
    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/tag-configs\/[^/]+\/skills\/[^/]+$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const parts = url.pathname.split('/');
      const tag = decodeURIComponent(parts[3]);
      const skillName = decodeURIComponent(parts[5]);

      const existing = await storage.getTagConfig(user.teamId, tag);
      if (!existing) { error(res, 404, 'Tag config not found.'); return; }
      const remaining = existing.skills.filter(s => s.name !== skillName);
      const config = await storage.upsertTagConfig(user.teamId, tag, { skills: remaining });
      json(res, 200, { deleted: skillName, config });
      return;
    }

    // GET /api/tag-configs/:tag — entries + optional config block
    if (req.method === 'GET' && url.pathname.match(/^\/api\/tag-configs\/[^/]+$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const tag = decodeURIComponent(url.pathname.split('/')[3]);
      const limit = parseInt(url.searchParams.get('limit') || '50');

      const [rawEntries, config] = await Promise.all([
        storage.getEntriesByTag(user.teamId, tag, limit),
        storage.getTagConfig(user.teamId, tag),
      ]);

      // Mirror /api/channels/:id/entries: include the caller's pending rows
      // for this tag that the staging window hides from `getEntriesByTag`.
      let entries = rawEntries;
      const staged = storage as any;
      if (staged.getPendingEntriesByHandle) {
        const pending: RouterEntry[] = await staged.getPendingEntriesByHandle(user.handle);
        const channelDest = `#${tag}`;
        const matchingPending = pending.filter((e: RouterEntry) =>
          e.teamId === user.teamId &&
          (e.tags?.includes(tag) || e.channel === tag || e.to?.includes(channelDest)),
        );
        const existingIds = new Set(entries.map(e => e.id));
        const newPending = matchingPending.filter((e: RouterEntry) => !existingIds.has(e.id));
        entries = [...newPending, ...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
      }

      json(res, 200, {
        tag,
        config: config ?? null,
        entries: await enrichEntries(entries),
        count: entries.length,
      });
      return;
    }

    // ── Team info ──

    // GET /api/team — Get current user's team info
    if (req.method === 'GET' && url.pathname === '/api/team') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const team = await storage.getTeam(user.teamId);
      const members = await storage.getAllUsers(user.teamId);

      json(res, 200, {
        team,
        // larkName is included so the @ mention typeahead can match against
        // a user's Lark display name in addition to the canonical handle.
        members: members.map(m => ({
          handle: m.handle,
          displayName: m.displayName,
          larkName: m.larkName,
          role: m.role,
          isAdmin: m.isAdmin,
        })),
      });
      return;
    }

    // GET /api/team/members — Members + recent activity for the requester's team
    if (req.method === 'GET' && url.pathname === '/api/team/members') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const users = await storage.getAllUsers(user.teamId);

      // Fetch top-3 entries per user in parallel
      const enriched = await Promise.all(users.map(async u => {
        // Fetch more than needed so hidden entries don't silently reduce the visible count below 3
        const entries = await storage.getEntriesByHandle(user.teamId, u.handle, 50);
        const visible = entries.filter(e => !e.hidden);
        return {
          handle: u.handle,
          displayName: u.displayName,
          bio: u.bio,
          email: u.email,
          role: u.role,
          isAdmin: u.isAdmin,
          joinedAt: u.createdAt,
          larkBinding: u.larkOpenId ? {
            name: u.larkName,
            avatarUrl: u.larkAvatarUrl,
          } : undefined,
          recentEntries: visible.slice(0, 3).map(e => ({
            id: e.id,
            summary: e.summary,
            timestamp: e.timestamp,
            tags: e.tags,
          })),
        };
      }));

      // Sort: most recent activity first (max entry timestamp), no-entry users alphabetical at the bottom
      enriched.sort((a, b) => {
        const aMax = a.recentEntries[0]?.timestamp ?? 0;
        const bMax = b.recentEntries[0]?.timestamp ?? 0;
        if (aMax !== bMax) return bMax - aMax;
        return a.handle.localeCompare(b.handle);
      });

      json(res, 200, { members: enriched });
      return;
    }

    // POST /api/bookmarks/:entryId — Toggle bookmark
    if (req.method === 'POST' && url.pathname.match(/^\/api\/bookmarks\/[^/]+$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const entryId = decodeURIComponent(url.pathname.split('/')[3]);
      const bookmarks = user.bookmarks || [];
      const isBookmarked = bookmarks.includes(entryId);

      const updated = isBookmarked
        ? bookmarks.filter(id => id !== entryId)
        : [...bookmarks, entryId];

      await storage.updateUser(user.handle, { bookmarks: updated });
      json(res, 200, { bookmarked: !isBookmarked, entryId });
      return;
    }

    // GET /api/bookmarks — Get bookmarked entries
    if (req.method === 'GET' && url.pathname === '/api/bookmarks') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const bookmarks = user.bookmarks || [];
      const entries: any[] = [];
      for (const id of bookmarks) {
        const entry = await storage.getEntry(id);
        if (entry && entry.teamId === user.teamId) entries.push(entry);
      }

      json(res, 200, { entries: await enrichEntries(entries), count: entries.length });
      return;
    }

    // GET /api/me — Get current user info
    if (req.method === 'GET' && url.pathname === '/api/me') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      // tag_migration_relevant flips on if this team ever used the channel
      // feature (i.e. has a tag_config with skills, or a Lark binding). Web
      // uses this to show a one-time "Channels → Tags" announcement banner
      // only to teams that would notice the rename. Fresh teams skip it.
      let tagMigrationRelevant = false;
      try {
        const [tagConfigs, larkBindings] = await Promise.all([
          storage.listTagConfigs(user.teamId).catch(() => []),
          storage.listLarkChatBindingsByTeam(user.teamId).catch(() => []),
        ]);
        tagMigrationRelevant =
          tagConfigs.some(c => (c.skills?.length ?? 0) > 0) ||
          larkBindings.length > 0;
      } catch { /* default false */ }

      json(res, 200, {
        handle: user.handle,
        teamId: user.teamId,
        displayName: user.displayName,
        bio: user.bio,
        email: user.email,
        role: user.role,
        isAdmin: user.isAdmin,
        stagingDelayMs: user.stagingDelayMs,
        notificationWebhook: user.notificationWebhook,
        lang: user.lang,
        mcpSchemaVersion: MCP_SCHEMA_VERSION,
        tagMigrationRelevant,
        larkBinding: user.larkOpenId ? {
          openId: user.larkOpenId,
          name: user.larkName,
          avatarUrl: user.larkAvatarUrl,
          boundAt: user.larkBoundAt,
          scopes: user.larkScopes ?? [],
        } : undefined,
        matrixBinding: matrixBindingFor(user),
      });
      return;
    }

    // GET /api/me/tag-presets — List saved tag combinations
    if (req.method === 'GET' && url.pathname === '/api/me/tag-presets') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      json(res, 200, { presets: user.tagPresets || [] });
      return;
    }

    // POST /api/me/tag-presets — Save a tag combination
    if (req.method === 'POST' && url.pathname === '/api/me/tag-presets') {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const body = JSON.parse(await readBody(req));
      const name = (body.name || '').toString().trim();
      const tags = Array.isArray(body.tags)
        ? body.tags.map((t: string) => String(t).toLowerCase().trim()).filter(Boolean)
        : [];
      if (!name || tags.length === 0) {
        error(res, 400, 'name and tags are required.');
        return;
      }
      const preset = {
        id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        tags,
        createdAt: Date.now(),
      };
      const next = [...(user.tagPresets || []), preset];
      await storage.updateUser(user.handle, { tagPresets: next });
      json(res, 201, { preset });
      return;
    }

    // DELETE /api/me/tag-presets/:id — Remove a saved tag combination
    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/me\/tag-presets\/[^/]+$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;
      const id = url.pathname.split('/').pop()!;
      const next = (user.tagPresets || []).filter(p => p.id !== id);
      await storage.updateUser(user.handle, { tagPresets: next });
      json(res, 200, { ok: true });
      return;
    }

    // ── Notifications ──

    // GET /api/notifications — Get notifications for current user
    if (req.method === 'GET' && url.pathname === '/api/notifications') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const notifications = await storage.getNotifications(user.handle);
      const unreadCount = await storage.getUnreadCount(user.handle);
      json(res, 200, { notifications, unreadCount });
      return;
    }

    // GET /api/notifications/unread-count — Quick unread count
    if (req.method === 'GET' && url.pathname === '/api/notifications/unread-count') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const count = await storage.getUnreadCount(user.handle);
      json(res, 200, { count });
      return;
    }

    // POST /api/notifications/read-all — Mark all read
    if (req.method === 'POST' && url.pathname === '/api/notifications/read-all') {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      await storage.markAllNotificationsRead(user.handle);
      json(res, 200, { ok: true });
      return;
    }

    // POST /api/notifications/:id/read — Mark one read
    if (req.method === 'POST' && url.pathname.match(/^\/api\/notifications\/[^/]+\/read$/)) {
      const user = await requireAuth(req, url, res);
      if (!user) return;

      const notifId = url.pathname.split('/')[3];
      await storage.markNotificationRead(notifId);
      json(res, 200, { ok: true });
      return;
    }

    // ════════════════════════════════════════════════════════
    // MCP Transport endpoints
    // ════════════════════════════════════════════════════════

    // GET /mcp/sse — SSE endpoint for Claude Desktop/Code
    if (req.method === 'GET' && url.pathname === '/mcp/sse') {
      const secretKey = url.searchParams.get('key');

      if (!secretKey || !isValidSecretKey(secretKey)) {
        error(res, 401, 'Valid key required as ?key= parameter');
        return;
      }

      // Verify user is registered
      const user = await storage.getUserByKeyHash(hashSecretKey(secretKey));
      if (!user) {
        error(res, 403, 'Not registered. Create a team or join with invite code first.');
        return;
      }

      const mcpServer = await createMCPServer(secretKey, 'mcp-sse');
      res.setHeader('X-Accel-Buffering', 'no');
      const transport = new SSEServerTransport('/mcp/messages', res as any);

      const sessionId = transport.sessionId;
      mcpSessions.set(sessionId, { transport, secretKey });

      // SSE heartbeat — send a comment every 30s to keep the connection alive
      // through proxies (nginx, Cloudflare, etc.) that drop idle connections.
      // SSE comments (lines starting with `:`) are ignored by spec-compliant
      // clients and don't interfere with the MCP protocol.
      const heartbeat = setInterval(() => {
        try {
          if (!res.writableEnded) {
            res.write(': heartbeat\n\n');
          }
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      await mcpServer.connect(transport);

      req.on('close', () => {
        clearInterval(heartbeat);
        mcpSessions.delete(sessionId);
        console.log(`[MCP] Session ${sessionId} disconnected (client closed connection). Handle: @${user.handle}`);
      });

      req.on('error', (err) => {
        clearInterval(heartbeat);
        mcpSessions.delete(sessionId);
        console.error(`[MCP] Session ${sessionId} error: ${err.message}. Handle: @${user.handle}`);
      });

      return;
    }

    // POST /mcp/messages — Message endpoint for MCP SSE
    if (req.method === 'POST' && url.pathname === '/mcp/messages') {
      const sessionId = url.searchParams.get('sessionId');

      if (!sessionId) {
        error(res, 400, 'Missing sessionId query parameter. The SSE connection provides this when established at /mcp/sse.');
        return;
      }

      const session = mcpSessions.get(sessionId);
      if (!session) {
        error(res, 404, `Session "${sessionId}" not found. It may have expired or the SSE connection was closed. Reconnect at /mcp/sse?key=YOUR_KEY to start a new session.`);
        return;
      }

      try {
        await session.transport.handlePostMessage(req as any, res as any);
      } catch (err: any) {
        console.error(`[MCP] Message error on session ${sessionId}:`, err?.message || err);
        if (!res.headersSent) {
          error(res, 500, `MCP message processing failed: ${err?.message || 'unknown error'}. The session may need to be re-established.`);
        }
      }
      return;
    }

    // ════════════════════════════════════════════════════════
    // MCP Streamable HTTP transport (modern; replaces SSE long-term)
    //
    // Single endpoint handles POST (most requests), GET (resumable streams,
    // server-initiated notifications), and DELETE (session termination).
    // The transport library inspects HTTP method + body internally — we
    // just route everything to handleRequest().
    //
    // Auth: ?key= in URL (same as /mcp/sse). Sessions are tracked via
    // Mcp-Session-Id header set on the initialize response.
    // ════════════════════════════════════════════════════════

    if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
      const secretKey = url.searchParams.get('key');

      if (!secretKey || !isValidSecretKey(secretKey)) {
        error(res, 401, 'Valid key required as ?key= parameter');
        return;
      }

      const user = await storage.getUserByKeyHash(hashSecretKey(secretKey));
      if (!user) {
        error(res, 403, 'Not registered. Create a team or join with invite code first.');
        return;
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      const session = sessionId ? mcpStreamableSessions.get(sessionId) : undefined;

      if (session) {
        // Existing session — route through its transport. Library handles
        // the JSON-RPC request and writes the response.
        try {
          await session.transport.handleRequest(req, res);
        } catch (err: any) {
          console.error(`[MCP-HTTP] handleRequest error on session ${sessionId}:`, err?.message || err);
          if (!res.headersSent) {
            error(res, 500, `MCP request processing failed: ${err?.message || 'unknown error'}.`);
          }
        }
        return;
      }

      // Client sent a Mcp-Session-Id we don't recognize — almost always means
      // the server restarted (PM2 reload on deploy) since the client opened
      // its session, wiping the in-memory mcpStreamableSessions map. Per MCP
      // Streamable HTTP spec, return 404 for unknown sessions so the client
      // SDK detects the dead session and auto-re-initializes from scratch
      // instead of blowing up with "Server not initialized" (which the SDK
      // would emit if we fell through to the new-session branch below for a
      // non-`initialize` request — the new transport hasn't done the init
      // handshake and rejects everything else).
      if (sessionId) {
        console.log(`[MCP-HTTP] Session ${sessionId} not found — returning 404 so client re-initializes`);
        error(res, 404, 'Session not found — please re-initialize.');
        return;
      }

      // No session id at all → fresh client. Create transport + MCP server,
      // register on initialize. The transport calls onsessioninitialized when
      // it processes the initialize request and generates a session id.
      const mcpServer = await createMCPServer(secretKey);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          mcpStreamableSessions.set(sid, { transport, secretKey, userHandle: user.handle });
          console.log(`[MCP-HTTP] Session ${sid} initialized for @${user.handle}`);
        },
        onsessionclosed: (sid) => {
          mcpStreamableSessions.delete(sid);
          console.log(`[MCP-HTTP] Session ${sid} closed for @${user.handle}`);
        },
      });

      transport.onerror = (err) => {
        console.error(`[MCP-HTTP] transport error for @${user.handle}: ${err?.message || err}`);
      };

      try {
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err: any) {
        console.error(`[MCP-HTTP] Initial handshake failed for @${user.handle}:`, err?.message || err);
        if (!res.headersSent) {
          error(res, 500, `MCP handshake failed: ${err?.message || 'unknown error'}.`);
        }
      }
      return;
    }

    // ── 404 ──
    error(res, 404, `Not found: ${req.method} ${url.pathname}`);

  } catch (err: any) {
    console.error(`[Error] ${req.method} ${url.pathname}:`, err);
    error(res, 500, 'Internal server error');
  }
}

// ─────────────────────────────────────────────────────────────
// Start server (HTTPS if certs exist, otherwise HTTP)
// ─────────────────────────────────────────────────────────────

const server = createServer(handleRequest);

server.listen(PORT, async () => {
  if (process.env.DATABASE_URL) {
    try {
      await runMigrations(process.env.DATABASE_URL);
      console.log('✓ DB schema applied (idempotent)');
    } catch (err: any) {
      console.error('Migration failed on startup:', err.message);
    }
  }
  console.log(`Router server running on ${protocol}://localhost:${PORT}`);
  startDigestCron();

  // Concierge daily brief cron (10am Beijing). Skipped if no Lark API client.
  // LLM (callLLM) is passed when OPENROUTER_API_KEY is set — enables team
  // overview + per-user callout synthesis. Without it, cron falls back to
  // structured channel-list rendering.
  if (larkApiClientForEffects) {
    startConciergeCron({
      storage,
      apiClient: larkApiClientForEffects,
      publicUrl: PERSONAL_WEBHOOK_PUBLIC_URL,
      callLLM: process.env.OPENROUTER_API_KEY ? callLLM : undefined,
    });
  } else {
    console.log('[concierge-cron] Skipped Lark push cron — Lark not configured. (router_brief MCP tool / CLI / HTTP brief still work; only the weekly Lark IM push is disabled.)');
  }

  // Lark user-token keep-alive cron (daily 3am Beijing). Rolls every bound
  // user's refresh token forward so the 7-day expiry never bites — a user
  // binds once and the link stays alive. Skipped if Lark not configured.
  if (larkApiClientForEffects && larkTokenManagerForEffects) {
    startLarkTokenRefreshCron({
      storage,
      tokenManager: larkTokenManagerForEffects,
      apiClient: larkApiClientForEffects,
      publicUrl: PERSONAL_WEBHOOK_PUBLIC_URL,
    });
  } else {
    console.log('[lark-token-refresh] Skipped — Lark not configured.');
  }

  recoverMissedWebhooks();
});
