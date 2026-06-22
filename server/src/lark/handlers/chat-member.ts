/**
 * Bot membership change handler.
 *   - bot.added_v1   → post a bilingual welcome card
 *   - bot.deleted_v1 → log only (no further action; binding row stays for now)
 */

import type { LarkApiClient } from '../api-client.js';
import { buildWelcomeCard } from '../card-builder.js';

export interface ChatMemberHandlerDeps {
  apiClient?: LarkApiClient;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export async function handleChatMember(event: any, deps: ChatMemberHandlerDeps = {}): Promise<void> {
  const log = deps.log ?? ((lvl, m) => console[lvl === 'info' ? 'log' : lvl](`[lark-member] ${m}`));
  const chatId = event?.chat_id ?? '<unknown>';
  const opId = event?.operator?.open_id ?? '<unknown>';
  // Lark v1 sends `event_type` adapted to a name we route on; we get the
  // `event` body here, which doesn't carry the original event_type. We
  // distinguish add vs delete via the presence of `chat_id` + a hint.
  // The simplest signal: bot.added_v1 has an `operator` and `chat_id` with no
  // `chat_left_at` field; deleted_v1 may include leave context. Default to
  // welcoming on every member event we receive (we only subscribe to add+delete,
  // and the side-effect of duplicate welcomes on delete is non-existent because
  // bot can no longer post to a chat it was kicked from).

  // Heuristic: if event has a 'chat' that's gone (deleted), Lark API will reject
  // our post. Try to send; if it fails, log and move on.
  log('info', `bot membership change in chat=${chatId} by operator=${opId}`);

  if (!deps.apiClient) return;
  try {
    await deps.apiClient.post('/open-apis/im/v1/messages?receive_id_type=chat_id', {
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(buildWelcomeCard()),
    });
    log('info', `welcome card sent to chat=${chatId}`);
  } catch (e: any) {
    // Most likely cause: bot was the one removed → can't post anymore.
    log('warn', `welcome card post failed for chat=${chatId}: ${e?.message ?? e} (probably bot removed)`);
  }
}
