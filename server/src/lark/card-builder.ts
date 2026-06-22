import type { SummaryResult } from './llm-summarize.js';
import type { RouterEntry } from '../storage.js';
import { BOT_NAME } from './bot-config.js';
import { requireEnv } from '../env.js';

export interface LarkInteractiveCard {
  config?: { wide_screen_mode?: boolean };
  header: { template: string; title: { tag: 'plain_text'; content: string } };
  elements: any[];
}

export interface BuildSummaryCardArgs {
  summary: SummaryResult;
  interpretation: string;
  chatName: string;
  saveOptions?: {
    summaryToken: string;
    channels: Array<{ id: string; name: string }>;
    defaultChannelId: string;
  };
}

function nonEmptyOrSkip<T>(items: T[]): T[] | null {
  return items.length > 0 ? items : null;
}

export function buildSummaryCard(args: BuildSummaryCardArgs): LarkInteractiveCard {
  const s = args.summary;
  const elements: any[] = [
    { tag: 'note', elements: [{ tag: 'plain_text', content: `⏰ ${args.interpretation}` }] },
    { tag: 'div', text: { tag: 'lark_md', content: `**TL;DR**\n${s.tldr || '(空)'}` } },
  ];

  const updates = nonEmptyOrSkip(s.updates);
  if (updates) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**🔄 Updates**\n${updates.map(u => `- ${u}`).join('\n')}` } });
  }

  const decisions = nonEmptyOrSkip(s.decisions);
  if (decisions) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**🎯 Decisions**\n${decisions.map(d => `- ${d}`).join('\n')}` } });
  }

  const todos = nonEmptyOrSkip(s.todo);
  if (todos) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**✅ Todo**\n${todos.map(t => `- ${t.who ? `${t.who.startsWith('@') ? t.who : '@' + t.who} · ` : ''}${t.what}`).join('\n')}`,
      },
    });
  }

  const openQs = nonEmptyOrSkip(s.open_questions);
  if (openQs) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**❓ Open questions**\n${openQs.map(q => `- ${q}`).join('\n')}` } });
  }

  if (args.saveOptions) {
    const { summaryToken, channels, defaultChannelId } = args.saveOptions;
    const channelOptions = channels.slice(0, 50).map(c => ({
      text: { tag: 'plain_text' as const, content: `#${c.name}` },
      value: c.id,
    }));
    const options = [
      { text: { tag: 'plain_text' as const, content: '(no tag)' }, value: '__none__' },
      ...channelOptions,
    ];
    const initialChannelId = defaultChannelId || '__none__';
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'select_static',
          placeholder: { tag: 'plain_text', content: '归档 tag' },
          initial_option: initialChannelId,
          options,
          value: { action: 'select_archive_channel', summary_token: summaryToken },
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '📤 Push' },
          type: 'primary',
          value: {
            action: 'save_summary',
            summary_token: summaryToken,
            channel_id: initialChannelId,
          },
        },
      ],
    });
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'turquoise',
      title: { tag: 'plain_text', content: `📋 ${args.chatName} Summary` },
    },
    elements,
  };
}

export interface BuildSavedSummaryCardArgs {
  summary: SummaryResult;
  interpretation: string;
  chatName: string;
  savedBy: string;
  channelLabel: string;
  entryUrl: string;
}

export function buildSavedSummaryCard(args: BuildSavedSummaryCardArgs): LarkInteractiveCard {
  const card = buildSummaryCard({
    summary: args.summary,
    interpretation: args.interpretation,
    chatName: args.chatName,
  });
  card.header.template = 'green';
  card.elements.push({ tag: 'hr' });
  card.elements.push({
    tag: 'note',
    elements: [{
      tag: 'lark_md',
      content: `✅ Saved to ${args.channelLabel} by ${args.savedBy} · [view →](${args.entryUrl})`,
    }],
  });
  return card;
}

export function buildErrorCard(message: string): LarkInteractiveCard {
  return {
    config: { wide_screen_mode: true },
    header: { template: 'red', title: { tag: 'plain_text', content: '⚠️ 出错了' } },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: message } }],
  };
}

export function buildLoadingCard(interpretation: string): LarkInteractiveCard {
  return {
    config: { wide_screen_mode: true },
    header: { template: 'grey', title: { tag: 'plain_text', content: '⏳ Summarizing…' } },
    elements: [
      { tag: 'note', elements: [{ tag: 'plain_text', content: `⏰ ${interpretation}` }] },
      { tag: 'div', text: { tag: 'lark_md', content: 'Fetching messages and calling LLM. Please wait — do not click again.' } },
    ],
  };
}

const AGENT_THINKING_PREVIEW_CHARS = 240;

function quotePreview(text: string, max = AGENT_THINKING_PREVIEW_CHARS): string {
  const t = text.trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

export function buildAgentThinkingCard(userText: string): LarkInteractiveCard {
  return {
    config: { wide_screen_mode: true },
    header: { template: 'grey', title: { tag: 'plain_text', content: '🤔 Thinking…' } },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `> ${quotePreview(userText).replace(/\n/g, '\n> ')}` } },
      { tag: 'note', elements: [{ tag: 'plain_text', content: 'Calling the LLM and tools. Hang on a moment.' }] },
    ],
  };
}

export function buildAgentReplyCard(replyText: string): LarkInteractiveCard {
  return {
    config: { wide_screen_mode: true },
    header: { template: 'blue', title: { tag: 'plain_text', content: `🤖 ${BOT_NAME}` } },
    elements: [
      { tag: 'markdown', content: replyText },
    ],
  };
}

export function buildAgentSilentDoneCard(): LarkInteractiveCard {
  return {
    config: { wide_screen_mode: true },
    header: { template: 'green', title: { tag: 'plain_text', content: '✅ Done' } },
    elements: [
      { tag: 'note', elements: [{ tag: 'plain_text', content: 'See the card below.' }] },
    ],
  };
}

export interface BuildEntryCardArgs {
  entry: RouterEntry;
  channelName: string;
  publicUrl: string;
}

function entryLink(publicUrl: string, entryId: string): string {
  return `${publicUrl.replace(/\/$/, '')}/entry?id=${entryId}`;
}

export function buildEntryCard(args: BuildEntryCardArgs): LarkInteractiveCard {
  const { entry, channelName, publicUrl } = args;
  const tagStr = entry.tags.map(t => `\`#${t}\``).join('  ');
  const roleStr = entry.role ? `[${entry.role}] ` : '';
  const time = new Date(entry.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const link = entryLink(publicUrl, entry.id);

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: `#${channelName} · @${entry.handle} synced` },
    },
    elements: [
      { tag: 'markdown', content: `${roleStr}${entry.summary}` },
      { tag: 'markdown', content: tagStr },
      { tag: 'markdown', content: `[查看详情 →](${link})` },
      { tag: 'note', elements: [{ tag: 'plain_text', content: time }] },
    ],
  };
}

export interface BindingResultCardArgs {
  kind: 'success' | 'error';
  message: string;
  publicUrl?: string;
  channelId?: string;
}

export function buildBindingResultCard(args: BindingResultCardArgs): LarkInteractiveCard {
  const elements: any[] = [
    { tag: 'div', text: { tag: 'lark_md', content: args.message } },
  ];
  if (args.kind === 'success' && args.publicUrl && args.channelId) {
    const url = `${args.publicUrl.replace(/\/$/, '')}/tags/${encodeURIComponent(args.channelId)}`;
    elements.push({
      tag: 'note',
      elements: [{ tag: 'lark_md', content: `[查看 tag →](${url})` }],
    });
  }
  return {
    config: { wide_screen_mode: true },
    header: {
      template: args.kind === 'success' ? 'green' : 'red',
      title: { tag: 'plain_text', content: args.kind === 'success' ? '✅' : '⚠️' },
    },
    elements,
  };
}

export interface BuildWatchCardArgs {
  observation: {
    kind: 'undocumented_decision' | 'unresolved_question' | 'recurring_topic' | 'handoff_stuck' | string;
    content: string;
    suggested_action?: string | null;
  };
}

const KIND_LABEL: Record<string, string> = {
  undocumented_decision: '决定没沉淀',
  unresolved_question: '悬而未决',
  recurring_topic: '反复讨论',
  handoff_stuck: '协作待确认',
};

export function buildWatchCard(args: BuildWatchCardArgs): LarkInteractiveCard {
  const o = args.observation;
  const label = KIND_LABEL[o.kind] ?? '观察';
  const suggestion = o.suggested_action
    ? `\n\n💡 ${o.suggested_action}`
    : '';
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'wathet',  // light blue / soft tone
      title: { tag: 'plain_text', content: '🔍 给个小提醒' },
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**${label}**\n${o.content}${suggestion}` } },
      { tag: 'note', elements: [{ tag: 'lark_md', content: `不想看了?回 \`@${BOT_NAME} /watch off\`` }] },
    ],
  };
}

// ───────────────────────────────────────────────────────
// Welcome card — posted on chat_member.bot.added_v1 (bot joins a group)
// ───────────────────────────────────────────────────────

export function buildWelcomeCard(): LarkInteractiveCard {
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'turquoise',
      title: { tag: 'plain_text', content: `👋 Hi, I'm ${BOT_NAME}` },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            `**I help your team capture & flow knowledge between Lark and Teleport Router.**`,
            `把这个群跟 Teleport Router 团队笔记本连起来,信息双向流通。`,
          ].join('\n'),
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            '**🚀 Quick start · 快速上手**',
            `1. \`@${BOT_NAME} /connect <tag>\` — bind this group to a tag · 把群连到 router tag`,
            `2. \`@${BOT_NAME} /settings\` — open the interactive settings panel · 打开交互式设置面板`,
            `3. \`@${BOT_NAME} /summarize 1h\` — summarize the last hour of chat · 总结最近 1 小时的聊天`,
          ].join('\n'),
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            '**🛠 What I can do · 我能干啥**',
            '📋 **Summarize chat** · 总结群聊 — `/summarize 1h` / `today` / `7天` / 自然语言',
            '📤 **Push entries** · 推送 entry — tag 有新内容时自动发到群(默认关,可开)',
            '🔍 **Watch & nudge** · 默默观察 — 只在有重要的事(决定没沉淀 / 问题没回 / 协作卡住)才提示',
            '✍️ **Switch summary style** · 切总结风格 — person / topic / free',
            '📁 **Archive target** · 归档目标 — `/summarize` 默认存到哪个 tag',
          ].join('\n'),
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            '**💬 Or just talk to me · 直接说人话也行**',
            `\`@${BOT_NAME} 帮我连 my-project\` / \`@${BOT_NAME} what did we decide about TEE?\``,
            '— I\'ll figure out the right command. · 我会自己理解 + 调对应工具。',
          ].join('\n'),
        },
      },
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [{
          tag: 'lark_md',
          content: `Run \`@${BOT_NAME} /help\` anytime to see all commands · 随时 \`@${BOT_NAME} /help\` 看完整命令清单`,
        }],
      },
    ],
  };
}

// ───────────────────────────────────────────────────────
// Settings card — interactive control panel posted via /settings
// ───────────────────────────────────────────────────────

export interface BuildSettingsCardArgs {
  chatId: string;
  /** Bound channel id; null when chat is not yet connected. */
  boundChannel: { id: string; name: string } | null;
  /** Last summarize timestamp (ms) for the binding, if any. */
  lastSummaryAt?: number | null;
  /** Toggle states (chat-level + binding-level prefs merged). */
  pushEnabled: boolean;
  watchEnabled: boolean;
  summaryStyle: 'person' | 'topic' | 'free';
  /** Currently-selected archive channel id; '__main__' when defaulted to bound channel. */
  archiveSelected: string;
  /** All available channels in the team for the archive dropdown. */
  availableChannels: Array<{ id: string; name: string }>;
  /** Auto-summary toggle + cadence/time. When undefined, the section is skipped. */
  autoSummary?: {
    enabled: boolean;
    cadence: 'daily' | 'weekly' | 'hourly:6' | 'hourly:12';
    fireHour: number;  // 0-23 Asia/Shanghai
  };
  /**
   * Channels the clicker's team has, surfaced as a Connect dropdown when
   * `boundChannel` is null. When undefined / empty, the unbound state shows
   * a plain hint instead. This is separate from `availableChannels` because
   * the clicker may not have a router account yet (in which case we still
   * want to render the rest of the card).
   */
  connectableChannels?: Array<{ id: string; name: string }>;
  /**
   * When clicker has no router account, the card shows a "bind your account
   * first" hint instead of a connect dropdown. publicUrl is the link target.
   */
  clickerNeedsRouterAccount?: boolean;
  publicUrl?: string;
  now?: number;  // for "X ago" rendering, for testability
}

function fmtTimeAgo(ts: number | null | undefined, now: number): string {
  if (!ts) return 'Never · 从未';
  const ms = now - ts;
  if (ms < 60_000) return 'Just now · 刚刚';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago · ${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago · ${Math.floor(ms / 3_600_000)} 小时前`;
  return `${Math.floor(ms / 86_400_000)}d ago · ${Math.floor(ms / 86_400_000)} 天前`;
}

function toggleButtons(
  isOn: boolean,
  action: string,
  baseValue: Record<string, any> = {},
): any {
  return {
    tag: 'action',
    actions: [
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '🚫 Off · 关' },
        type: isOn ? 'default' : 'primary',
        value: { ...baseValue, action, state: 'off' },
      },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '✓ On · 开' },
        type: isOn ? 'primary' : 'default',
        value: { ...baseValue, action, state: 'on' },
      },
    ],
  };
}

export function buildSettingsCard(args: BuildSettingsCardArgs): LarkInteractiveCard {
  const now = args.now ?? Date.now();
  const elements: any[] = [];

  // ── Status section ──
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: [
        '**📊 Status · 状态**',
        args.boundChannel
          ? `**Bound to · 绑定:** \`#${args.boundChannel.id}\` (${args.boundChannel.name})`
          : `**Not connected · 未连接** — 用 \`@${BOT_NAME} /connect <tag>\` 连接`,
        `**Last summarize · 上次总结:** ${fmtTimeAgo(args.lastSummaryAt ?? null, now)}`,
      ].join('\n'),
    },
  });

  elements.push({ tag: 'hr' });

  // ── Connect section (only when not bound) ──
  if (!args.boundChannel) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: [
          '**🔗 Connect to tag · 连接到 tag**',
          'Pick a tag to bind this group to. After connecting, push / archive / style settings below take effect.',
          '选一个 tag 把本群绑过去。绑定后下面的 push / archive / style 设置就生效了。',
        ].join('\n'),
      },
    });
    if (args.clickerNeedsRouterAccount) {
      const url = args.publicUrl || requireEnv('PUBLIC_URL');
      elements.push({
        tag: 'note',
        elements: [{
          tag: 'lark_md',
          content: `Bind your Lark account on [router](${url}) first, then come back. · 请先到 [router](${url}) 网页绑定 Lark 账号后再回来。`,
        }],
      });
    } else if (args.connectableChannels && args.connectableChannels.length > 0) {
      elements.push({
        tag: 'action',
        actions: [{
          tag: 'select_static',
          placeholder: { tag: 'plain_text', content: 'Pick tag · 选 tag' },
          options: args.connectableChannels.map(c => ({
            text: { tag: 'plain_text', content: `#${c.id} — ${c.name}` },
            value: c.id,
          })),
          value: { action: 'settings.connect' },
        }],
      });
    } else {
      elements.push({
        tag: 'note',
        elements: [{
          tag: 'plain_text',
          content: 'No tags in your team yet · 你的 team 还没有 tag',
        }],
      });
    }
    elements.push({ tag: 'hr' });
  } else {
    // ── Rebind / disconnect section (only when bound) ──
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: [
          '**🔗 Binding · 绑定**',
          'Switch to a different tag, or disconnect this group entirely.',
          '换绑到别的 tag,或者解绑本群。',
        ].join('\n'),
      },
    });
    const switchOptions = args.availableChannels
      .filter(c => c.id !== args.boundChannel!.id)
      .map(c => ({
        text: { tag: 'plain_text', content: `#${c.id} — ${c.name}` },
        value: c.id,
      }));
    // Keep the select and the button in separate action blocks — Lark v1
    // cards occasionally reject mixed-element action arrays during PATCH,
    // which silently breaks the card refresh for *every* settings toggle.
    if (switchOptions.length > 0) {
      elements.push({
        tag: 'action',
        actions: [{
          tag: 'select_static',
          placeholder: { tag: 'plain_text', content: '🔄 Switch tag · 换绑' },
          options: switchOptions,
          value: { action: 'settings.rebind' },
        }],
      });
    }
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'button',
        text: { tag: 'plain_text', content: '🚫 Disconnect · 解绑' },
        type: 'default',
        value: { action: 'settings.disconnect' },
      }],
    });
    elements.push({ tag: 'hr' });
  }

  // ── Push section ──
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: [
        '**📤 Push entries to group · 推送 entry 到群**',
        'When the channel has new entries, send them as cards to this group.',
        'channel 里有新 entry 时,自动发卡片到群里。',
      ].join('\n'),
    },
  });
  if (args.boundChannel) {
    elements.push(toggleButtons(args.pushEnabled, 'settings.toggle_push'));
  } else {
    elements.push({
      tag: 'note',
      elements: [{ tag: 'plain_text', content: 'Connect a channel first · 先连接 channel' }],
    });
  }

  elements.push({ tag: 'hr' });

  // ── Watch section ──
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: [
        '**🔍 Watch group for signals · 观察群里值得提示的事**',
        "Bot quietly observes; speaks up only when there's something worth flagging.",
        'bot 默默观察,只在有值得提示的事时才发声。',
      ].join('\n'),
    },
  });
  elements.push(toggleButtons(args.watchEnabled, 'settings.toggle_watch'));

  elements.push({ tag: 'hr' });

  // ── Auto-summary section (clock-driven, separate from watch) ──
  if (args.autoSummary) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: [
          '**🕐 Auto summary · 定期自动总结**',
          'Scheduled `/summarize` posted to this group + saved to router.',
          '按时自动总结群聊,推送到本群并存到 router。',
        ].join('\n'),
      },
    });
    elements.push(toggleButtons(args.autoSummary.enabled, 'settings.toggle_auto_summary'));
    // Cadence dropdown — 4 fixed options.
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'select_static',
        placeholder: { tag: 'plain_text', content: 'Cadence · 频率' },
        initial_option: args.autoSummary.cadence,
        options: [
          { text: { tag: 'plain_text', content: '📆 Daily · 每天' }, value: 'daily' },
          { text: { tag: 'plain_text', content: '🗓️ Weekly (Mon) · 每周一' }, value: 'weekly' },
          { text: { tag: 'plain_text', content: '⏱️ Every 6h · 每 6 小时' }, value: 'hourly:6' },
          { text: { tag: 'plain_text', content: '⏱️ Every 12h · 每 12 小时' }, value: 'hourly:12' },
        ],
        value: { action: 'settings.set_auto_cadence' },
      }],
    });
    // Fire hour — 7 fixed options (Asia/Shanghai). Hidden for hourly cadence.
    if (args.autoSummary.cadence === 'daily' || args.autoSummary.cadence === 'weekly') {
      elements.push({
        tag: 'action',
        actions: [{
          tag: 'select_static',
          placeholder: { tag: 'plain_text', content: 'Time (Asia/Shanghai) · 时间' },
          initial_option: String(args.autoSummary.fireHour),
          options: [0, 6, 9, 12, 15, 18, 21].map(h => ({
            text: { tag: 'plain_text', content: `${String(h).padStart(2, '0')}:00` },
            value: String(h),
          })),
          value: { action: 'settings.set_auto_time' },
        }],
      });
    }
    elements.push({ tag: 'hr' });
  }

  // ── Summary style section ──
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: [
        '**✍️ Summary style · 总结风格**',
        'How `/summarize` organizes the Updates section.',
        '`/summarize` 输出的 Updates 段落怎么组织。',
      ].join('\n'),
    },
  });
  elements.push({
    tag: 'action',
    actions: [{
      tag: 'select_static',
      placeholder: { tag: 'plain_text', content: 'Pick style · 选风格' },
      initial_option: args.summaryStyle,
      options: [
        { text: { tag: 'plain_text', content: '👤 Person · 谁开头' }, value: 'person' },
        { text: { tag: 'plain_text', content: '🏷️ Topic · 主题开头,作者尾标' }, value: 'topic' },
        { text: { tag: 'plain_text', content: '✨ Free · 无格式约束' }, value: 'free' },
      ],
      value: { action: 'settings.set_style' },
    }],
  });

  elements.push({ tag: 'hr' });

  // ── Archive target section ──
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: [
        '**📁 Archive target · 归档目标**',
        `Where \`@${BOT_NAME} /summarize\` saves the entry.`,
        `\`@${BOT_NAME} /summarize\` 把摘要存到哪个 tag。`,
      ].join('\n'),
    },
  });
  if (args.boundChannel) {
    const others = args.availableChannels.filter(c => c.id !== args.boundChannel!.id);
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'select_static',
        placeholder: { tag: 'plain_text', content: 'Pick tag · 选 tag' },
        initial_option: args.archiveSelected,
        options: [
          {
            text: { tag: 'plain_text', content: `Default · 默认 (#${args.boundChannel.id})` },
            value: '__main__',
          },
          {
            text: { tag: 'plain_text', content: '(no channel) · 不存任何 channel' },
            value: '__none__',
          },
          ...others.map(c => ({
            text: { tag: 'plain_text', content: `#${c.id} — ${c.name}` },
            value: c.id,
          })),
        ],
        value: { action: 'settings.set_archive' },
      }],
    });
  } else {
    elements.push({
      tag: 'note',
      elements: [{ tag: 'plain_text', content: 'Connect a channel first · 先连接 channel' }],
    });
  }

  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'note',
    elements: [{
      tag: 'lark_md',
      content: 'Changes apply instantly · 改完即时生效。Use `/help` for command syntax · `/help` 看完整命令。',
    }],
  });

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'turquoise',
      title: { tag: 'plain_text', content: '⚙️ Router Bot Settings · 设置' },
    },
    elements,
  };
}

export function buildHelpCard(): LarkInteractiveCard {
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: '📖 Router Bot 帮助' },
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: '**⚙️ Quick start · 快速上手**' } },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            `\`@${BOT_NAME} /settings\` — open the interactive settings panel`,
            '打开交互式设置面板,所有开关一站式调整',
          ].join('\n'),
        },
      },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: '**🔗 Bind chat ↔ channel · 群-channel 连接**' } },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            '`/connect <tag>` — connect group · 连接当前群',
            '`/disconnect` — unbind · 解绑',
            '`/archive <tag>` — set summarize target · 设置总结归档目标',
            '`/push on|off` — toggle channel→group push · 开关推送 (default off · 默认关)',
          ].join('\n'),
        },
      },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: '**📋 Summary & watch · 总结 + 观察**' } },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            '`/summarize [time]` — summarize chat · 总结群聊 (`1h` / `today` / `7天` / 自然语言)',
            '`/style person|topic|free` — switch summary style · 切总结风格',
            '`/watch on|off` — toggle quiet observation · 开关定期观察 (default off · 默认关)',
          ].join('\n'),
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            '**💬 Natural language · 自然语言**',
            `Just @${BOT_NAME} and speak naturally — e.g. "帮我连 my-project" / "what did we decide about X?".`,
            'The bot understands and calls the right tool.',
            `直接 @${BOT_NAME} 说人话即可 — bot 会自己理解 + 调对应工具。`,
          ].join('\n'),
        },
      },
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [{
          tag: 'lark_md',
          content: 'ℹ️ Chinese aliases · 中文别名: `/连接` `/解绑` `/归档` `/推送` `/观察` `/风格` `/设置` `/帮助`',
        }],
      },
    ],
  };
}

// ───────────────────────────────────────────────────────────────
// Personal IM notification card (mention / comment / reply)
// ───────────────────────────────────────────────────────────────

export interface BuildNotificationCardArgs {
  type: 'mention' | 'comment' | 'reply';
  fromHandle: string;
  preview: string;
  channel?: string;
  link: string;
}

const NOTIFICATION_TITLES: Record<BuildNotificationCardArgs['type'], string> = {
  mention: '💬 @{from} 提到你',
  comment: '📝 @{from} 评论了你的 entry',
  reply: '↩ @{from} 回复了你',
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function buildNotificationCard(args: BuildNotificationCardArgs): LarkInteractiveCard {
  const title = NOTIFICATION_TITLES[args.type].replace('{from}', args.fromHandle);
  const previewText = args.preview.trim() ? truncate(args.preview.trim(), 200) : '(无内容预览)';

  const elements: any[] = [];
  if (args.channel) {
    elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: `在 #${args.channel}` }] });
  }
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: previewText } });
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'action',
    actions: [
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '在 router 查看' },
        type: 'primary',
        url: args.link,
      },
    ],
  });

  return {
    config: { wide_screen_mode: true },
    header: { template: 'blue', title: { tag: 'plain_text', content: title } },
    elements,
  };
}

// ───────────────────────────────────────────────────────────────
// Concierge Weekly Brief card (Lark IM push Monday 10am Beijing)
//
// Layout (since LLM-synthesis upgrade, 2026-05-12; switched daily→weekly 2026-05-13):
//   📡 Team activity         ← LLM-generated paragraph (or fallback list)
//   💡 For you               ← LLM-generated callout (only if real connection)
//   🎯 Milestones            ← list (≤3 items, only if non-empty)
//   📌 N mentions / M replies (in inbox)   ← only if counts > 0
//   [View full brief on web] ← always
//
// Mentioned/replied are deliberately NOT shown as full entries here — those
// fire via realtime notification-bridge as soon as they happen, so repeating
// them in the brief = noise. The footer count line keeps ambient
// awareness ("3 things hit your inbox") without re-pushing the content.
// ───────────────────────────────────────────────────────────────

export interface DigestCardItem {
  summary: string;     // e.g. "@andrew in #design — token color review"
  url: string;         // entry URL
}

export interface BuildWeeklyBriefCardArgs {
  dateLabel: string;                // e.g. "Week of May 7"
  publicUrl: string;                // for the bottom "View full brief" button
  /** LLM-generated 1-2 paragraph synthesis of this week's team activity. Null = LLM unavailable / no content. */
  teamOverviewMd: string | null;
  /** LLM-generated 1-2 sentence callout linking user's recent work to team activity. Null = no real connection. */
  personalCalloutMd: string | null;
  /** Milestone-tagged entries (≤3 shown). */
  milestones: DigestCardItem[];
  /** Realtime-pushed counts (shown as footer line, never as full entries). */
  realtimeMentionsCount: number;
  realtimeRepliesCount: number;
  /** Fallback channel entries — used ONLY if teamOverviewMd is null (graceful degradation when LLM fails). */
  fallbackChannelEntries: DigestCardItem[];
}

const MILESTONES_LIMIT = 3;
const FALLBACK_CHANNELS_LIMIT = 5;
const ENTRY_SUMMARY_TRUNCATE = 60;

function renderListBlock(label: string, items: DigestCardItem[], limit: number): any[] {
  if (items.length === 0) return [];
  const visible = items.slice(0, limit);
  const overflow = items.length - visible.length;
  const lines = visible.map(it => {
    const text = truncate(it.summary.trim(), ENTRY_SUMMARY_TRUNCATE);
    return `• [${text}](${it.url})`;
  });
  if (overflow > 0) {
    lines.push(`...and ${overflow} more`);
  }
  return [
    { tag: 'div', text: { tag: 'lark_md', content: `**${label}** (${items.length})\n${lines.join('\n')}` } },
  ];
}

export function buildWeeklyBriefCard(args: BuildWeeklyBriefCardArgs): LarkInteractiveCard {
  const elements: any[] = [];

  // Date subtitle
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: args.dateLabel }] });

  // 1. Team activity — LLM paragraph (preferred), or fallback to list of channel entries
  if (args.teamOverviewMd) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**📡 Team activity**\n${args.teamOverviewMd}` } });
  } else if (args.fallbackChannelEntries.length > 0) {
    elements.push(...renderListBlock('📡 Team activity', args.fallbackChannelEntries, FALLBACK_CHANNELS_LIMIT));
  }

  // 2. Personal callout — LLM sentence (only if real connection found)
  if (args.personalCalloutMd) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**💡 For you**\n${args.personalCalloutMd}` } });
  }

  // 3. Milestones — list (only if non-empty)
  elements.push(...renderListBlock('🎯 Milestones', args.milestones, MILESTONES_LIMIT));

  // 4. Realtime activity footer — count only (don't repeat content already pushed real-time)
  if (args.realtimeMentionsCount > 0 || args.realtimeRepliesCount > 0) {
    const parts: string[] = [];
    if (args.realtimeMentionsCount > 0) parts.push(`${args.realtimeMentionsCount} mention${args.realtimeMentionsCount === 1 ? '' : 's'}`);
    if (args.realtimeRepliesCount > 0) parts.push(`${args.realtimeRepliesCount} repl${args.realtimeRepliesCount === 1 ? 'y' : 'ies'}`);
    elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: `📌 ${parts.join(' + ')} this week (already in your inbox)` }] });
  }

  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'action',
    actions: [
      {
        tag: 'button',
        text: { tag: 'plain_text', content: 'View full brief on web' },
        type: 'default',
        url: `${args.publicUrl.replace(/\/$/, '')}/brief`,
      },
    ],
  });

  return {
    config: { wide_screen_mode: true },
    header: { template: 'blue', title: { tag: 'plain_text', content: 'Router Weekly Brief' } },
    elements,
  };
}

// ───────────────────────────────────────────────────────────────
// P2P guide cards (binding required / rate-limited)
// ───────────────────────────────────────────────────────────────

function stripTrailingSlash(s: string): string {
  return s.replace(/\/$/, '');
}

export function buildBindingGuideCard(publicUrl: string): LarkInteractiveCard {
  const base = stripTrailingSlash(publicUrl);
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: '👋 你好！我是 Router Bot' },
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: '你的飞书账号还没关联到 router 账号' } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: '**绑定后能做这些事：**\n\n💬 **私信我问问题**\n   "上周做了什么决定" / "@andrew 在做啥"\n\n🔔 **接收 @ 你的通知**\n   别人在 router 提到你 → 自动私信你\n\n📋 **群里 @我总结讨论**\n   讨论完一段话发 /summarize 30m，自动归档\n\n🔑 **飞书账号兼作账号恢复**\n   key 丢了 / 换设备 → 飞书登录立刻找回' } },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '去 router 网页绑定' },
            type: 'primary',
            url: `${base}/settings#lark-binding`,
          },
        ],
      },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '整个绑定只要 2 次点击（连接 + 同意）' }] },
    ],
  };
}

export interface BuildSaveEntryConfirmCardArgs {
  author: string;             // router handle of saver
  content: string;            // entry content (verbatim)
  tags: string[];             // final tags (incl. lark-bot-save)
  entryId: string;
  channelName?: string;       // null/undefined → channel-less
  publicUrl: string;
}

export function buildSaveEntryConfirmCard(args: BuildSaveEntryConfirmCardArgs): LarkInteractiveCard {
  const base = stripTrailingSlash(args.publicUrl);
  const previewContent = args.content.length > 400 ? args.content.slice(0, 400) + '…' : args.content;
  // Filter out the implementation-detail tag from user-facing chips.
  const visibleTags = args.tags.filter(t => t !== 'lark-bot-save');
  const tagLine = visibleTags.length > 0 ? visibleTags.map(t => `\`#${t}\``).join(' · ') : '';
  const channelLine = args.channelName ? `→ #${args.channelName}` : '_(无 tag,只在你的 feed 里)_';
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'green',
      title: { tag: 'plain_text', content: `✅ @${args.author} 通过 bot 存了一条 entry` },
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: previewContent } },
      ...(tagLine ? [{ tag: 'div', text: { tag: 'lark_md', content: tagLine } }] : []),
      { tag: 'div', text: { tag: 'lark_md', content: channelLine } },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          { tag: 'button', text: { tag: 'plain_text', content: '查看 entry' }, type: 'primary', url: `${base}/entry?id=${args.entryId}` },
          { tag: 'button', text: { tag: 'plain_text', content: '编辑/删除' }, url: `${base}/entry?id=${args.entryId}` },
        ],
      },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '说错了?去网页随时改/删,1 小时内还在 staging' }] },
    ],
  };
}

export function buildP2pHelpCard(publicUrl: string): LarkInteractiveCard {
  const base = stripTrailingSlash(publicUrl);
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: '📖 Router Bot 私聊帮助' },
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: '**💬 直接说人话**\n问任何 router 上的事 — "上周做了什么决定" / "@andrew 在做啥" / "最近 CLI 的讨论"\nJust ask in plain language — no slash commands needed in DM.' } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: '**🔔 接收通知**\n别人在 router 提到你/评论你/回复你 → 自动私信你(可在 settings 里关)\nMentions / comments / replies on router get pushed here automatically.' } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: '**⏱ 限速**\n私聊 5 次/分钟。超了我会提示你。\nDM rate limit: 5 / minute.' } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: '**📋 群里的命令在 DM 里不能用**\n`/summarize` `/connect` 这些都是群里专属。要用就到群里 @我。\nSlash commands like `/summarize` only work in group chats — go to a group and @me.' } },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          { tag: 'button', text: { tag: 'plain_text', content: '⚙ 设置' }, url: `${base}/settings` },
          { tag: 'button', text: { tag: 'plain_text', content: '💻 装本地 CLI(更快不限速)' }, url: `${base}/setup/cli` },
        ],
      },
    ],
  };
}

export function buildP2pUnknownSlashCard(command: string): LarkInteractiveCard {
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'grey',
      title: { tag: 'plain_text', content: '私聊里只支持 /help' },
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `\`${command}\` 是群里的命令,私聊里我只认 \`/help\`。\n\nSlash commands like \`${command}\` are group-only. In DM, just talk to me in plain language.` } },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '想看私聊能干啥 → 发 /help' }] },
    ],
  };
}

export function buildRateLimitGuideCard(publicUrl: string): LarkInteractiveCard {
  const base = stripTrailingSlash(publicUrl);
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'orange',
      title: { tag: 'plain_text', content: '⏱ 太快啦，让我喘口气' },
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: '你刚才提的问题有点密集（已超过 **5 次/分钟**）' } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: '💡 **想要更流畅的对话？试试本地工具：**\n\n   • Claude Code (CLI)\n   • Claude Desktop\n   • Codex\n\n   把 router-sync skill 装上后，直接在本地 Claude 里问 router 任何事。\n\n   速度更快、不限速、可以连续追问。' } },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '查看接入指南' },
            type: 'primary',
            url: `${base}/setup/cli`,
          },
        ],
      },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '60 秒后我又能正常回复你了' }] },
    ],
  };
}
