/**
 * Single source of truth for which LLM model each Lark/router feature uses.
 *
 * Why this exists: model selection used to be inlined at every call-site as
 * `process.env.LARK_X_MODEL || 'hardcoded-default'`. Three problems:
 *
 *   1. The fallback chain was duplicated (summarize / time-parse / watch all
 *      had their own copy). Fix one, miss two.
 *   2. The hardcoded defaults could (and did) reference SKUs that don't
 *      actually exist on OpenRouter — the failure surface was at request
 *      time, in production, on user @-mentions.
 *   3. There was no observability: nothing logged what model each feature
 *      ended up using, so debugging "why is /summarize broken but agent fine"
 *      meant grepping five files.
 *
 * Now: every feature reads its slot from one immutable config built at
 * startup. The cascade (LARK_*_MODEL > OPENROUTER_MODEL > safe baseline) is
 * defined once. The resolved config is logged at startup. New features add
 * a slot here, not a fresh `process.env.???_MODEL || 'guess'` line.
 */

export interface LlmModelConfig {
  /**
   * Slash command `/summarize`, watch evaluator, periodic auto-summary cron.
   * All three reuse the same summarize prompt + parsing pipeline.
   */
  summarize: string;
  /**
   * Natural-language time-range parsing inside `/summarize` (only invoked
   * when the fast-path regex doesn't match — e.g. `/summarize 早上 10 点到现在`).
   */
  timeParse: string;
  /**
   * Lark agent — OpenAI-compatible tool-use loop for natural-language @bot
   * messages (`@bot 帮我看看大家最近在讨论什么`).
   */
  agent: string;
  /**
   * Generic `callLLM` fallback used by translate, channel digest cron, and
   * the manual digest endpoint. Equals `OPENROUTER_MODEL` when set.
   */
  generic: string;
}

/**
 * Conservative baseline used when no env var is set anywhere in the chain.
 * Picked because Anthropic SKU naming is stable (no surprise deprecations)
 * and Haiku is cheap + fast enough for every slot's typical workload, so a
 * fresh deploy with zero LLM env config still works.
 */
const BASELINE = 'anthropic/claude-haiku-4.5';

/**
 * Build the model config from environment variables.
 *
 * Cascade for each slot:
 *   1. The slot's own override (`LARK_SUMMARIZE_MODEL`, etc.)
 *   2. `OPENROUTER_MODEL` — the user's general OpenRouter pick, used by
 *      callLLM's generic fallback. Re-using it here means a deployment with
 *      one env var set still has consistent model choice across features.
 *   3. The hardcoded baseline above.
 *
 * Pure function (env-in, config-out) so tests don't need process.env stubs.
 */
export function loadLlmModels(env: NodeJS.ProcessEnv = process.env): LlmModelConfig {
  const generic = env.OPENROUTER_MODEL || BASELINE;
  return {
    summarize: env.LARK_SUMMARIZE_MODEL || generic,
    timeParse: env.LARK_TIME_PARSE_MODEL || generic,
    agent: env.LARK_AGENT_MODEL || generic,
    generic,
  };
}

/**
 * One-line summary of which model each slot resolved to. Logged at startup
 * so an operator can verify config without grepping source.
 */
export function describeLlmModels(c: LlmModelConfig): string {
  return `summarize=${c.summarize} timeParse=${c.timeParse} agent=${c.agent} generic=${c.generic}`;
}
