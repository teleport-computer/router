/**
 * Tools the agent can call. Each tool = (JSON schema for the LLM) + (execute
 * fn that runs it server-side and returns a string the LLM consumes as the
 * tool result).
 *
 * Read-only tools return JSON-shaped data the LLM can quote back to the user.
 * Write tools mutate state and return a short success/error string.
 */

import type { Storage, RouterEntry } from '../storage.js';
import type { LarkApiClient } from './api-client.js';
import type { ToolDef } from './agent-llm.js';
import { normalizeTags } from '../entry-prompts.js';
import { buildSaveEntryConfirmCard } from './card-builder.js';
import { listTeamTags, resolveTeamTag } from './tag-resolve.js';

export interface ToolContext {
  storage: Storage;
  apiClient: LarkApiClient;
  chatId: string;
  senderOpenId: string;
  publicUrl: string;
  /** Optional: trigger summarize via existing handler (server.ts injects). */
  triggerSummarize?: (timeRange: string) => Promise<void>;
}

export interface ToolResult {
  /** String fed back to the LLM as the tool's result. JSON if structured. */
  output: string;
  /** Side-effect description for logs (not seen by LLM). */
  log?: string;
  /**
   * When true, the agent loop suppresses its final user-facing reply.
   * Use this for tools that render their own UX in the chat (summarize,
   * show_help, etc.) so the agent doesn't double-post.
   */
  silent?: boolean;
}

export interface ToolEntry {
  def: ToolDef;
  execute: (args: any, ctx: ToolContext) => Promise<ToolResult>;
}

// ─── helpers ───────────────────────────────────────────

async function resolveTeamId(ctx: ToolContext): Promise<string | null> {
  const binding = await ctx.storage.getLarkChatBinding(ctx.chatId);
  if (binding) return binding.teamId;
  const user = await ctx.storage.getUserByLarkOpenId(ctx.senderOpenId);
  return user?.teamId ?? null;
}

function entryToView(e: RouterEntry, publicUrl: string): any {
  return {
    id: e.id,
    handle: e.handle,
    summary: e.summary?.slice(0, 200) ?? '',
    tags: e.tags ?? [],
    role: e.role ?? null,
    channel: e.channel ?? null,
    timestamp: new Date(e.timestamp).toISOString(),
    url: `${publicUrl.replace(/\/$/, '')}/entry?id=${e.id}`,
  };
}

function ok(output: any, log?: string): ToolResult {
  return { output: typeof output === 'string' ? output : JSON.stringify(output), log };
}

function okSilent(output: any, log?: string): ToolResult {
  return { output: typeof output === 'string' ? output : JSON.stringify(output), log, silent: true };
}

function err(message: string): ToolResult {
  return { output: JSON.stringify({ error: message }) };
}

// ─── tool definitions ──────────────────────────────────

export const TOOLS: Record<string, ToolEntry> = {

  describe_capabilities: {
    def: {
      name: 'describe_capabilities',
      description: '当用户问"你能干啥/有什么功能"等元问题时调用。返回 bot 当前所有能力的清单。',
      parameters: { type: 'object', properties: {} },
    },
    execute: async () => ok({
      slash_commands: [
        { cmd: '/connect <tag>', desc: '把当前群连到 router tag' },
        { cmd: '/disconnect', desc: '解绑当前群' },
        { cmd: '/archive <channel>', desc: '设置总结归档目标' },
        { cmd: '/push on|off', desc: '开关 router→群推送' },
        { cmd: '/watch on|off', desc: '开关定期观察' },
        { cmd: '/summarize [time]', desc: '总结群聊存到 router' },
        { cmd: '/help', desc: '帮助卡片' },
      ],
      conversational_skills: [
        '把自然语言映射到上面的命令(说"帮我连 my-project"等同 /connect my-project)',
        '检索 router 内容并引用具体 entry 回答问题',
        '查询当前群绑定 / 推送 / 观察状态',
        '看团队 channel / 成员 / 标签',
      ],
    }),
  },

  show_help: {
    def: {
      name: 'show_help',
      description: '在群里发标准 /help 卡片(图形化命令清单)。用户说"帮助"或希望看完整命令时用。',
      parameters: { type: 'object', properties: {} },
    },
    execute: async (_args, ctx) => {
      const { buildHelpCard } = await import('./card-builder.js');
      await ctx.apiClient.post('/open-apis/im/v1/messages?receive_id_type=chat_id', {
        receive_id: ctx.chatId, msg_type: 'interactive', content: JSON.stringify(buildHelpCard()),
      });
      // Help card is the user-facing output; agent shouldn't add a separate text reply.
      return okSilent({ posted: true });
    },
  },

  // ─── lark group operations (write) ──────────────────

  connect_channel: {
    def: {
      name: 'connect_channel',
      description: '把当前 lark **群**绑定到一个 router channel(持续路由设置,不是一次性推送内容)。仅当用户明说"连接/绑定/connect 这个群"时调用。**用户想推送/保存一条具体内容时用 save_entry,不是这个**。等价 /connect <channel>。',
      parameters: {
        type: 'object',
        properties: { channel_id: { type: 'string', description: 'router channel id, e.g. "my-project"' } },
        required: ['channel_id'],
      },
    },
    execute: async (args, ctx) => {
      const channelId = String(args.channel_id ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!channelId) return err('channel_id required');
      const user = await ctx.storage.getUserByLarkOpenId(ctx.senderOpenId);
      if (!user) return err('请先在 router 网页绑定 lark 账号才能连接');
      const resolved = await resolveTeamTag(ctx.storage, user.teamId, user.handle, channelId);
      if (!resolved) return err(`找不到 tag #${channelId}`);
      const existing = await ctx.storage.getLarkChatBinding(ctx.chatId);
      if (existing) return err(`本群已连到 #${existing.channelId},先 /disconnect 再 /connect`);
      await ctx.storage.createLarkChatBinding({
        chatId: ctx.chatId, channelId: resolved.id, teamId: resolved.teamId,
        boundBy: user.handle, boundAt: Date.now(), chatName: '(unknown)',
      });
      return ok({ connected: true, channel: resolved.id });
    },
  },

  disconnect: {
    def: {
      name: 'disconnect',
      description: '解绑当前群跟 router channel 的连接。等价 /disconnect。',
      parameters: { type: 'object', properties: {} },
    },
    execute: async (_args, ctx) => {
      const existing = await ctx.storage.getLarkChatBinding(ctx.chatId);
      if (!existing) return err('本群未连接');
      await ctx.storage.deleteLarkChatBinding(ctx.chatId);
      return ok({ disconnected: true, was_channel: existing.channelId });
    },
  },

  set_archive: {
    def: {
      name: 'set_archive',
      description: '设置 /summarize 的默认归档 channel。等价 /archive <channel>。',
      parameters: {
        type: 'object',
        properties: { channel_id: { type: 'string' } },
        required: ['channel_id'],
      },
    },
    execute: async (args, ctx) => {
      const binding = await ctx.storage.getLarkChatBinding(ctx.chatId);
      if (!binding) return err('本群未连接');
      const channelId = String(args.channel_id ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!channelId) return err('channel_id required');
      const resolved = await resolveTeamTag(ctx.storage, binding.teamId, binding.boundBy ?? `lark-bot-${binding.teamId}`, channelId);
      if (!resolved) return err(`找不到 tag #${channelId} 或不在本 team`);
      await ctx.storage.updateLarkBindingArchive(ctx.chatId, resolved.id);
      return ok({ archive_set_to: resolved.id });
    },
  },

  set_push: {
    def: {
      name: 'set_push',
      description: '开/关 **router channel → 群** 反向推送(channel 里有新 entry 时通知到群)。仅当用户明说 "/push on|off" 或"打开/关闭推送通知"时调用。**用户要把内容存进 router 时用 save_entry,不是这个**。',
      parameters: {
        type: 'object',
        properties: { enabled: { type: 'boolean' } },
        required: ['enabled'],
      },
    },
    execute: async (args, ctx) => {
      const binding = await ctx.storage.getLarkChatBinding(ctx.chatId);
      if (!binding) return err('本群未连接');
      await ctx.storage.updateLarkBindingPushEnabled(ctx.chatId, !!args.enabled);
      return ok({ push_enabled: !!args.enabled });
    },
  },

  set_watch: {
    def: {
      name: 'set_watch',
      description: '开/关定期观察。等价 /watch on|off。',
      parameters: {
        type: 'object',
        properties: { enabled: { type: 'boolean' } },
        required: ['enabled'],
      },
    },
    execute: async (args, ctx) => {
      const binding = await ctx.storage.getLarkChatBinding(ctx.chatId);
      if (!binding) return err('本群未连接');
      await ctx.storage.updateLarkBindingWatchEnabled(ctx.chatId, !!args.enabled);
      return ok({ watch_enabled: !!args.enabled });
    },
  },

  trigger_summarize: {
    def: {
      name: 'trigger_summarize',
      description: '触发一次 /summarize。time_range 接受 "30m" / "1h" / "today" / 自然语言。',
      parameters: {
        type: 'object',
        properties: { time_range: { type: 'string', description: '默认 "30m"' } },
      },
    },
    execute: async (args, ctx) => {
      if (!ctx.triggerSummarize) return err('summarize 当前不可用');
      const tr = String(args.time_range ?? '30m');
      await ctx.triggerSummarize(tr);
      // summarize handler renders its own loading→summary card; agent must not double-post.
      return okSilent({ summarize_started: true, time_range: tr });
    },
  },

  // ─── router queries (read) ──────────────────────────

  search_router: {
    def: {
      name: 'search_router',
      description: 'router 全文搜索 entries。返回最多 10 条。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词(可中文)' },
          days: { type: 'number', description: '可选,只看最近 N 天' },
          limit: { type: 'number', description: '默认 10' },
        },
        required: ['query'],
      },
    },
    execute: async (args, ctx) => {
      const teamId = await resolveTeamId(ctx);
      if (!teamId) return err('需要先 connect 群或绑定账号');
      const limit = Math.min(Number(args.limit ?? 10), 20);
      const since = args.days ? Date.now() - Number(args.days) * 86400_000 : undefined;
      const results = await ctx.storage.searchEntries(teamId, String(args.query), limit, since);
      return ok({ count: results.length, results: results.map(e => entryToView(e, ctx.publicUrl)) });
    },
  },

  list_channels: {
    def: {
      name: 'list_channels',
      description: '列出当前 team 的所有 channel。',
      parameters: { type: 'object', properties: {} },
    },
    execute: async (_args, ctx) => {
      const teamId = await resolveTeamId(ctx);
      if (!teamId) return err('需要先 connect 群或绑定账号');
      const tags = await listTeamTags(ctx.storage, teamId);
      return ok({
        count: tags.length,
        channels: tags.map(t => ({ id: t.id, name: t.name })),
      });
    },
  },

  list_recent_entries: {
    def: {
      name: 'list_recent_entries',
      description: '看最近的 entries。默认列当前 team 全部最新;指定 channel 则只看该 channel;本群已绑 channel 时优先用绑定的。',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: '可选,不填则按当前群绑定 → team 全局的顺序兜底' },
          limit: { type: 'number', description: '默认 10,最多 30' },
        },
      },
    },
    execute: async (args, ctx) => {
      const teamId = await resolveTeamId(ctx);
      if (!teamId) return err('需要先 connect 群或绑定账号');
      const limit = Math.min(Number(args.limit ?? 10), 30);
      let channelId = args.channel ? String(args.channel) : undefined;
      if (!channelId) {
        const binding = await ctx.storage.getLarkChatBinding(ctx.chatId);
        channelId = binding?.channelId;
      }
      if (channelId) {
        const entries = await ctx.storage.getChannelEntries(teamId, channelId, limit);
        return ok({ scope: `channel:${channelId}`, count: entries.length, entries: entries.map(e => entryToView(e, ctx.publicUrl)) });
      }
      const entries = await ctx.storage.getEntriesSince(teamId, 0, limit);
      return ok({ scope: 'team', count: entries.length, entries: entries.map(e => entryToView(e, ctx.publicUrl)) });
    },
  },

  get_entry: {
    def: {
      name: 'get_entry',
      description: '看具体一条 entry 的详情(含 content 全文)。',
      parameters: {
        type: 'object',
        properties: { entry_id: { type: 'string' } },
        required: ['entry_id'],
      },
    },
    execute: async (args, ctx) => {
      const e = await ctx.storage.getEntry(String(args.entry_id));
      if (!e) return err(`entry ${args.entry_id} not found`);
      return ok({
        ...entryToView(e, ctx.publicUrl),
        content: e.content?.slice(0, 4000) ?? '',
      });
    },
  },

  list_my_subscriptions: {
    def: {
      name: 'list_my_subscriptions',
      description: '列出**用户本人**订阅的 channel(根据当前发言人 lark 账号)。',
      parameters: { type: 'object', properties: {} },
    },
    execute: async (_args, ctx) => {
      const user = await ctx.storage.getUserByLarkOpenId(ctx.senderOpenId);
      if (!user) return err('你还没绑定 router 账号');
      const subs = await ctx.storage.getSubscribedChannels(user.handle);
      return ok({ handle: user.handle, count: subs.length, channels: subs.map(c => ({ id: c.id, name: c.name })) });
    },
  },

  get_binding_info: {
    def: {
      name: 'get_binding_info',
      description: '看当前群的绑定状态:连了哪个 channel / push 开关 / watch 开关 / 上次 summarize 时间 / 累积消息数。',
      parameters: { type: 'object', properties: {} },
    },
    execute: async (_args, ctx) => {
      const b = await ctx.storage.getLarkChatBinding(ctx.chatId);
      if (!b) return ok({ connected: false });
      return ok({
        connected: true,
        channel: b.channelId,
        archive_channel: b.archiveChannelId ?? b.channelId,
        push_enabled: b.pushEnabled !== false,
        watch_enabled: !!b.watchEnabled,
        last_summary_at: b.lastSummaryAt ? new Date(b.lastSummaryAt).toISOString() : null,
        watch_msg_count: b.watchMsgCount ?? 0,
      });
    },
  },

  list_used_tags: {
    def: {
      name: 'list_used_tags',
      description: '列 team 内最常用的 tags(按使用次数倒序)。',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: '默认 20' } },
      },
    },
    execute: async (args, ctx) => {
      const teamId = await resolveTeamId(ctx);
      if (!teamId) return err('需要先 connect 群或绑定账号');
      const stats = await ctx.storage.getTagStats(teamId);
      const limit = Math.min(Number(args.limit ?? 20), 50);
      return ok({ count: stats.length, tags: stats.slice(0, limit) });
    },
  },

  save_entry: {
    def: {
      name: 'save_entry',
      description: [
        '把用户的一条内容存进 router(作为他本人的 entry,不是 bot 的)。',
        '**触发动词**:记一下/记下/存/save/记录/归档/推送(到 router)/push to router/把这个发到 router/帮我 router 一下。',
        '**和 connect_channel 的区别**:save_entry 是把"内容"放进 router(一次性);connect_channel 是把"群"绑定到 channel(持续路由)。',
        '  - 用户说"推送这条/这段" → save_entry',
        '  - 用户说"推送这个群/把群连到 X" → connect_channel',
        '**和 set_push 的区别**:set_push 切的是 channel→群 反向推送的开关,不是把内容推到 router。',
        '不要因为聊到值得记录的内容就主动调 — 那是 /summarize 的活,会冒犯用户。',
        '**channel 完全可选,默认就是 channel-less,绝对不要因为没绑就拒绝执行**。',
        '只有当用户在消息里明确点名 channel(如"记到 #frontend")才传 channel 参数,否则不传(server 会兜底)。',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '要存的正文。verbatim 用户原话,不要改写,不要加你的解读。' },
          channel: { type: 'string', description: '可选。channel slug(不带 #),例如 "frontend"。不确定就别传。' },
          tags: { type: 'array', items: { type: 'string' }, description: '可选。0-3 个语义 tag(英文小写),例如 ["decision", "frontend"]。' },
        },
        required: ['content'],
      },
    },
    execute: async (args, ctx) => {
      const content = typeof args?.content === 'string' ? args.content.trim() : '';
      if (!content) return err('content 不能为空');

      const user = await ctx.storage.getUserByLarkOpenId(ctx.senderOpenId);
      if (!user) {
        return err('sender_not_bound: 你的飞书账号还没绑 router。去 ' + ctx.publicUrl.replace(/\/$/, '') + '/settings 绑一下,2 步搞定。');
      }

      let channelId: string | undefined;
      let channelDisplayName: string | undefined;
      if (typeof args?.channel === 'string' && args.channel.trim()) {
        const slug = args.channel.trim().replace(/^#/, '').toLowerCase();
        const resolved = await resolveTeamTag(ctx.storage, user.teamId, user.handle, slug);
        if (resolved) {
          channelId = resolved.id;
          channelDisplayName = resolved.name;
        }
      }
      if (!channelId) {
        const binding = await ctx.storage.getLarkChatBinding(ctx.chatId);
        if (binding && binding.teamId === user.teamId) channelId = binding.channelId;
      }

      const requestedTags = Array.isArray(args?.tags)
        ? args.tags.filter((t: any): t is string => typeof t === 'string').slice(0, 5)
        : [];
      const finalTags = normalizeTags(requestedTags, ['lark-bot-save']);

      let entry: RouterEntry;
      try {
        entry = await ctx.storage.addEntry({
          handle: user.handle,
          teamId: user.teamId,
          client: 'lark',
          content,
          summary: content.length > 200 ? content.slice(0, 200) + '…' : content,
          tags: finalTags,
          channel: channelId,
          timestamp: Date.now(),
        } as Omit<RouterEntry, 'id'>);
      } catch (e: any) {
        return err(`storage_failed: ${e?.message ?? e}`);
      }

      const channelName = channelDisplayName ?? (channelId
        ? (await ctx.storage.getTagConfig(user.teamId, channelId))?.name ?? channelId
        : undefined);

      try {
        const card = buildSaveEntryConfirmCard({
          author: user.handle,
          content,
          tags: finalTags,
          entryId: entry.id,
          channelName,
          publicUrl: ctx.publicUrl,
        });
        await ctx.apiClient.post('/open-apis/im/v1/messages?receive_id_type=chat_id', {
          receive_id: ctx.chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        });
      } catch (e: any) {
        // Entry is already saved — don't fail the tool call. Operator sees the
        // warning, user sees the entry on the website even without confirm card.
        console.warn(`[save_entry] confirm card post failed: ${e?.message ?? e}`);
      }

      return okSilent({
        saved: entry.id,
        handle: user.handle,
        channel: channelId ?? null,
        tags: finalTags,
      });
    },
  },

  get_team_members: {
    def: {
      name: 'get_team_members',
      description: '列出当前 team 所有成员(handle + displayName)。',
      parameters: { type: 'object', properties: {} },
    },
    execute: async (_args, ctx) => {
      const teamId = await resolveTeamId(ctx);
      if (!teamId) return err('需要先 connect 群或绑定账号');
      const users = await ctx.storage.getAllUsers(teamId);
      return ok({
        count: users.length,
        members: users.map(u => ({ handle: u.handle, displayName: u.displayName ?? null })),
      });
    },
  },
};

export const TOOL_DEFS: ToolDef[] = Object.values(TOOLS).map(t => t.def);
