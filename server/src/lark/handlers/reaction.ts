/**
 * Native Lark reaction events on bot-sent messages (entry cards / summary cards).
 *
 * Lark v2 event payload shape (im.message.reaction.created_v1 / deleted_v1):
 *   {
 *     message_id: 'om_xxx',
 *     reaction_type: { emoji_type: 'THUMBSUP' },
 *     operator_type: 'user',
 *     user_id: { open_id: 'ou_xxx', union_id: 'on_xxx', user_id: '' },
 *     action_time: '1745960000',
 *   }
 *
 * v1 events use a slightly different shape; we adapt minimally.
 *
 * MVP: just record raw events to lark_message_reactions. Linking message_id →
 * entry_id (for showing reaction summaries on entry pages) is a follow-up that
 * needs message_id capture in pushBoundLarkChats.
 */

import type { Storage } from '../../storage.js';

export interface ReactionHandlerDeps {
  storage: Storage;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export async function handleReaction(
  event: any,
  kind: 'added' | 'removed',
  deps: ReactionHandlerDeps,
): Promise<void> {
  const log = deps.log ?? ((lvl, m) => console[lvl === 'info' ? 'log' : lvl](`[lark-reaction] ${m}`));

  const messageId = event?.message_id;
  const emojiType = event?.reaction_type?.emoji_type ?? '<unknown>';
  // user_id can be an object { open_id, union_id, user_id } or a string in older events
  const openId = typeof event?.user_id === 'string'
    ? event.user_id
    : event?.user_id?.open_id ?? '<unknown>';
  // chat_id isn't always in the reaction event payload — try a few paths.
  const chatId = event?.chat_id ?? event?.chat?.chat_id ?? '<unknown>';
  // action_time arrives as string seconds in v2; coerce to ms
  const tRaw = event?.action_time;
  const reactedAt = tRaw
    ? (String(tRaw).length > 10 ? Number(tRaw) : Number(tRaw) * 1000)
    : Date.now();

  if (!messageId) {
    log('warn', `reaction event missing message_id: ${JSON.stringify(event).slice(0, 200)}`);
    return;
  }

  log('info', `${kind} ${emojiType} on msg=${messageId} by ${openId}`);

  try {
    await deps.storage.recordLarkMessageReaction({
      chatId, messageId, openId, emojiType, action: kind, reactedAt,
    });
  } catch (e: any) {
    log('error', `failed to record reaction: ${e?.message ?? e}`);
  }
}
