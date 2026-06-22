/**
 * Teleport Router — Channel Skill Effects + Lark Bot push
 *
 * Two parallel concerns:
 *   1. `pushBoundLarkChats`: binding-driven push of entry cards into bound
 *      Lark groups (the canonical router→Lark path).
 *   2. `runEffects`: skill-driven effects — `lark_webhook` (incoming-webhook
 *      style, suppressed when a binding exists for the same channel) and
 *      `http_post` (arbitrary HTTP endpoint).
 *
 * The web SkillForm currently hides the `lark_webhook` configuration UI; the
 * runtime path is preserved so existing skill configs and API/MCP-created ones
 * continue to work, and so we can re-enable the UI later.
 */

import type { RouterEntry, Channel, SkillEffect, Storage } from './storage.js';
import { tagConfigToChannel } from './storage.js';
import { buildEntryCard } from './lark/card-builder.js';
import type { LarkApiClient } from './lark/api-client.js';
import { requireEnv } from './env.js';

const PUBLIC_URL = requireEnv('PUBLIC_URL').replace(/\/$/, '');

function entryLink(entry: RouterEntry): string {
  return `${PUBLIC_URL}/entry?id=${entry.id}`;
}

export interface LarkCardMessage {
  msg_type: 'interactive';
  card: {
    header: { title: { tag: string; content: string }; template: string };
    elements: Array<{ tag: string; content?: string; text?: { tag: string; content: string } }>;
  };
}

export function buildLarkCard(entry: RouterEntry, channelName: string): LarkCardMessage {
  const tagStr = entry.tags.map(t => `\`#${t}\``).join('  ');
  const roleStr = entry.role ? `[${entry.role}] ` : '';
  const time = new Date(entry.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const link = entryLink(entry);

  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: `#${channelName} · @${entry.handle} synced` },
        template: 'blue',
      },
      elements: [
        { tag: 'markdown', content: `${roleStr}${entry.summary}` },
        { tag: 'markdown', content: tagStr },
        { tag: 'markdown', content: `[查看详情 →](${link})` },
        { tag: 'note', elements: [{ tag: 'plain_text', content: time }] } as any,
      ],
    },
  };
}

export async function postToWebhook(
  webhookUrl: string,
  payload: any,
  maxRetries = 3,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) return true;
      if (res.status >= 400 && res.status < 500) {
        console.error(`[Webhook] ${res.status} from ${webhookUrl}: ${await res.text()}`);
        return false;
      }
      console.warn(`[Webhook] Attempt ${attempt}/${maxRetries} failed: ${res.status}`);
    } catch (err) {
      console.warn(`[Webhook] Attempt ${attempt}/${maxRetries} error:`, err);
    }
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  console.error(`[Webhook] All ${maxRetries} attempts failed for ${webhookUrl}`);
  return false;
}

export interface RunEffectsDeps {
  larkApiClient?: LarkApiClient | null;
  storage?: Pick<Storage, 'listLarkChatBindingsByChannel' | 'recordLarkEntryMessage'>;
}

function isLarkBotEntry(entry: RouterEntry): boolean {
  return typeof entry.handle === 'string' && entry.handle.startsWith('lark-bot-');
}

/**
 * Push entry card to all Lark groups bound to this channel that haven't opted
 * **opted in** via `pushEnabled=true`. Default is OFF — group has to opt in
 * config — binding presence + push toggle is the only gate.
 */
export async function pushBoundLarkChats(
  entry: RouterEntry,
  channel: Channel,
  deps: RunEffectsDeps,
): Promise<void> {
  if (!deps.larkApiClient || !deps.storage) return;
  if (isLarkBotEntry(entry)) return;  // loop prevention: don't echo bot-saved entries
  if (entry.publishAt && entry.publishAt > Date.now()) return;

  const bindings = await deps.storage.listLarkChatBindingsByChannel(channel.id);
  const targets = bindings.filter(b => b.pushEnabled === true);
  if (targets.length === 0) return;

  const card = buildEntryCard({ entry, channelName: channel.name, publicUrl: PUBLIC_URL });
  await Promise.all(targets.map(async b => {
    try {
      const resp = await deps.larkApiClient!.post<{ message_id?: string }>(
        '/open-apis/im/v1/messages?receive_id_type=chat_id',
        {
          receive_id: b.chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      );
      // Capture message_id ↔ entry_id so native Lark reactions on this card
      // can later be aggregated back onto the entry's web page.
      if (resp?.message_id && deps.storage?.recordLarkEntryMessage) {
        await deps.storage.recordLarkEntryMessage(resp.message_id, entry.id, b.chatId, Date.now());
      }
    } catch (e: any) {
      console.error(`[push-bot] push to ${b.chatId} failed:`, e?.message ?? e);
    }
  }));
}

/**
 * Run skill effects (`lark_webhook` and `http_post`) against an entry. The
 * Lark bot push path lives in `pushBoundLarkChats`; when a binding exists for
 * the channel, `lark_webhook` is suppressed (bot path overrides legacy webhook).
 */
export async function runEffects(
  entry: RouterEntry,
  channel: Channel,
  effects: SkillEffect[],
  deps: RunEffectsDeps = {},
): Promise<void> {
  if (isLarkBotEntry(entry)) return;
  if (entry.publishAt && entry.publishAt > Date.now()) return;

  let hasBinding = false;
  if (deps.storage && deps.larkApiClient) {
    const b = await deps.storage.listLarkChatBindingsByChannel(channel.id);
    hasBinding = b.length > 0;
  }

  const link = entryLink(entry);
  for (const effect of (effects ?? [])) {
    if (effect.type === 'lark_webhook') {
      if (hasBinding) continue;  // bot path overrides legacy webhook
      const payload = effect.template === 'text'
        ? { msg_type: 'text', content: { text: `[#${channel.name}] ${entry.summary}\n${link}` } }
        : buildLarkCard(entry, channel.name);
      postToWebhook(effect.url, payload).catch(err =>
        console.error(`[Effects] lark_webhook failed for #${channel.id}:`, err),
      );
    } else if (effect.type === 'http_post') {
      const body = JSON.stringify({ entry, channel: { id: channel.id, name: channel.name }, link });
      const headers = { 'Content-Type': 'application/json', ...(effect.headers || {}) };
      fetch(effect.url, { method: 'POST', headers, body }).catch(err =>
        console.error(`[Effects] http_post failed for #${channel.id}:`, err),
      );
    }
  }
}

/**
 * For each entry: (1) push to bound Lark chats (binding-driven); (2) walk
 * channel skills and fire effects on matching `on_entry_write` triggers.
 */
export async function evaluateChannelTriggers(
  entry: RouterEntry,
  channel: Channel,
  markFired: (entryId: string) => Promise<void>,
  deps: RunEffectsDeps = {},
): Promise<void> {
  await pushBoundLarkChats(entry, channel, deps);

  for (const skill of channel.skills) {
    const triggers = skill.triggers || [];
    for (const trigger of triggers) {
      if (trigger.type === 'cron') continue;
      if (trigger.type === 'manual') continue;
      if (trigger.type === 'on_entry_write') {
        const filter = trigger.filter;
        const hasTagFilter = !!(filter?.tags && filter.tags.length > 0);
        const hasAuthorFilter = !!(filter?.authors && filter.authors.length > 0);
        if (hasTagFilter || hasAuthorFilter) {
          const tagMatch = hasTagFilter
            ? filter!.tags!.some(t => entry.tags.includes(t))
            : false;
          const authorMatch = hasAuthorFilter
            ? filter!.authors!.includes(entry.handle)
            : false;
          if (!tagMatch && !authorMatch) continue;
        }
        await runEffects(entry, channel, skill.effects || [], deps);
        break;
      }
    }
  }
  await markFired(entry.id);
}

/**
 * Multi-tag orchestrator for the new tag-unification model.
 *
 * Walks each unique tag mentioned by the entry — `entry.tags[]` plus the
 * legacy `entry.channel` (which is being deprecated but still appears on
 * pre-migration rows). For each tag with a `tag_configs` row, runs
 * `evaluateChannelTriggers` against the tag-as-channel projection.
 *
 * Returns the list of tag names whose configs were considered — used by
 * `router_write` to populate `triggered_tags` in the response so callers
 * can audit fan-out.
 */
export async function evaluateTagTriggers(
  entry: RouterEntry,
  storage: Pick<Storage, 'getTagConfig' | 'listLarkChatBindingsByChannel' | 'recordLarkEntryMessage'>,
  markFired: (entryId: string) => Promise<void>,
  deps: RunEffectsDeps = {},
): Promise<string[]> {
  const candidates = new Set<string>(entry.tags ?? []);
  if (entry.channel) candidates.add(entry.channel);
  if (candidates.size === 0) {
    await markFired(entry.id);
    return [];
  }

  const fired: string[] = [];
  for (const tag of candidates) {
    const cfg = await storage.getTagConfig(entry.teamId, tag);
    if (!cfg) continue;
    const channel = tagConfigToChannel(cfg);
    try {
      await evaluateChannelTriggers(entry, channel, markFired, deps);
      fired.push(tag);
    } catch (err) {
      console.error(`[evaluateTagTriggers] failed for #${tag}:`, err);
    }
  }

  // If no tag had a config row we still need to mark the entry as
  // webhook-evaluated so recoverMissedWebhooks doesn't keep retrying it.
  if (fired.length === 0) await markFired(entry.id);
  return fired;
}
