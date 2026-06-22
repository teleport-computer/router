/**
 * Shared OpenRouter chat-completions caller with guardrail-404 retry.
 *
 * Why: OpenRouter routes a model across multiple providers, and account
 * guardrails may block some providers but not others. OpenRouter does NOT
 * auto-fall-through past a guardrail 404 — so each call is a fresh roll
 * of the dice. Empirically a single retry catches ~99% of cases. Without
 * retry, every callsite is a coin flip.
 *
 * Both `callAgentLLM` (agent loop, tool-use shaped) and `callLLM`
 * (server.ts generic, single-prompt shaped) go through this so they
 * share the retry behavior — fixes the case where /summarize / watch /
 * digest would intermittently 404 while the agent loop survived.
 */

const MAX_ATTEMPTS = 3;

export async function postOpenRouterChat(
  body: Record<string, unknown>,
  apiKey: string,
): Promise<any> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return await res.json();
    const text = await res.text();
    const isGuardrail404 = res.status === 404 && /guardrail|data policy/i.test(text);
    if (isGuardrail404 && attempt < MAX_ATTEMPTS) {
      console.warn(`[openrouter] guardrail 404 on attempt ${attempt}/${MAX_ATTEMPTS}, retrying`);
      await new Promise(r => setTimeout(r, 300 * attempt));
      continue;
    }
    throw new Error(`OpenRouter call failed: ${res.status} ${text.slice(0, 300)}`);
  }
  throw new Error('OpenRouter call: exhausted retries (unreachable)');
}
