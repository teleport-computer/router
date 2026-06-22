/**
 * Watch evaluator. Trigger flow:
 *   Each non-bot message → `onMessageForWatch(...)` →
 *     - increment binding.watchMsgCount
 *     - if eligible (enabled + 1h cooldown + ≥20 msgs) → fire `runWatchEvaluation` async
 *
 *   `runWatchEvaluation`:
 *     1. fetch last 3h chat history
 *     2. fetch last 3 past observations as memory
 *     3. call LLM with watch prompt
 *     4. record observations in DB (regardless of post)
 *     5. mark `watchLastRanAt` + reset count
 *     6. if observations non-empty AND post-throttle (2h) cleared → post card
 */

import type { Storage } from '../storage.js';
import type { LarkApiClient } from './api-client.js';
import { fetchChatHistory } from './api-client.js';
import { buildWatchPrompt } from './watch-prompt.js';
import { buildWatchCard } from './card-builder.js';

const COOLDOWN_MS = 60 * 60 * 1000;          // 1h between evaluations
const MIN_MSG_THRESHOLD = 20;
const POST_THROTTLE_MS = 2 * 60 * 60 * 1000; // 2h between posted cards
const HISTORY_WINDOW_MS = 3 * 60 * 60 * 1000;  // 3h of chat fed to LLM
const MEMORY_LIMIT = 3;                        // last 3 observations as memory

export type CallLLM = (prompt: string, opts?: { model?: string; temperature?: number; maxTokens?: number }) => Promise<string>;

export interface WatchDeps {
  storage: Storage;
  apiClient: LarkApiClient;
  callLLM: CallLLM;
  llmModel: string;
  now?: () => number;
  /** Resolves open_id → display name (best effort). */
  resolveName?: (openId: string) => Promise<string>;
}

interface ChatMessageLite {
  senderId: string;
  text: string;
  createTime: number;  // ms
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

function isBotSender(senderId: string, botOpenId: string | undefined): boolean {
  return !!botOpenId && senderId === botOpenId;
}

/**
 * Per-message hook. Increments counter; triggers async evaluation if eligible.
 * Designed to be called from the existing message route — never blocks.
 */
export async function onMessageForWatch(
  payload: any,
  deps: WatchDeps,
  botOpenId: string | undefined,
): Promise<void> {
  const chatId = payload?.message?.chat_id;
  const senderId = payload?.sender?.sender_id?.open_id;
  if (!chatId || !senderId) return;
  if (isBotSender(senderId, botOpenId)) return;  // bot's own messages don't count

  const binding = await deps.storage.getLarkChatBinding(chatId);
  if (!binding || !binding.watchEnabled) return;

  await deps.storage.incrementLarkWatchMsgCount(chatId);

  // re-read after increment so we have the new count
  const updated = await deps.storage.getLarkChatBinding(chatId);
  if (!updated) return;

  const now = (deps.now ?? Date.now)();
  const lastRan = updated.watchLastRanAt ?? 0;
  const msgCount = updated.watchMsgCount ?? 0;

  if (now - lastRan < COOLDOWN_MS) return;
  if (msgCount < MIN_MSG_THRESHOLD) return;

  // Fire-and-forget; don't await.
  runWatchEvaluation(chatId, deps).catch(err =>
    console.error(`[watch] evaluation failed for ${chatId}:`, err?.message ?? err),
  );
}

export async function runWatchEvaluation(chatId: string, deps: WatchDeps): Promise<void> {
  const binding = await deps.storage.getLarkChatBinding(chatId);
  if (!binding) return;
  const now = (deps.now ?? Date.now)();

  // Always update last-ran + reset count BEFORE the LLM call so a slow LLM
  // call doesn't allow a re-trigger with the same window.
  await deps.storage.recordLarkWatchRan(chatId, now);

  const startTs = Math.floor((now - HISTORY_WINDOW_MS) / 1000);
  const endTs = Math.floor(now / 1000);
  const history = await fetchChatHistory(deps.apiClient, {
    chatId, startTs, endTs, cap: 200,
  });
  if (history.messages.length === 0) {
    console.log(`[watch] ${chatId}: no messages in 3h window, skip`);
    return;
  }

  const memory = await deps.storage.listLarkWatchObservationsRecent(chatId, MEMORY_LIMIT);

  const messageBlock = await formatMessages(history.messages, deps.resolveName);

  const prompt = buildWatchPrompt({
    chatName: binding.chatName,
    messageBlock,
    pastObservations: memory.map(m => ({ ranAt: m.ranAt, observations: m.observations })),
    now,
  });

  let observations: { kind: string; content: string; suggested_action?: string | null }[] = [];
  try {
    const raw = await deps.callLLM(prompt, { model: deps.llmModel, temperature: 0.2, maxTokens: 400 });
    const parsed = JSON.parse(stripCodeFence(raw)) as { observations?: any[] };
    observations = (parsed.observations ?? []).slice(0, 1);  // hard cap 1
  } catch (e: any) {
    console.error(`[watch] LLM parse failed for ${chatId}:`, e?.message ?? e);
    return;
  }

  if (observations.length === 0) {
    console.log(`[watch] ${chatId}: LLM returned empty, silent`);
    return;
  }

  // Persist observations as memory (always, even if we don't post — so next
  // eval knows we already saw it).
  await deps.storage.recordLarkWatchObservations(chatId, now, observations as any);

  const lastPosted = binding.watchLastPostedAt ?? 0;
  if (now - lastPosted < POST_THROTTLE_MS) {
    console.log(`[watch] ${chatId}: post-throttle (${Math.floor((now - lastPosted) / 60_000)}min < 2h), silent`);
    return;
  }

  const card = buildWatchCard({ observation: observations[0] });
  try {
    await deps.apiClient.post('/open-apis/im/v1/messages?receive_id_type=chat_id', {
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    });
    await deps.storage.recordLarkWatchPosted(chatId, now);
    console.log(`[watch] ${chatId}: posted ${observations[0].kind}`);
  } catch (e: any) {
    console.error(`[watch] post failed for ${chatId}:`, e?.message ?? e);
  }
}

async function formatMessages(
  messages: ChatMessageLite[],
  resolveName?: (openId: string) => Promise<string>,
): Promise<string> {
  const cache = new Map<string, string>();
  const lines: string[] = [];
  for (const m of messages) {
    let name = cache.get(m.senderId);
    if (!name) {
      try {
        name = resolveName ? await resolveName(m.senderId) : `用户${m.senderId.slice(-6)}`;
      } catch {
        name = `用户${m.senderId.slice(-6)}`;
      }
      cache.set(m.senderId, name);
    }
    const t = new Date(m.createTime).toLocaleTimeString('zh-CN', { hour12: false });
    lines.push(`[${t}] @${name}: ${m.text}`);
  }
  return lines.join('\n');
}
