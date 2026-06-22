import type { Storage } from '../../storage.js';
import type { LarkApiClient, ChatMessage, FetchHistoryResult } from '../api-client.js';
import { fetchUserNames, fetchChatMemberNames } from '../api-client.js';
import type { TimeRange } from '../parse-time-range.js';
import type { SummaryResult, SummarizeArgs } from '../llm-summarize.js';
import type { RateLimiter } from '../rate-limit.js';
import { buildSummaryCard, buildErrorCard, buildLoadingCard, type LarkInteractiveCard } from '../card-builder.js';
import type { SummaryTokenCache } from '../summary-token-cache.js';
import { listTeamTags } from '../tag-resolve.js';
import { renderTagContextForLLM } from '../../entry-prompts.js';
import { BOT_NAME } from '../bot-config.js';

export interface SummarizeHandlerDeps {
  storage: Pick<Storage, 'getLarkChatBinding' | 'updateLarkLastSummary' | 'listTagConfigs' | 'getUserByLarkOpenId' | 'getPresetTags' | 'getTagStats' | 'getLarkChatStyle'>;
  apiClient: LarkApiClient;
  fetchHistory: (args: { chatId: string; startTs: number; endTs: number; cap?: number }) => Promise<FetchHistoryResult>;
  summarize: (args: SummarizeArgs) => Promise<SummaryResult>;
  parseTimeRange: (query: string, ctx: { now: number; lastSummaryTs?: number }) => Promise<TimeRange>;
  rateLimiter: RateLimiter;
  tokenCache?: SummaryTokenCache;
  now?: () => number;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

const SLASH_RE = /^(?:.*?)\/summarize(?:\s+(\S.*?))?\s*$/i;

function extractSummarizeArg(text: string): string | null {
  // Strip Lark mention placeholders like @_user_1 — they appear before /summarize
  // and Lark stores them as the opaque key in `mentions[]`.
  const stripped = text.replace(/@_user_\d+/g, '').trim();
  const m = stripped.match(SLASH_RE);
  if (!m) return null;
  return (m[1] ?? '').trim();
}

function extractText(content: string): string {
  try { const j = JSON.parse(content); return j.text ?? ''; } catch { return ''; }
}

export function createSummarizeHandler(deps: SummarizeHandlerDeps) {
  const log = deps.log ?? ((lvl, m) => console[lvl === 'info' ? 'log' : lvl](`[lark-summarize] ${m}`));
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  async function send(chatId: string, card: LarkInteractiveCard): Promise<string | null> {
    try {
      const data = await deps.apiClient.post<{ message_id?: string }>(
        '/open-apis/im/v1/messages?receive_id_type=chat_id',
        {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      );
      return data?.message_id ?? null;
    } catch (e: any) {
      log('error', `send failed: ${e?.message ?? e}`);
      return null;
    }
  }

  async function patch(messageId: string, card: LarkInteractiveCard): Promise<void> {
    try {
      await deps.apiClient.patch(`/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`, {
        content: JSON.stringify(card),
      });
    } catch (e: any) {
      log('error', `patch failed: ${e?.message ?? e}`);
    }
  }

  return async function handle(payload: any): Promise<void> {
    const chatId = payload?.message?.chat_id;
    const senderOpenId = payload?.sender?.sender_id?.open_id ?? 'unknown';
    if (!chatId) return;

    const text = extractText(payload?.message?.content ?? '');
    const arg = extractSummarizeArg(text);
    log('info', `event from chat=${chatId} user=${senderOpenId} text=${JSON.stringify(text).slice(0, 200)} matched=${arg !== null}`);
    if (arg === null) return;  // not a /summarize command

    const rl = deps.rateLimiter.check(`${chatId}:${senderOpenId}`);
    if (!rl.allowed) {
      const secs = Math.ceil((rl.retryInMs ?? 0) / 1000);
      log('warn', `rate-limited chat=${chatId} user=${senderOpenId} retryInSec=${secs}`);
      await send(chatId, buildErrorCard(`冷静一下,${secs} 秒后再试。`));
      return;
    }

    const binding = await deps.storage.getLarkChatBinding(chatId);
    let teamId: string;
    let chatName: string;
    let lastSummaryTs: number | undefined;
    let defaultArchiveChannelId: string;
    if (binding) {
      teamId = binding.teamId;
      chatName = binding.chatName;
      lastSummaryTs = binding.lastSummaryTs;
      defaultArchiveChannelId = binding.archiveChannelId ?? binding.channelId;
    } else {
      const user = await deps.storage.getUserByLarkOpenId(senderOpenId);
      if (!user) {
        await send(chatId, buildErrorCard(
          `本群未连接 router，且你没绑定 router 账号。先到 router 网页绑定 Lark 账号，或在群里 \`@${BOT_NAME} /connect <tag>\`。`,
        ));
        return;
      }
      teamId = user.teamId;
      // Fetch real chat name from Lark API; fall back to synthetic on failure
      let resolvedChatName = `Lark group (${chatId.slice(-8)})`;
      try {
        const info = await deps.apiClient.get<{ name?: string }>(`/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`);
        if (info?.name) resolvedChatName = info.name;
      } catch (e: any) {
        log('warn', `chat name fetch failed for ${chatId}: ${e?.message ?? e}`);
      }
      chatName = resolvedChatName;
      lastSummaryTs = undefined;
      defaultArchiveChannelId = '';
    }

    let range: TimeRange;
    try {
      range = await deps.parseTimeRange(arg, { now: now(), lastSummaryTs });
    } catch (e: any) {
      await send(chatId, buildErrorCard(`没听懂时间范围『${arg}』。可以试试 \`/summarize 1h\` 或 \`/summarize today\`。`));
      return;
    }

    // Send loading card immediately. Save the message_id so we can PATCH the
    // same card with the final result (or error) — keeps the chat clean.
    const loadingMessageId = await send(chatId, buildLoadingCard(range.interpretation));
    async function deliver(card: LarkInteractiveCard): Promise<void> {
      if (loadingMessageId) await patch(loadingMessageId, card);
      else await send(chatId, card);
    }

    let history: { messages: ChatMessage[]; truncated: boolean; mentionedNames: Map<string, string> };
    try {
      history = await deps.fetchHistory({ chatId, startTs: range.start_ts, endTs: range.end_ts, cap: 1000 });
    } catch (e: any) {
      log('error', `fetchHistory failed: ${e?.message}`);
      await deliver(buildErrorCard('Lark 接口繁忙,稍后重试。'));
      return;
    }

    if (history.truncated) {
      await deliver(buildErrorCard('时间范围内消息过多 (>1000 条)。请缩小范围,例如 `/summarize 1h`。'));
      return;
    }
    if (history.messages.length === 0) {
      await deliver(buildErrorCard(`${range.interpretation} 内没有消息可总结。`));
      return;
    }

    // Resolve sender open_ids to display names. Priority intentionally puts
    // the tenant display name first — empirically that's the most stable and
    // consistent identifier across surfaces (it's what 通讯录 shows, what
    // chat members panel shows, what most teammates use). Mention names can
    // bring in stale aliases (English name / old nickname) that diverge from
    // what the team has settled on, so they're a last-resort fallback.
    //
    //   1) Chat members API — tenant display name. Covers all current
    //      members. Returns whatever 通讯录 currently shows. Most reliable.
    //   2) Contact API — same field, but works for users who left the chat
    //      since (still in tenant directory).
    //   3) @-mention harvest — only used if both APIs failed for someone.
    //      Risk: may carry stale per-message alias from when the @ was made.
    //   4) "用户xxxxxx" placeholder — final fallback.
    const senderIds = Array.from(new Set(history.messages.map(m => m.senderId)));
    const senderNames = new Map<string, string>();
    try {
      const memberNames = await fetchChatMemberNames(deps.apiClient, chatId);
      for (const [k, v] of memberNames) senderNames.set(k, v);
    } catch (e: any) {
      log('warn', `fetchChatMemberNames failed: ${e?.message ?? e}`);
    }
    const stillUnresolved = () => senderIds.filter(id => !senderNames.has(id));
    let unresolved = stillUnresolved();
    if (unresolved.length > 0) {
      try {
        const contactNames = await fetchUserNames(deps.apiClient, unresolved);
        for (const [k, v] of contactNames) senderNames.set(k, v);
      } catch (e: any) {
        log('warn', `fetchUserNames failed: ${e?.message ?? e}`);
      }
    }
    // Last-resort mention fallback for any sender both APIs missed.
    unresolved = stillUnresolved();
    if (unresolved.length > 0) {
      for (const id of unresolved) {
        const name = history.mentionedNames.get(id);
        if (name) senderNames.set(id, name);
      }
    }
    log('info', `name resolution: ${senderNames.size}/${senderIds.length} resolved (mention-fallbacks used: ${unresolved.filter(id => senderNames.has(id)).length})`);

    const tagContext = await renderTagContextForLLM(deps.storage, teamId);

    let result: SummaryResult;
    try {
      const chatStyle = await deps.storage.getLarkChatStyle(chatId);
      result = await deps.summarize({
        messages: history.messages,
        chatName,
        interpretation: range.interpretation,
        resolveSender: id => senderNames.get(id) ?? `用户${id.slice(-6)}`,
        tagContext,
        style: chatStyle ?? undefined,
      });
    } catch (e: any) {
      log('error', `summarize failed: ${e?.message}`);
      await deliver(buildErrorCard('LLM 服务暂不可用,1 分钟后重试。'));
      return;
    }

    let saveOptions: { summaryToken: string; channels: Array<{ id: string; name: string }>; defaultChannelId: string } | undefined;
    const hasContent = result.tldr || result.updates.length || result.decisions.length || result.todo.length || result.open_questions.length;
    if (deps.tokenCache && hasContent) {
      const channelOpts = await listTeamTags(deps.storage, teamId);
      const summaryToken = deps.tokenCache.put({
        summary: result,
        interpretation: range.interpretation,
        chatId,
        chatName,
        teamId,
        defaultArchiveChannelId,
        organizerOpenId: senderOpenId,
        generatedAt: now() * 1000,
      });
      saveOptions = { summaryToken, channels: channelOpts, defaultChannelId: defaultArchiveChannelId };
    }

    const card = buildSummaryCard({ summary: result, interpretation: range.interpretation, chatName, saveOptions });
    await deliver(card);
    if (binding) {
      // lastSummaryTs is unix seconds (matches range.end_ts);
      // lastSummaryAt is unix ms (used for "X ago" display via Date.now() math).
      await deps.storage.updateLarkLastSummary(chatId, range.end_ts, now() * 1000);
    }
  };
}
