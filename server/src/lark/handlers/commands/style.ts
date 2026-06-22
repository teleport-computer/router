import type { Storage } from '../../../storage.js';
import type { LarkApiClient } from '../../api-client.js';
import { buildBindingResultCard } from '../../card-builder.js';
import { BOT_NAME } from '../../bot-config.js';
import type { CommandContext } from '../command-router.js';

export interface StyleHandlerDeps {
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

const STYLE_LABELS: Record<string, string> = {
  person: '👤 person — 谁做的事开头("@hx 分享 X / Y")',
  topic: '🏷️ topic — 主题开头,作者尾标("X / Y — @hx")',
  free: '✨ free — 无格式约束,LLM 自由发挥',
};

function parseStyle(arg: string): 'person' | 'topic' | 'free' | null {
  const v = arg.trim().toLowerCase();
  if (v === 'person' || v === '人' || v === '人物') return 'person';
  if (v === 'topic' || v === '主题' || v === '话题') return 'topic';
  if (v === 'free' || v === '自由' || v === '无') return 'free';
  return null;
}

export function createStyleHandler(deps: StyleHandlerDeps) {
  return async function handle(ctx: CommandContext): Promise<void> {
    const chatId = ctx.payload?.message?.chat_id;
    if (!chatId) return;
    // /style is a per-chat bot setting — works whether or not the chat is
    // bound to a router channel. Stored in lark_chat_prefs (chat-keyed).

    const arg = ctx.arg.trim();
    if (!arg) {
      const current = (await deps.storage.getLarkChatStyle(chatId)) ?? 'person';
      await send(deps.apiClient, chatId, buildBindingResultCard({
        kind: 'success',
        message: [
          `**当前总结风格:** ${STYLE_LABELS[current]}`,
          ``,
          `**可选风格:**`,
          `• \`@${BOT_NAME} /style person\` — ${STYLE_LABELS.person.split(' — ')[1]}`,
          `• \`@${BOT_NAME} /style topic\` — ${STYLE_LABELS.topic.split(' — ')[1]}`,
          `• \`@${BOT_NAME} /style free\` — ${STYLE_LABELS.free.split(' — ')[1]}`,
        ].join('\n'),
      }));
      return;
    }

    const next = parseStyle(arg);
    if (next === null) {
      await send(deps.apiClient, chatId, buildBindingResultCard({
        kind: 'error',
        message: `用法: \`@${BOT_NAME} /style person|topic|free\``,
      }));
      return;
    }

    await deps.storage.setLarkChatStyle(chatId, next);
    await send(deps.apiClient, chatId, buildBindingResultCard({
      kind: 'success',
      message: `总结风格切到 **${STYLE_LABELS[next]}**。下次 \`/summarize\` 起生效。`,
    }));
  };
}
