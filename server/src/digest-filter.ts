export const AUTO_DIGEST_TAG = 'auto:digest';

/**
 * Prefix prepended to the `summary` field of every router-bot-authored
 * digest entry. Acts as a cross-bot marker: when a Lark group summary bot
 * (or any other automation that scans message bodies) sees this token at
 * the start, it knows the message is itself a bot-generated summary and
 * should skip it — preventing "summary of summary" loops if a router
 * digest gets posted into a Lark group with auto-summary enabled.
 *
 * Convention shared with the team — documented in
 * docs/superpowers/specs/2026-05-13-weekly-brief-design.md (#6 follow-up).
 */
export const BOT_DIGEST_SUMMARY_PREFIX = '[bot-digest] ';

export function excludeAutoDigest<T extends { tags?: string[] }>(entries: T[]): T[] {
  return entries.filter(e => !(e.tags ?? []).includes(AUTO_DIGEST_TAG));
}

/**
 * Pull the real summary out of an LLM-generated digest body. The default
 * template asks the LLM to end with a `### Summary` (or `### 总结` / `### 摘要`)
 * paragraph; that paragraph is the actual TL;DR — far more useful as the
 * entry's `summary` field than the auto-generated `"Weekly digest for #x — N
 * entries"` metadata stub. Falls back to `fallback` when the regex can't find
 * a plausible section (custom channel instructions, malformed LLM output,
 * extreme length).
 */
export function extractDigestSummary(content: string, fallback: string): string {
  // Find a heading like "### Summary" / "## 总结" and capture the body until
  // the next heading or end of string. Multi-line, case-insensitive. `[\s\S]`
  // lets `.` cross newlines; non-greedy stops at the first following heading.
  const pattern = /^#{2,4}\s+(?:Summary|Overview|TL;DR|总结|摘要|概述|总览)\s*:?\s*\n+([\s\S]+?)(?=\n#{2,4}\s|\s*$)/im;
  const m = content.match(pattern);
  if (!m?.[1]) return fallback;
  const text = m[1].trim();
  // Guardrails: too short means we caught a heading-only stub; too long
  // probably means the regex swallowed the whole document.
  if (text.length < 20 || text.length > 800) return fallback;
  return text;
}
