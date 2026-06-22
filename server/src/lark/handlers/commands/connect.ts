import type { Storage } from '../../../storage.js';
import type { LarkApiClient } from '../../api-client.js';
import { buildBindingResultCard } from '../../card-builder.js';
import { BOT_NAME } from '../../bot-config.js';
import { resolveTeamTag } from '../../tag-resolve.js';
import type { CommandContext } from '../command-router.js';

export interface ConnectHandlerDeps {
  storage: Storage;
  apiClient: LarkApiClient;
  publicUrl: string;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

async function send(apiClient: LarkApiClient, chatId: string, card: any): Promise<void> {
  await apiClient.post('/open-apis/im/v1/messages?receive_id_type=chat_id', {
    receive_id: chatId,
    msg_type: 'interactive',
    content: JSON.stringify(card),
  });
}

export function createConnectHandler(deps: ConnectHandlerDeps) {
  const log = deps.log ?? ((lvl, m) => console[lvl === 'info' ? 'log' : lvl](`[lark-connect] ${m}`));

  return async function handle(ctx: CommandContext): Promise<void> {
    const chatId = ctx.payload?.message?.chat_id;
    const openId = ctx.payload?.sender?.sender_id?.open_id;
    if (!chatId || !openId) return;
    const channelArg = ctx.arg.trim();
    if (!channelArg) {
      await send(deps.apiClient, chatId, buildBindingResultCard({ kind: 'error', message: `用法：\`@${BOT_NAME} /connect <tag>\`` }));
      return;
    }

    // Step 1: lookup clicker's router account by open_id
    const user = await deps.storage.getUserByLarkOpenId(openId);
    if (!user) {
      await send(deps.apiClient, chatId, buildBindingResultCard({
        kind: 'error',
        message: `请先到 router 网页 [${deps.publicUrl}](${deps.publicUrl}) 绑定 Lark 账号后再来连接。`,
      }));
      return;
    }

    // Step 2: resolve tag inside user's team (accepts entry-only tags too,
    // auto-upserting a tag_config row when needed).
    const resolved = await resolveTeamTag(deps.storage, user.teamId, user.handle, channelArg);
    if (!resolved) {
      await send(deps.apiClient, chatId, buildBindingResultCard({ kind: 'error', message: `找不到 tag \`#${channelArg}\`` }));
      return;
    }

    // Step 3: already bound?
    const existing = await deps.storage.getLarkChatBinding(chatId);
    if (existing) {
      await send(deps.apiClient, chatId, buildBindingResultCard({
        kind: 'error',
        message: `本群已绑 \`#${existing.channelId}\`，请先 \`@${BOT_NAME} /disconnect\` 再连接新的`,
      }));
      return;
    }

    // Fetch chat name
    let chatName = '(未知群)';
    try {
      const info = await deps.apiClient.get<{ name?: string }>(`/open-apis/im/v1/chats/${chatId}`);
      chatName = info.name ?? chatName;
    } catch (e: any) {
      log('warn', `chat name fetch failed for ${chatId}: ${e?.message}`);
    }

    // Create binding (archive defaults to primary channel)
    await deps.storage.createLarkChatBinding({
      chatId,
      channelId: resolved.id,
      teamId: resolved.teamId,
      boundBy: user.handle,
      boundAt: Date.now(),
      chatName,
      archiveChannelId: resolved.id,
    });

    log('info', `bound chat=${chatId} → channel=${resolved.id} by ${user.handle}`);
    await send(deps.apiClient, chatId, buildBindingResultCard({
      kind: 'success',
      message: `已连接「${chatName}」到 \`#${resolved.name}\``,
      publicUrl: deps.publicUrl,
      channelId: resolved.id,
    }));
  };
}
