import type { Storage } from '../../../storage.js';
import type { LarkApiClient } from '../../api-client.js';
import { buildSettingsCard } from '../../card-builder.js';
import { listTeamTags } from '../../tag-resolve.js';
import type { CommandContext } from '../command-router.js';

export interface SettingsHandlerDeps {
  storage: Storage;
  apiClient: LarkApiClient;
  publicUrl?: string;
}

/**
 * Build the settings card payload for a chat by fetching current state from
 * storage. Used by both the `/settings` command (POST a fresh card) and the
 * card-action handler (PATCH the existing card after a setting change).
 *
 * `clickerOpenId` is the Lark open_id of whoever invoked /settings or pressed
 * a card button. When the chat has no binding yet, we use it to surface a
 * Connect dropdown filtered to the clicker's team. When omitted, we render
 * the unbound state without the dropdown (just the hint).
 */
export async function buildSettingsCardForChat(
  chatId: string,
  storage: Storage,
  opts: { clickerOpenId?: string; publicUrl?: string; now?: number } = {},
) {
  const now = opts.now ?? Date.now();
  const binding = await storage.getLarkChatBinding(chatId);
  const style = (await storage.getLarkChatStyle(chatId)) ?? 'person';
  const autoPrefs = await storage.getLarkAutoSummary(chatId);

  let boundChannel: { id: string; name: string } | null = null;
  let availableChannels: Array<{ id: string; name: string }> = [];
  let connectableChannels: Array<{ id: string; name: string }> | undefined;
  let clickerNeedsRouterAccount = false;

  if (binding) {
    const channel = await storage.getChannel(binding.channelId);
    boundChannel = channel ? { id: channel.id, name: channel.name } : { id: binding.channelId, name: binding.channelId };
    availableChannels = await listTeamTags(storage, binding.teamId);
  } else if (opts.clickerOpenId) {
    // Unbound chat: show a connect dropdown scoped to the clicker's team.
    const clicker = await storage.getUserByLarkOpenId(opts.clickerOpenId);
    if (!clicker) {
      clickerNeedsRouterAccount = true;
    } else {
      connectableChannels = await listTeamTags(storage, clicker.teamId);
    }
  }

  // archive_channel_id semantics:
  //   null/undefined → use bound channel (display as __main__)
  //   '__none__'     → explicit "no channel"
  //   else           → real channel id (or fallback to __main__ if same as bound)
  let archiveSelected = '__main__';
  if (binding?.archiveChannelId === '__none__') {
    archiveSelected = '__none__';
  } else if (binding?.archiveChannelId && binding.archiveChannelId !== binding.channelId) {
    archiveSelected = binding.archiveChannelId;
  }

  // Auto-summary: present a default view even when never configured so the
  // user has buttons to interact with. cadenceValue==null treated as defaults
  // (daily, 9am).
  const autoSummary = {
    enabled: !!autoPrefs?.enabled,
    cadence:
      autoPrefs?.cadenceKind === 'hourly'
        ? (autoPrefs.cadenceValue === 12 ? ('hourly:12' as const) : ('hourly:6' as const))
        : autoPrefs?.cadenceKind === 'weekly'
          ? ('weekly' as const)
          : ('daily' as const),
    fireHour: autoPrefs?.fireHour ?? 9,
  };

  return buildSettingsCard({
    chatId,
    boundChannel,
    lastSummaryAt: binding?.lastSummaryAt ?? null,
    pushEnabled: binding?.pushEnabled === true,
    watchEnabled: !!binding?.watchEnabled,
    summaryStyle: style,
    archiveSelected,
    availableChannels,
    connectableChannels,
    clickerNeedsRouterAccount,
    publicUrl: opts.publicUrl,
    autoSummary,
    now,
  });
}

export function createSettingsHandler(deps: SettingsHandlerDeps) {
  return async function handle(ctx: CommandContext): Promise<void> {
    const chatId = ctx.payload?.message?.chat_id;
    const clickerOpenId = ctx.payload?.sender?.sender_id?.open_id;
    if (!chatId) return;
    const card = await buildSettingsCardForChat(chatId, deps.storage, {
      clickerOpenId,
      publicUrl: deps.publicUrl,
    });
    await deps.apiClient.post('/open-apis/im/v1/messages?receive_id_type=chat_id', {
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    });
  };
}
