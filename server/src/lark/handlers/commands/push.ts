import type { Storage } from '../../../storage.js';
import type { LarkApiClient } from '../../api-client.js';
import { buildBindingResultCard } from '../../card-builder.js';
import { BOT_NAME } from '../../bot-config.js';
import type { CommandContext } from '../command-router.js';

export interface PushHandlerDeps {
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

function parseToggle(arg: string): boolean | null {
  const v = arg.trim().toLowerCase();
  if (v === 'on' || v === 'enable' || v === '开' || v === '开启') return true;
  if (v === 'off' || v === 'disable' || v === '关' || v === '关闭') return false;
  return null;
}

export function createPushHandler(deps: PushHandlerDeps) {
  return async function handle(ctx: CommandContext): Promise<void> {
    const chatId = ctx.payload?.message?.chat_id;
    if (!chatId) return;
    const binding = await deps.storage.getLarkChatBinding(chatId);
    if (!binding) {
      await send(deps.apiClient, chatId, buildBindingResultCard({
        kind: 'error',
        message: `本群未连接，请先 \`@${BOT_NAME} /connect <tag>\``,
      }));
      return;
    }

    const arg = ctx.arg.trim();
    if (!arg) {
      const state = binding.pushEnabled === true ? '开启' : '关闭';
      await send(deps.apiClient, chatId, buildBindingResultCard({
        kind: 'success',
        message: `当前 router → 群推送：**${state}**\n用 \`@${BOT_NAME} /push on\` / \`@${BOT_NAME} /push off\` 切换`,
      }));
      return;
    }

    const enabled = parseToggle(arg);
    if (enabled === null) {
      await send(deps.apiClient, chatId, buildBindingResultCard({
        kind: 'error',
        message: `用法：\`@${BOT_NAME} /push on\` / \`@${BOT_NAME} /push off\``,
      }));
      return;
    }

    await deps.storage.updateLarkBindingPushEnabled(chatId, enabled);
    await send(deps.apiClient, chatId, buildBindingResultCard({
      kind: 'success',
      message: enabled
        ? `已开启 router → 群推送。新的 entry 会自动出现在群里。`
        : `已关闭 router → 群推送。`,
    }));
  };
}
