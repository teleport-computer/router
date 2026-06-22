/**
 * OpenRouter / OpenAI-compatible chat completions wrapper, with `tools`
 * support. The existing `callLLM` (server.ts) is text-in / text-out only;
 * this is the version used by the agent loop.
 *
 * Both go through `postOpenRouterChat` for shared guardrail-404 retry.
 */

import { postOpenRouterChat } from './openrouter-fetch.js';

export interface ToolDef {
  name: string;
  description: string;
  parameters: any;  // JSON Schema
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;  // tool name when role=tool (some providers want it)
}

export interface AgentTurn {
  text: string | null;
  toolCalls: { id: string; name: string; args: any }[];
}

export interface AgentLLMOpts {
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
}

export async function callAgentLLM(
  messages: AgentMessage[],
  tools: ToolDef[],
  opts: AgentLLMOpts,
): Promise<AgentTurn> {
  const data = await postOpenRouterChat({
    model: opts.model,
    messages,
    tools: tools.map(t => ({ type: 'function', function: t })),
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 1024,
  }, opts.apiKey);
  const msg = data?.choices?.[0]?.message;
  return {
    text: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls: (msg?.tool_calls ?? []).map((tc: any) => ({
      id: tc.id ?? `tc_${Math.random().toString(36).slice(2, 8)}`,
      name: tc.function?.name ?? 'unknown',
      args: safeParseJSON(tc.function?.arguments),
    })),
  };
}

function safeParseJSON(s: any): any {
  if (typeof s !== 'string') return s ?? {};
  try { return JSON.parse(s); } catch { return {}; }
}
