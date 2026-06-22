import type { Storage } from '../../storage.js';
import { saveSummary } from '../save-summary.js';
import type { SummaryTokenCache } from '../summary-token-cache.js';
import type { LarkApiClient } from '../api-client.js';
import { buildSavedSummaryCard } from '../card-builder.js';
import { buildSettingsCardForChat } from './commands/settings.js';
import { resolveTeamTag } from '../tag-resolve.js';

export interface CardActionDeps {
  storage: Storage;
  tokenCache?: SummaryTokenCache;
  apiClient?: LarkApiClient;
  publicUrl?: string;
  now?: () => number;
}

export interface CardActionEvent {
  operator: { open_id: string };
  action: {
    value: { action: string; entry_id?: string; summary_token?: string; channel_id?: string; [k: string]: any };
    /** select_static picked option (Lark v1 puts the selected value here, not in action.value). */
    option?: string;
  };
  context: { open_chat_id: string; open_message_id?: string };
}

export interface CardActionResult {
  toast: string;
}

const KNOWN_ENTRY_ACTIONS: ReadonlySet<string> = new Set(['mark_read', 'comment', 'open']);

export async function handleCardAction(ev: CardActionEvent, deps: CardActionDeps): Promise<CardActionResult> {
  const action = ev.action?.value?.action;
  const chatId = ev.context?.open_chat_id;
  const openId = ev.operator?.open_id;
  if (!action || !chatId || !openId) return { toast: '事件不完整' };

  if (action === 'save_summary') {
    return await handleSaveSummary(ev, deps);
  }

  if (action.startsWith('settings.')) {
    return await handleSettingsAction(ev, deps);
  }

  if (KNOWN_ENTRY_ACTIONS.has(action)) {
    const entryId = ev.action?.value?.entry_id;
    if (!entryId) return { toast: '事件不完整' };
    const now = (deps.now ?? Date.now)();
    await deps.storage.recordLarkCardAction({
      entryId, chatId, openId,
      action: action as 'mark_read' | 'comment' | 'open',
      actedAt: now,
    });
    return { toast: action === 'mark_read' ? '已记录已读' : action === 'comment' ? '请在网页继续填写评论' : '已记录打开' };
  }

  return { toast: `未知操作: ${action}` };
}

async function handleSettingsAction(ev: CardActionEvent, deps: CardActionDeps): Promise<CardActionResult> {
  const action = ev.action.value.action;
  const chatId = ev.context.open_chat_id;
  const messageId = ev.context.open_message_id;
  const openId = ev.operator?.open_id;
  const value = ev.action.value;

  let toast = '已更新';
  let needsBinding = false;

  switch (action) {
    case 'settings.connect': {
      // Unbound chat: clicker picks a channel from the dropdown to bind.
      const picked = ev.action.option ?? value.option;
      if (typeof picked !== 'string' || !picked) {
        toast = '⚠️ Pick a channel · 请选 channel';
        break;
      }
      const existing = await deps.storage.getLarkChatBinding(chatId);
      if (existing) {
        toast = `⚠️ Already connected to #${existing.channelId}`;
        break;
      }
      const user = openId ? await deps.storage.getUserByLarkOpenId(openId) : null;
      if (!user) {
        toast = '⚠️ Bind your router account first · 请先在网页绑账号';
        break;
      }
      const resolved = await resolveTeamTag(deps.storage, user.teamId, user.handle, picked);
      if (!resolved) { toast = `⚠️ #${picked} not found in your team`; break; }
      let chatName = '(unknown)';
      if (deps.apiClient) {
        try {
          const info = await deps.apiClient.get<{ name?: string }>(`/open-apis/im/v1/chats/${chatId}`);
          chatName = info.name ?? chatName;
        } catch { /* fall through with placeholder */ }
      }
      await deps.storage.createLarkChatBinding({
        chatId,
        channelId: resolved.id,
        teamId: resolved.teamId,
        boundBy: user.handle,
        boundAt: Date.now(),
        chatName,
        archiveChannelId: resolved.id,
      });
      toast = `✓ Connected to #${resolved.id}`;
      break;
    }
    case 'settings.rebind': {
      // Bound chat: clicker picks a different tag from Switch dropdown.
      // Implemented as delete + create to keep storage interface narrow.
      const picked = ev.action.option ?? value.option;
      if (typeof picked !== 'string' || !picked) {
        toast = '⚠️ Pick a tag · 请选 tag';
        break;
      }
      const existing = await deps.storage.getLarkChatBinding(chatId);
      if (!existing) { needsBinding = true; break; }
      if (picked === existing.channelId) {
        toast = `Already bound to #${picked}`;
        break;
      }
      const user = openId ? await deps.storage.getUserByLarkOpenId(openId) : null;
      if (!user) {
        toast = '⚠️ Bind your router account first · 请先在网页绑账号';
        break;
      }
      const resolved = await resolveTeamTag(deps.storage, user.teamId, user.handle, picked);
      if (!resolved) { toast = `⚠️ #${picked} not found in your team`; break; }
      await deps.storage.deleteLarkChatBinding(chatId);
      await deps.storage.createLarkChatBinding({
        chatId,
        channelId: resolved.id,
        teamId: resolved.teamId,
        boundBy: user.handle,
        boundAt: Date.now(),
        chatName: existing.chatName,
        archiveChannelId: resolved.id,
      });
      toast = `✓ Switched to #${resolved.id} (was #${existing.channelId})`;
      break;
    }
    case 'settings.disconnect': {
      const existing = await deps.storage.getLarkChatBinding(chatId);
      if (!existing) {
        toast = 'Already disconnected · 已解绑';
        break;
      }
      await deps.storage.deleteLarkChatBinding(chatId);
      toast = `✓ Disconnected from #${existing.channelId} · 已解绑`;
      break;
    }
    case 'settings.toggle_push': {
      const next = value.state === 'on';
      const binding = await deps.storage.getLarkChatBinding(chatId);
      if (!binding) { needsBinding = true; break; }
      await deps.storage.updateLarkBindingPushEnabled(chatId, next);
      toast = next ? '✓ Push on · 推送已开' : '🚫 Push off · 推送已关';
      break;
    }
    case 'settings.toggle_watch': {
      const next = value.state === 'on';
      const binding = await deps.storage.getLarkChatBinding(chatId);
      if (!binding) { needsBinding = true; break; }
      await deps.storage.updateLarkBindingWatchEnabled(chatId, next);
      toast = next ? '✓ Watch on · 观察已开' : '🚫 Watch off · 观察已关';
      break;
    }
    case 'settings.set_style': {
      // Lark v1 select_static puts the picked option in ev.action.option (top-level),
      // not under value. value just carries the static action name.
      const picked = ev.action.option ?? value.option ?? value.state;
      if (picked === 'person' || picked === 'topic' || picked === 'free') {
        await deps.storage.setLarkChatStyle(chatId, picked);
        toast = `✓ Style: ${picked}`;
      } else {
        toast = `⚠️ Unknown style option: ${picked}`;
      }
      break;
    }
    case 'settings.toggle_auto_summary': {
      const next = value.state === 'on';
      const cur = await deps.storage.getLarkAutoSummary(chatId);
      await deps.storage.setLarkAutoSummary(chatId, {
        enabled: next,
        cadenceKind: cur?.cadenceKind ?? 'daily',
        cadenceValue: cur?.cadenceValue ?? null,
        fireHour: cur?.fireHour ?? 9,
        setupByOpenId: cur?.setupByOpenId ?? openId ?? null,
      });
      toast = next ? '✓ Auto-summary on · 自动总结已开' : '🚫 Auto-summary off · 自动总结已关';
      break;
    }
    case 'settings.set_auto_cadence': {
      const picked = ev.action.option ?? value.option;
      let kind: 'daily' | 'weekly' | 'hourly';
      let cadenceValue: number | null;
      if (picked === 'daily') { kind = 'daily'; cadenceValue = null; }
      else if (picked === 'weekly') { kind = 'weekly'; cadenceValue = null; }
      else if (picked === 'hourly:6') { kind = 'hourly'; cadenceValue = 6; }
      else if (picked === 'hourly:12') { kind = 'hourly'; cadenceValue = 12; }
      else { toast = `⚠️ Unknown cadence: ${picked}`; break; }
      const cur = await deps.storage.getLarkAutoSummary(chatId);
      await deps.storage.setLarkAutoSummary(chatId, {
        enabled: cur?.enabled ?? false,
        cadenceKind: kind,
        cadenceValue,
        fireHour: cur?.fireHour ?? 9,
        setupByOpenId: cur?.setupByOpenId ?? openId ?? null,
      });
      toast = `✓ Cadence: ${picked}`;
      break;
    }
    case 'settings.set_auto_time': {
      const picked = ev.action.option ?? value.option;
      const hour = typeof picked === 'string' ? parseInt(picked, 10) : NaN;
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        toast = `⚠️ Invalid hour: ${picked}`;
        break;
      }
      const cur = await deps.storage.getLarkAutoSummary(chatId);
      await deps.storage.setLarkAutoSummary(chatId, {
        enabled: cur?.enabled ?? false,
        cadenceKind: cur?.cadenceKind ?? 'daily',
        cadenceValue: cur?.cadenceValue ?? null,
        fireHour: hour,
        setupByOpenId: cur?.setupByOpenId ?? openId ?? null,
      });
      toast = `✓ Time: ${String(hour).padStart(2, '0')}:00 (Asia/Shanghai)`;
      break;
    }
    case 'settings.set_archive': {
      const picked = ev.action.option ?? value.option ?? value.state;
      const binding = await deps.storage.getLarkChatBinding(chatId);
      if (!binding) { needsBinding = true; break; }
      let target: string | null;
      if (picked === '__main__') {
        target = null;  // null = no opinion → /summarize defaults to bound channel
      } else if (picked === '__none__') {
        target = '__none__';  // explicit "no channel" → /summarize Push card defaults to (no tag)
      } else if (typeof picked === 'string' && picked) {
        const resolved = await resolveTeamTag(deps.storage, binding.teamId, binding.boundBy ?? `lark-bot-${binding.teamId}`, picked);
        if (!resolved) { toast = '⚠️ Invalid channel · channel 无效'; break; }
        target = resolved.id;
      } else {
        toast = `⚠️ Unknown archive option: ${picked}`;
        break;
      }
      await deps.storage.updateLarkBindingArchive(chatId, target);
      toast = target === '__none__'
        ? '✓ Archive → (no channel) · 不存任何 channel'
        : target
          ? `✓ Archive → #${target}`
          : '✓ Archive → default · 默认';
      break;
    }
    default:
      return { toast: `未知操作: ${action}` };
  }

  if (needsBinding) {
    return { toast: '⚠️ Connect a channel first · 先 /connect 一个 channel' };
  }

  // Re-render the settings card with fresh state and PATCH it. If this fails,
  // the DB write has already succeeded — but the visual card stays stale
  // (Lark cards don't auto-refresh client-side), which makes a toggled switch
  // look reverted. Tell the user instead of swallowing.
  let patchOk = true;
  let patchSkipReason: string | null = null;
  if (!deps.apiClient) patchSkipReason = 'no apiClient';
  else if (!messageId) patchSkipReason = 'no open_message_id on event';
  if (deps.apiClient && messageId) {
    try {
      const card = await buildSettingsCardForChat(chatId, deps.storage, {
        clickerOpenId: openId,
        publicUrl: deps.publicUrl,
      });
      await deps.apiClient.patch(`/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`, {
        content: JSON.stringify(card),
      });
      console.log(`[settings] PATCH ok action=${action} chat=${chatId} message=${messageId}`);
    } catch (e: any) {
      patchOk = false;
      console.error(`[settings] PATCH failed action=${action} chat=${chatId} message=${messageId}: ${e?.message ?? e}`);
    }
  } else {
    console.warn(`[settings] PATCH skipped action=${action} chat=${chatId} reason=${patchSkipReason}`);
  }

  // When the visual refresh fails, tell the user — otherwise a successful
  // toggle looks reverted (toast says ✓ Push on, but card still shows Off).
  if (!patchOk || patchSkipReason) {
    return { toast: `${toast} (refresh /settings to see new state · 卡片刷新失败,请重发 /settings 查看)` };
  }
  return { toast };
}

async function handleSaveSummary(ev: CardActionEvent, deps: CardActionDeps): Promise<CardActionResult> {
  const token = ev.action?.value?.summary_token;
  const selectedChannelId = ev.action?.value?.channel_id;
  const chatId = ev.context.open_chat_id;
  const openId = ev.operator.open_id;
  if (!token) return { toast: 'Invalid card payload' };
  if (!deps.tokenCache) return { toast: 'Save not enabled' };
  const data = deps.tokenCache.take(token);
  if (!data) return { toast: 'Card expired, please /summarize again' };

  const channelId = selectedChannelId ?? data.defaultArchiveChannelId;
  const useChannel = channelId && channelId !== '__none__' ? channelId : undefined;
  let channelLabel = '(no channel)';

  const organizerUser = await deps.storage.getUserByLarkOpenId(data.organizerOpenId);
  const organizer = organizerUser
    ? `@${organizerUser.handle}`
    : `Lark user(${data.organizerOpenId.slice(-8)})`;

  if (useChannel) {
    const resolved = await resolveTeamTag(
      deps.storage,
      data.teamId,
      organizerUser?.handle ?? `lark-bot-${data.teamId}`,
      useChannel,
    );
    if (!resolved) return { toast: `#${useChannel} not found in your team, pick another or /summarize again` };
    channelLabel = `#${resolved.name}`;
  }

  try {
    const result = await saveSummary({
      storage: deps.storage,
      teamId: data.teamId,
      destinationChannelId: useChannel,
      organizer,
      chatName: data.chatName,
      interpretation: data.interpretation,
      summary: data.summary,
    });
    await deps.storage.recordLarkCardAction({
      entryId: result.entry.id,
      chatId,
      openId,
      action: 'mark_read' as any,
      actedAt: Date.now(),
      payload: { kind: 'save_summary', destination: useChannel ?? null },
    });
    const url = (deps.publicUrl ?? '').replace(/\/$/, '') + `/entry?id=${result.entry.id}`;

    const messageId = ev.context?.open_message_id;
    console.log(`[lark-save] entry=${result.entry.id} messageId=${messageId ?? '<none>'} apiClient=${deps.apiClient ? 'yes' : 'no'}`);
    if (deps.apiClient && messageId) {
      try {
        const savedCard = buildSavedSummaryCard({
          summary: data.summary,
          interpretation: data.interpretation,
          chatName: data.chatName,
          savedBy: organizer,
          channelLabel,
          entryUrl: url,
        });
        const cardJson = JSON.stringify(savedCard);
        console.log(`[lark-save] sending PATCH payload (${cardJson.length} bytes): ${cardJson.slice(0, 500)}`);
        await deps.apiClient.patch(`/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`, {
          content: cardJson,
        });
        console.log(`[lark-save] PATCH success message=${messageId}`);
        // Map this card's message_id to the new entry so native Lark reactions
        // on the card aggregate onto the entry page.
        await deps.storage.recordLarkEntryMessage(messageId, result.entry.id, chatId, Date.now());
      } catch (e: any) {
        console.error('[lark-save] PATCH saved card failed:', e?.message);
      }
    }

    return { toast: `✅ Saved to ${channelLabel} → ${url}` };
  } catch (e: any) {
    console.error('[lark-save] saveSummary failed:', e?.message);
    return { toast: 'Save failed, please retry' };
  }
}
