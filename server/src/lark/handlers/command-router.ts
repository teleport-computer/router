/**
 * Parses `@bot xxx` group messages into structured commands and dispatches
 * to per-command handlers. Supports English (connect/disconnect/archive/help)
 * and Chinese (连接/解绑/归档/帮助) verbs, plus the legacy `/summarize` slash.
 */

export type CommandName = 'connect' | 'disconnect' | 'archive' | 'push' | 'watch' | 'style' | 'settings' | 'help' | 'summarize';

export interface ParsedCommand {
  command: CommandName;
  arg: string;
}

export interface CommandContext {
  payload: any;
  arg: string;
}

export type CommandHandlers = Record<CommandName, (ctx: CommandContext) => Promise<void> | void>;

// Slash prefix is required for all commands (`/connect`, `/help`, ...).
// The bare-word forms (`connect`, `连接`) are kept as a transitional alias —
// they match too, but help output only advertises the slash form. Plan to
// drop bare-word matching in a future cleanup.
const COMMAND_PATTERNS: Array<{ re: RegExp; name: CommandName; argGroup: number | null }> = [
  { re: /^\/?(connect|连接)\s+#?(\S+)/i,        name: 'connect',    argGroup: 2 },
  { re: /^\/?(disconnect|解绑)\s*$/i,            name: 'disconnect', argGroup: null },
  { re: /^\/?(archive|归档)\s+#?(\S+)/i,        name: 'archive',    argGroup: 2 },
  { re: /^\/?(push|推送)(?:\s+(\S+))?\s*$/i,    name: 'push',       argGroup: 2 },
  { re: /^\/?(watch|观察)(?:\s+(\S.*?))?\s*$/i,  name: 'watch',      argGroup: 2 },
  { re: /^\/?(style|风格)(?:\s+(\S+))?\s*$/i,    name: 'style',      argGroup: 2 },
  { re: /^\/?(settings|config|设置)\s*$/i,       name: 'settings',   argGroup: null },
  { re: /^\/?(help|帮助)\s*$/i,                  name: 'help',       argGroup: null },
  { re: /^\/?summarize(?:\s+(\S.*?))?\s*$/i,    name: 'summarize',  argGroup: 1 },
];

function extractText(content: string): string {
  try {
    const j = JSON.parse(content);
    return j.text ?? '';
  } catch {
    return '';
  }
}

function stripMentions(text: string): string {
  // v2 events use placeholder `@_user_1`. v1 events embed the raw tag
  // `<at open_id="ou_xxx">@Name</at>` directly in the text.
  return text
    .replace(/<at\s+[^>]*>[^<]*<\/at>/g, '')
    .replace(/@_user_\d+/g, '')
    .trim();
}

function textHasBotMention(text: string, botOpenId: string): boolean {
  // v1 event format: text contains `<at open_id="ou_xxx">@Name</at>`.
  const re = new RegExp(`<at\\s+open_id=["']${botOpenId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}["']`, 'i');
  return re.test(text);
}

export function parseCommand(text: string): ParsedCommand | null {
  const stripped = stripMentions(text);
  if (!stripped) return null;
  for (const p of COMMAND_PATTERNS) {
    const m = stripped.match(p.re);
    if (m) {
      const arg = p.argGroup != null ? (m[p.argGroup] ?? '').trim() : '';
      return { command: p.name, arg };
    }
  }
  return null;
}

export interface CommandRouterOpts {
  /** Bot's own open_id. When set, only @bot mentions trigger help fall-through. */
  botOpenId?: string;
  /**
   * Optional: when @bot is mentioned but no slash command matches, send the
   * raw text to this handler (the agent). If undefined, fallback to help.
   */
  agentFallback?: (req: { chatId: string; senderOpenId: string; text: string }) => Promise<void>;
}

function isBotMentioned(mentions: any[], botOpenId: string | undefined): boolean {
  if (!botOpenId) return mentions.length > 0;  // legacy: any mention
  return mentions.some(m => {
    // v2 shape A: id is a string
    if (m?.id === botOpenId) return true;
    // v1/legacy: open_id field
    if (m?.open_id === botOpenId) return true;
    // v2 shape B: id is an object { open_id, union_id, user_id }
    if (m?.id?.open_id === botOpenId) return true;
    return false;
  });
}

export function createCommandRouter(handlers: CommandHandlers, opts: CommandRouterOpts = {}) {
  return async function route(payload: any): Promise<void> {
    const text = extractText(payload?.message?.content ?? '');
    const mentions = payload?.message?.mentions ?? [];
    const botMentioned = isBotMentioned(mentions, opts.botOpenId)
      || (!!opts.botOpenId && textHasBotMention(text, opts.botOpenId));
    const parsed = parseCommand(text);
    console.log(`[command-router] text=${JSON.stringify(text).slice(0, 120)} mentions=${JSON.stringify(mentions)} botOpenId=${opts.botOpenId ?? '<none>'} botMentioned=${botMentioned} parsed=${parsed?.command ?? 'none'} arg=${JSON.stringify(parsed?.arg ?? '')}`);
    // Strict mode (botOpenId set): only react when bot is the @-target.
    if (opts.botOpenId && !botMentioned) return;
    if (parsed) {
      const handler = handlers[parsed.command];
      await Promise.resolve(handler({ payload, arg: parsed.arg }));
      return;
    }
    if (botMentioned) {
      // No slash command match → try the LLM agent (free-form natural language).
      // Falls through to help if agent isn't wired or returns silently.
      if (opts.agentFallback) {
        const stripped = stripMentions(text);
        const senderOpenId = payload?.sender?.sender_id?.open_id ?? '';
        const chatId = payload?.message?.chat_id;
        if (chatId && stripped) {
          opts.agentFallback({ chatId, senderOpenId, text: stripped }).catch(err =>
            console.error('[agent-fallback] failed:', err?.message ?? err),
          );
          return;
        }
      }
      await Promise.resolve(handlers.help({ payload, arg: '' }));
    }
  };
}
