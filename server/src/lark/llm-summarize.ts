import type { ChatMessage } from './api-client.js';
import { buildLarkSummarizePrompt, type SummaryStyle } from '../entry-prompts.js';

export interface SummaryResult {
  tldr: string;
  updates: string[];                           // ★ NEW (catch-all)
  decisions: string[];
  todo: { who?: string; what: string }[];      // ★ RENAMED from action_items / todos
  open_questions: string[];
  tags: string[];                              // ★ LLM-extracted (server appends "lark-summary")
}

export type CallLLM = (prompt: string, opts?: { model?: string; temperature?: number; maxTokens?: number }) => Promise<string>;

export interface SummarizerOpts {
  callLLM: CallLLM;
  model: string;
}

export interface SummarizeArgs {
  messages: ChatMessage[];
  chatName: string;
  interpretation: string;
  resolveSender: (senderId: string) => string;
  tagContext: string;
  /** Per-binding summary style; default 'person' if unset. */
  style?: SummaryStyle;
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
}

function formatMessages(msgs: ChatMessage[], resolveSender: (id: string) => string): string {
  return msgs
    .map(m => {
      const t = new Date(m.createTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
      return `[${t}] @${resolveSender(m.senderId)}: ${m.text}`;
    })
    .join('\n');
}

export function createSummarizer(opts: SummarizerOpts) {
  return async function summarize(args: SummarizeArgs): Promise<SummaryResult> {
    const messageBlock = formatMessages(args.messages, args.resolveSender);
    const prompt = buildLarkSummarizePrompt({
      chatName: args.chatName,
      interpretation: args.interpretation,
      messageBlock,
      messageCount: args.messages.length,
      tagContext: args.tagContext,
      style: args.style,
    });
    const raw = await opts.callLLM(prompt, { model: opts.model, temperature: 0.2, maxTokens: 2048 });
    const cleaned = stripCodeFence(raw);
    const parsed = JSON.parse(cleaned) as SummaryResult;
    return {
      tldr: parsed.tldr ?? '',
      updates: Array.isArray(parsed.updates) ? parsed.updates : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      todo: Array.isArray(parsed.todo) ? parsed.todo : [],
      open_questions: Array.isArray(parsed.open_questions) ? parsed.open_questions : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  };
}
