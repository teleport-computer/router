import type { LarkApiClient } from '../../api-client.js';
import { buildHelpCard } from '../../card-builder.js';
import type { CommandContext } from '../command-router.js';

export function createHelpHandler(deps: { apiClient: LarkApiClient }) {
  return async function handle(ctx: CommandContext): Promise<void> {
    const chatId = ctx.payload?.message?.chat_id;
    if (!chatId) return;
    await deps.apiClient.post('/open-apis/im/v1/messages?receive_id_type=chat_id', {
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(buildHelpCard()),
    });
  };
}
