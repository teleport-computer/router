import type { Storage, RouterEntry } from '../storage.js';
import type { SummaryResult } from './llm-summarize.js';
import { ensureBotUser } from './ensure-bot-user.js';
import { normalizeTags } from '../entry-prompts.js';

export interface SaveSummaryArgs {
  storage: Storage;
  teamId: string;
  destinationChannelId?: string;
  organizer: string;
  chatName: string;
  interpretation: string;
  summary: SummaryResult;
}

export interface SaveSummaryResult {
  entry: RouterEntry;
  url: string;
}

export interface RenderArgs {
  organizer: string;
  chatName: string;
  interpretation: string;
  summary: SummaryResult;
}

export function renderEntryMarkdown(args: RenderArgs): string {
  const lines: string[] = [];
  lines.push(`> 整理：${args.organizer} · 来自 Lark 群「${args.chatName}」 · ⏰ ${args.interpretation}`);
  lines.push('');
  lines.push('## TL;DR');
  lines.push('');
  lines.push(args.summary.tldr || '(空)');

  if (args.summary.updates.length > 0) {
    lines.push('');
    lines.push('## 🔄 Updates');
    lines.push('');
    for (const u of args.summary.updates) lines.push(`- ${u}`);
  }
  if (args.summary.decisions.length > 0) {
    lines.push('');
    lines.push('## 🎯 Decisions');
    lines.push('');
    for (const d of args.summary.decisions) lines.push(`- ${d}`);
  }
  if (args.summary.todo.length > 0) {
    lines.push('');
    lines.push('## ✅ Todo');
    lines.push('');
    for (const t of args.summary.todo) {
      lines.push(`- ${t.who ? `${t.who.startsWith('@') ? t.who : '@' + t.who}: ` : ''}${t.what}`);
    }
  }
  if (args.summary.open_questions.length > 0) {
    lines.push('');
    lines.push('## ❓ Open questions');
    lines.push('');
    for (const q of args.summary.open_questions) lines.push(`- ${q}`);
  }
  return lines.join('\n');
}

export async function saveSummary(args: SaveSummaryArgs): Promise<SaveSummaryResult> {
  const botUser = await ensureBotUser(args.storage, args.teamId);
  const content = renderEntryMarkdown({
    organizer: args.organizer,
    chatName: args.chatName,
    interpretation: args.interpretation,
    summary: args.summary,
  });
  const entry = await args.storage.addEntry({
    handle: botUser.handle,
    teamId: args.teamId,
    client: 'lark' as any,
    channel: args.destinationChannelId,
    summary: `[Lark Summary · ${args.chatName} · ${args.interpretation}] ${args.summary.tldr}`,
    content,
    tags: normalizeTags(args.summary.tags ?? [], ['lark-summary']),
    timestamp: Date.now(),
    keywords: [args.chatName],
  } as any, 0);
  const url = `${process.env.PUBLIC_URL ?? ''}/entry?id=${entry.id}`;
  return { entry, url };
}
