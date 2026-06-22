import type { Storage } from '../../../storage.js';
import type { LarkApiClient } from '../../api-client.js';
import { buildBindingResultCard } from '../../card-builder.js';
import type { CommandContext } from '../command-router.js';

export interface DisconnectHandlerDeps {
  storage: Storage;
  apiClient: LarkApiClient;
}

async function send(apiClient: LarkApiClient, chatId: string, card: any): Promise<void> {
  await apiClient.post('/open-apis/im/v1/messages?receive_id_type=chat_id', {
    receive_id: chatId,
    msg_type: 'interactive',
    content: JSON.stringify(card),
  });
}

export function createDisconnectHandler(deps: DisconnectHandlerDeps) {
  return async function handle(ctx: CommandContext): Promise<void> {
    const chatId = ctx.payload?.message?.chat_id;
    const openId = ctx.payload?.sender?.sender_id?.open_id;
    if (!chatId || !openId) return;

    const binding = await deps.storage.getLarkChatBinding(chatId);
    if (!binding) {
      await send(deps.apiClient, chatId, buildBindingResultCard({ kind: 'error', message: '本群未连接到任何 tag' }));
      return;
    }
    const user = await deps.storage.getUserByLarkOpenId(openId);
    if (!user) {
      await send(deps.apiClient, chatId, buildBindingResultCard({ kind: 'error', message: '请先绑定 router 账号后再操作' }));
      return;
    }
    // Channels are team-public — team membership suffices.
    if (binding.teamId !== user.teamId) {
      await send(deps.apiClient, chatId, buildBindingResultCard({ kind: 'error', message: `本群绑定不在你的 team` }));
      return;
    }
    await deps.storage.deleteLarkChatBinding(chatId);
    await send(deps.apiClient, chatId, buildBindingResultCard({ kind: 'success', message: `已解绑「${binding.chatName}」与 \`#${binding.channelId}\`` }));
  };
}
