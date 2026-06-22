/**
 * Agent loop: user @bot's the bot with free-form text → LLM picks a tool (or
 * not) → server executes tool → LLM composes a final reply → bot posts text
 * in the group.
 *
 * Capped at 3 tool-call rounds to prevent runaway loops.
 *
 * Rate-limited per chat (1 call per minute) to control cost / spam.
 */

import { callAgentLLM, type AgentMessage } from './agent-llm.js';
import { TOOLS, TOOL_DEFS, type ToolContext, type ToolResult } from './agent-tools.js';
import type { LarkApiClient } from './api-client.js';
import type { Storage } from '../storage.js';
import {
  buildAgentThinkingCard,
  buildAgentReplyCard,
  buildAgentSilentDoneCard,
  buildErrorCard,
  type LarkInteractiveCard,
} from './card-builder.js';

const MAX_ROUNDS = 3;
const MAX_REPLY_CHARS = 800;

const SYSTEM_PROMPT = `你是 Teleport Router 在 Lark 里的助理 bot,身份名是 "Router Bot"。
你的能力范围是 **Lark 群操作 + Router 内容查询**(下面 tools)。
不要假装你能做工具之外的事(看天气、写代码、解数学题等都不行 — 礼貌说明做不到即可)。

行为准则:
- **简短、建议性、不啰嗦**。回复 ≤200 字,中文。
- 用户说人话,不要每次都引导用户用 slash 命令(slash 命令是兜底,不是首选)。
- 真去执行的事,执行完用过去式说("已开启 watch") + 必要的下一步信息。
- 查询类回答要**引用具体 entry**(给 url),不要凭空编造。
- 不知道答案时直接说"我没找到相关信息",不要瞎答。
- 用户语气随便也回得随便,正式就正式 — 镜像他们的语气。
- 多条信息用 markdown bullet 列;单条信息直接一句话。

save_entry vs connect_channel vs set_push 路由 (**最重要**):

**默认假设:用户说"推送/记/存/save/归档"= 想存内容 = 立刻调 \`save_entry\`,不要犹豫,不要问"你希望我这样做吗"。**

判定规则:
- 句子里有 "**这条 / 这段 / 这个 / 上面 / 我说的 / 把"<内容>"**" → 永远是 \`save_entry\`
- 句子里有 "**连接 / 绑定 / connect / bind 这个群**" → \`connect_channel\`
- 句子里有 "**打开/关闭 推送通知 / push on / push off**" → \`set_push\`
- **歧义时永远偏向 \`save_entry\`**(它最不破坏性 —— 1 小时 staging 内可以删)

**严禁的回复模式**(这些是 bug,不是礼貌):
- ❌ "我能做的是帮你把消息保存为一个 entry。你希望我这样做吗?"
- ❌ "我不能直接推送消息到 tag。需要我把这条存为 entry 吗?"
- ❌ "你是想 X 还是 Y?"(在用户已经用了"推送/save/记"动词时)

**正确做法**:直接调 \`save_entry\`,不解释、不确认、不提供 alternatives。tool 调完会自动发卡片,用户看得见结果。

save_entry 参数细节:
- \`content\` = 用户原话 verbatim,不改写/扩写/加你的解读。如果用户说"把这个推送" → 取上一条用户说的实质内容当 content。
- \`channel\` 字段(legacy)在新接口里别传;tag 不指定也能存,server 兜底。
- tool 返回 \`sender_not_bound\` → 直接把那条 error 转给用户(里面有绑定链接),不解释。`;

export interface AgentDeps {
  storage: Storage;
  apiClient: LarkApiClient;
  llmModel: string;
  llmApiKey: string;
  publicUrl: string;
  triggerSummarize?: (chatId: string, timeRange: string) => Promise<void>;
}

export interface AgentRequest {
  chatId: string;
  senderOpenId: string;
  text: string;  // user message with @bot/@_user_N stripped
}

type RateMode = 'p2p' | 'group';

interface RateLimitState {
  // For group: just lastAt (1/min). For p2p: sliding window of recent timestamps.
  lastAt?: number;          // group mode
  recent?: number[];        // p2p mode: timestamps within RATE_WINDOW_MS
}
const rateLimit = new Map<string, RateLimitState>();
const RATE_WINDOW_MS = 60_000;
const P2P_LIMIT = 5;

function checkRate(chatId: string, now: number, mode: RateMode = 'group'): boolean {
  const r = rateLimit.get(chatId) ?? {};
  if (mode === 'group') {
    if (r.lastAt && now - r.lastAt < RATE_WINDOW_MS) return false;
    r.lastAt = now;
    rateLimit.set(chatId, r);
    return true;
  }
  // p2p sliding window
  const recent = (r.recent ?? []).filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= P2P_LIMIT) {
    r.recent = recent;
    rateLimit.set(chatId, r);
    return false;
  }
  recent.push(now);
  r.recent = recent;
  rateLimit.set(chatId, r);
  return true;
}

// Test-only exports for unit tests
export function _resetRateLimitForTest(): void { rateLimit.clear(); }
export function _checkRateForTest(chatId: string, now: number, mode: RateMode = 'group'): boolean {
  return checkRate(chatId, now, mode);
}

async function postCard(api: LarkApiClient, chatId: string, card: LarkInteractiveCard): Promise<string | null> {
  try {
    const data = await api.post<{ message_id?: string }>(
      '/open-apis/im/v1/messages?receive_id_type=chat_id',
      { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) },
    );
    return data?.message_id ?? null;
  } catch (e: any) {
    console.error(`[agent] post card failed:`, e?.message ?? e);
    return null;
  }
}

async function patchCard(api: LarkApiClient, messageId: string, card: LarkInteractiveCard): Promise<void> {
  try {
    await api.patch(`/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`, {
      content: JSON.stringify(card),
    });
  } catch (e: any) {
    console.error(`[agent] patch card failed:`, e?.message ?? e);
  }
}

export interface RunAgentOptions {
  /** Rate-limit + behavior mode. 'group' = legacy 1/min and silent-drop on rate-limit. 'p2p' = 5/min and return {rateLimited:true} for caller to handle. */
  mode?: RateMode;
  /** Inject clock for tests */
  now?: number;
}

export async function runAgent(
  req: AgentRequest,
  deps: AgentDeps,
  opts: RunAgentOptions = {},
): Promise<{ rateLimited: true } | void> {
  const mode = opts.mode ?? 'group';
  const now = opts.now ?? Date.now();

  // Short request ID — surfaced in both server logs and the user-visible
  // error reply, so a user reporting "I saw error xyz123" can be grepped
  // straight to the originating call instead of guessing by timestamp.
  const reqId = Math.random().toString(36).slice(2, 8);
  if (!checkRate(req.chatId, now, mode)) {
    console.log(`[agent] rate-limited chat=${req.chatId} mode=${mode} req=${reqId}`);
    if (mode === 'p2p') return { rateLimited: true };
    return;
  }

  // Post a "thinking" card up front so the user has immediate feedback that
  // their message landed and the agent is working. We PATCH this same card
  // with the final reply (or error / done indicator) when the loop finishes —
  // keeps the chat clean and avoids leaving a stale loading state.
  const thinkingMessageId = await postCard(
    deps.apiClient,
    req.chatId,
    buildAgentThinkingCard(req.text),
  );

  async function deliver(card: LarkInteractiveCard): Promise<void> {
    if (thinkingMessageId) {
      await patchCard(deps.apiClient, thinkingMessageId, card);
    } else {
      await postCard(deps.apiClient, req.chatId, card);
    }
  }

  const ctx: ToolContext = {
    storage: deps.storage,
    apiClient: deps.apiClient,
    chatId: req.chatId,
    senderOpenId: req.senderOpenId,
    publicUrl: deps.publicUrl,
    triggerSummarize: deps.triggerSummarize
      ? (tr: string) => deps.triggerSummarize!(req.chatId, tr)
      : undefined,
  };

  const messages: AgentMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: req.text },
  ];

  let finalReply: string | null = null;
  let silentMode = false;  // set if any tool returns silent=true (renders own UX)
  /** Last error caught from a tool — surfaced in fallback reply when agent gives up. */
  let lastToolError: { tool: string; message: string } | null = null;
  /** Last tool name that ran successfully — useful in empty-reply fallback. */
  let lastToolSuccess: string | null = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let turn;
    try {
      turn = await callAgentLLM(messages, TOOL_DEFS, {
        model: deps.llmModel,
        apiKey: deps.llmApiKey,
        temperature: 0.3,
        maxTokens: 600,
      });
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      console.error(`[agent] LLM call failed req=${reqId} chat=${req.chatId}: ${msg}`);
      // Categorize for a more helpful user message. The req=<id> tail lets a
      // user reporting "I saw this error" be greppable in pm2 logs.
      if (/429|rate.limit|too many/i.test(msg)) {
        finalReply = `LLM 在限流,稍等几秒再试一下 · The LLM is rate-limited, try again in a few seconds. (req=${reqId})`;
      } else if (/401|403|unauthorized|forbidden|api.key/i.test(msg)) {
        finalReply = `LLM 认证失败 — server 配置有问题,请管理员检查 OPENROUTER_API_KEY · LLM auth failed; admin should check OPENROUTER_API_KEY. (req=${reqId})`;
      } else if (/timeout|timed out|ETIMEDOUT/i.test(msg)) {
        finalReply = `LLM 响应超时 · LLM timed out. 网络抖动或者模型繁忙,稍后再试。 (req=${reqId})`;
      } else {
        finalReply = `LLM 调用失败: ${msg.slice(0, 120)} · LLM call failed. 用 \`/help\` 看命令清单兜底。 (req=${reqId})`;
      }
      break;
    }

    // No tool calls: this is the final answer
    if (turn.toolCalls.length === 0) {
      finalReply = turn.text;
      break;
    }

    // Append assistant turn (with tool_calls) to history
    messages.push({
      role: 'assistant',
      content: turn.text,
      tool_calls: turn.toolCalls.map(tc => ({
        id: tc.id, type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    });

    // Execute each tool, append result
    for (const call of turn.toolCalls) {
      const tool = TOOLS[call.name];
      let result: ToolResult;
      if (!tool) {
        const msg = `unknown tool: ${call.name}`;
        lastToolError = { tool: call.name, message: msg };
        result = { output: JSON.stringify({ error: msg }) };
      } else {
        try {
          result = await tool.execute(call.args, ctx);
          // Detect tool-level error in the JSON output (tools return { error: ... })
          try {
            const parsed = JSON.parse(result.output);
            if (parsed && typeof parsed === 'object' && 'error' in parsed) {
              lastToolError = { tool: call.name, message: String(parsed.error) };
            } else {
              lastToolSuccess = call.name;
            }
          } catch { /* non-JSON output — treat as success */ lastToolSuccess = call.name; }
        } catch (e: any) {
          const msg = e?.message ?? 'tool execution failed';
          console.error(`[agent] tool ${call.name} threw:`, msg);
          lastToolError = { tool: call.name, message: msg };
          result = { output: JSON.stringify({ error: msg }) };
        }
      }
      if (result.silent) silentMode = true;
      console.log(`[agent] chat=${req.chatId} tool=${call.name}${result.silent ? ' (silent)' : ''} args=${JSON.stringify(call.args).slice(0, 200)} → ${result.output.slice(0, 200)}`);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content: result.output,
      });
    }
  }

  // If any tool rendered its own UX (e.g. summarize, help), suppress agent's
  // final reply so we don't double-post — but still patch the thinking card to
  // a "done" state so it doesn't sit as a stale loader at the top of the chat.
  if (silentMode) {
    console.log(`[agent] chat=${req.chatId} silent mode — patching thinking card to done`);
    await deliver(buildAgentSilentDoneCard());
    return;
  }

  if (!finalReply || !finalReply.trim()) {
    // The LLM ran out of rounds without producing a final answer. Give the user
    // a useful clue based on what happened in the last round.
    if (lastToolError) {
      finalReply = `工具 \`${lastToolError.tool}\` 出错: ${lastToolError.message.slice(0, 200)} · The tool returned an error. 试试更具体的说法,或用 \`/help\` 看命令。`;
    } else if (lastToolSuccess) {
      finalReply = `已经调用了 \`${lastToolSuccess}\` 但没整理出回复。换个说法再试一次,或直接用对应的 slash 命令。 · Called \`${lastToolSuccess}\` but couldn't compose a reply.`;
    } else {
      finalReply = '我没明白你想做啥 — 试着更具体一点,或用 `/help` 看命令清单。 · I didn\'t catch that. Try `/help`.';
    }
  }
  if (finalReply.length > MAX_REPLY_CHARS) {
    finalReply = finalReply.slice(0, MAX_REPLY_CHARS) + '…';
  }

  // Patch the thinking card with the final reply (or surface an error card if
  // the LLM call itself failed earlier — both flow through deliver()).
  const replyCard = lastToolError && finalReply.startsWith('工具')
    ? buildErrorCard(finalReply)
    : buildAgentReplyCard(finalReply);
  await deliver(replyCard);
}
