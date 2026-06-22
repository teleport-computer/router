/**
 * notification-bridge — push router notifications to Lark IM as a side channel.
 *
 * Fire-and-forget by design: any failure (no binding, prefs off, lark down,
 * token expired) is swallowed + logged. Caller (addNotification wrapper) MUST
 * never await this in a way that propagates errors.
 */

import type { LarkApiClient } from './api-client.js';
import type { Storage, Notification, LarkNotificationPrefs } from '../storage.js';
import { buildNotificationCard } from './card-builder.js';

export interface NotificationBridgeDeps {
  storage: Pick<Storage, 'getUser' | 'getEntry'>;
  apiClient: LarkApiClient;
  publicUrl: string;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

// 'weekly_brief' (and legacy 'digest') are intentionally NOT here — Concierge
// cron handles its own Lark push (custom card layout via buildWeeklyBriefCard);
// this bridge only handles the entry-bound notification types that share
// buildNotificationCard.
const PUSHED_TYPES = new Set<Notification['type']>(['mention', 'comment', 'reply']);

function prefsAllow(type: Notification['type'], prefs?: LarkNotificationPrefs): boolean {
  if (!prefs) return true; // empty prefs => all on
  const v = (prefs as Record<string, boolean | undefined>)[type];
  return v === undefined ? true : v === true;
}

function buildLink(publicUrl: string, n: Notification): string {
  const base = publicUrl.replace(/\/$/, '');
  if (!n.entryId) return base;
  const url = `${base}/entry?id=${encodeURIComponent(n.entryId)}`;
  if ((n.type === 'comment' || n.type === 'reply') && n.commentId) {
    return `${url}#comment-${encodeURIComponent(n.commentId)}`;
  }
  return url;
}

export async function pushNotificationToLark(
  notification: Notification,
  deps: NotificationBridgeDeps,
): Promise<void> {
  const log = deps.log ?? ((lvl, m) => console[lvl === 'info' ? 'log' : lvl](`[notif-bridge] ${m}`));
  try {
    if (!PUSHED_TYPES.has(notification.type)) return;
    if (notification.fromHandle === notification.recipientHandle) return;

    const recipient = await deps.storage.getUser(notification.recipientHandle);
    if (!recipient) return;
    if (!recipient.larkOpenId) return;
    if (!prefsAllow(notification.type, recipient.larkNotificationPrefs)) return;

    let channel: string | undefined;
    if (notification.entryId) {
      const entry = await deps.storage.getEntry(notification.entryId);
      channel = entry?.channel;
    }

    const link = buildLink(deps.publicUrl, notification);
    const card = buildNotificationCard({
      type: notification.type as 'mention' | 'comment' | 'reply',
      fromHandle: notification.fromHandle,
      preview: notification.preview,
      channel,
      link,
    });

    await deps.apiClient.post(
      '/open-apis/im/v1/messages?receive_id_type=open_id',
      {
        receive_id: recipient.larkOpenId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    );
  } catch (e: any) {
    log('warn', `push failed for ${notification.id}: ${e?.message ?? e}`);
  }
}
