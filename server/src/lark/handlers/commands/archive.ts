import type { Storage } from '../../../storage.js';
import type { LarkApiClient } from '../../api-client.js';
import { buildBindingResultCard } from '../../card-builder.js';
import { BOT_NAME } from '../../bot-config.js';
import { resolveTeamTag } from '../../tag-resolve.js';
import type { CommandContext } from '../command-router.js';

export interface ArchiveHandlerDeps {
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

export function createArchiveHandler(deps: ArchiveHandlerDeps) {
  return async function handle(ctx: CommandContext): Promise<void> {
    const chatId = ctx.payload?.message?.chat_id;
    const openId = ctx.payload?.sender?.sender_id?.open_id;
    if (!chatId || !openId) return;
    const archiveArg = ctx.arg.trim();
    if (!archiveArg) {
      await send(deps.apiClient, chatId, buildBindingResultCard({ kind: 'error', message: `用法：\`@${BOT_NAME} /archive <tag>\`` }));
      return;
    }

    const binding = await deps.storage.getLarkChatBinding(chatId);
    if (!binding) {
      await send(deps.apiClient, chatId, buildBindingResultCard({ kind: 'error', message: `本群未连接，请先 \`@${BOT_NAME} /connect <tag>\`` }));
      return;
    }
    const user = await deps.storage.getUserByLarkOpenId(openId);
    if (!user) {
      await send(deps.apiClient, chatId, buildBindingResultCard({ kind: 'error', message: '请先绑定 router 账号后再操作' }));
      return;
    }
    const resolved = await resolveTeamTag(deps.storage, user.teamId, user.handle, archiveArg);
    if (!resolved) {
      await send(deps.apiClient, chatId, buildBindingResultCard({ kind: 'error', message: `找不到 tag \`#${archiveArg}\`` }));
      return;
    }
    await deps.storage.updateLarkBindingArchive(chatId, resolved.id);
    await send(deps.apiClient, chatId, buildBindingResultCard({ kind: 'success', message: `总结归档目标改为 \`#${resolved.name}\`` }));
  };
}
