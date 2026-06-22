import type { Storage } from '../../../storage.js';
import type { LarkApiClient } from '../../api-client.js';
import { buildBindingResultCard } from '../../card-builder.js';
import { BOT_NAME } from '../../bot-config.js';
import type { CommandContext } from '../command-router.js';

export interface WatchHandlerDeps {
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

function fmtElapsed(ts: number | undefined, now: number): string {
  if (!ts) return '从未';
  const ms = now - ts;
  if (ms < 60_000) return '刚刚';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
  return `${Math.floor(ms / 86_400_000)} 天前`;
}

export function createWatchHandler(deps: WatchHandlerDeps, now: () => number = Date.now) {
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
      const state = binding.watchEnabled ? '✅ 开启' : '⏸️ 关闭';
      const lastRan = fmtElapsed(binding.watchLastRanAt, now());
      const lastPosted = fmtElapsed(binding.watchLastPostedAt, now());
      const msgs = binding.watchMsgCount ?? 0;
      await send(deps.apiClient, chatId, buildBindingResultCard({
        kind: 'success',
        message: [
          `**Watch:** ${state}`,
          `上次评估：${lastRan}`,
          `上次发卡：${lastPosted}`,
          `当前累积消息：${msgs} 条 (达 20 条且距上次评估 ≥1h 才会触发)`,
          '',
          `\`@${BOT_NAME} /watch on\` 开 / \`@${BOT_NAME} /watch off\` 关`,
        ].join('\n'),
      }));
      return;
    }

    const toggle = parseToggle(arg);
    if (toggle === null) {
      await send(deps.apiClient, chatId, buildBindingResultCard({
        kind: 'error',
        message: `用法：\`@${BOT_NAME} /watch on\` / \`@${BOT_NAME} /watch off\``,
      }));
      return;
    }

    await deps.storage.updateLarkBindingWatchEnabled(chatId, toggle);
    await send(deps.apiClient, chatId, buildBindingResultCard({
      kind: 'success',
      message: toggle
        ? '已开启 watch。bot 会在群里活跃时偷偷观察，**只在觉得真的值得提醒** 才发卡，否则完全静默。'
        : '已关闭 watch。',
    }));
  };
}
