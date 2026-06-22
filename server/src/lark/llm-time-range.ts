import type { TimeRange } from './parse-time-range.js';

export type CallLLM = (prompt: string, opts?: { model?: string; temperature?: number; maxTokens?: number }) => Promise<string>;

export interface LlmTimeRangeOpts {
  callLLM: CallLLM;
  model: string;
}

const PROMPT_TEMPLATE = (query: string, nowIso: string, nowTs: number) => `
Parse a PAST time range (for summarizing past chat history).
Now: ${nowIso} (unix ${nowTs}). end_ts ≤ now. Never future.

Output strict JSON: {"start_ts": int, "end_ts": int, "interpretation": "<short English>"}
Unparseable → {"error": "..."}

Input: ${query}
`;

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
}

export function createLlmTimeRangeFallback(opts: LlmTimeRangeOpts) {
  return async function fallback(query: string, now: number): Promise<TimeRange> {
    const iso = new Date(now * 1000).toISOString();
    const raw = await opts.callLLM(PROMPT_TEMPLATE(query, iso, now), { model: opts.model, temperature: 0, maxTokens: 256 });
    const cleaned = stripCodeFence(raw);
    const parsed = JSON.parse(cleaned) as { start_ts?: number; end_ts?: number; interpretation?: string; error?: string };
    if (parsed.error) throw new Error(parsed.error);
    if (typeof parsed.start_ts !== 'number' || typeof parsed.end_ts !== 'number') {
      throw new Error('LLM returned malformed time range');
    }
    return { start_ts: parsed.start_ts, end_ts: parsed.end_ts, interpretation: parsed.interpretation ?? '', source: 'llm' };
  };
}
