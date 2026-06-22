/**
 * LLM synthesis for daily briefs. Two functions:
 *   - synthesizeTeamOverview()       — one paragraph summarizing today's team activity (per-team)
 *   - synthesizePersonalCallout()    — one sentence linking the user's recent work to today's team activity (per-user)
 *
 * Both take callLLM as a dependency so tests can mock it. On LLM failure or
 * "no content" sentinel from the model, both return null — callers should
 * gracefully fall back (e.g., to a structured list, or just skip the section).
 *
 * Model defaults to whatever OPENROUTER_MODEL is configured for the server
 * (typically deepseek-v3.2). At ~1500 input + 300 output tokens per call and
 * one call per (team) + one per user/day, total cost is around $5/year for a
 * 20-person team — negligible.
 */

import type { RouterEntry } from './storage.js';

export type LLMCaller = (
  prompt: string,
  opts?: { temperature?: number; maxTokens?: number; model?: string },
) => Promise<string>;

const TEAM_OVERVIEW_NO_CONTENT_MARKER = '[NO_CONTENT]';
const PERSONAL_CALLOUT_NO_CONNECTION_MARKER = '[NO_CONNECTION]';

/**
 * Render a list of entries as compact one-per-line text suitable for LLM input.
 * Stops when the output would exceed `cap` characters — prevents prompt bloat
 * from teams with hundreds of entries per day.
 */
function truncEntries(entries: RouterEntry[], cap: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const e of entries) {
    const channel = e.channel ? ` in #${e.channel}` : '';
    const tags = (e.tags ?? []).slice(0, 4).map(t => '#' + t).join(' ');
    const line = `[@${e.handle}${channel}] ${e.summary}${tags ? ' ' + tags : ''}`.trim();
    if (used + line.length + 1 > cap) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

const TEAM_OVERVIEW_PROMPT = `You're summarizing today's team activity for a busy engineer. Write 1-2 short paragraphs (max 280 chars total) covering what happened in the team in the last 24 hours.

Focus on: project progress, decisions, technical changes, key discussions.
Skip: routine work, individual @ mentions (those are pinged separately).

Be specific — name people, projects, channels (e.g., "Andrew shipped design-system v2 to #design"). Don't use vague phrases like "the team did some work".

Use the same language as the entries (Chinese if entries are Chinese, English if English, mixed is fine).

If there's nothing substantive to summarize (only routine stuff), output exactly: ${TEAM_OVERVIEW_NO_CONTENT_MARKER}

Today's entries:
{ENTRIES}`;

export async function synthesizeTeamOverview(
  callLLM: LLMCaller,
  entries: RouterEntry[],
): Promise<string | null> {
  if (entries.length === 0) return null;
  const entriesBlock = truncEntries(entries, 3000);
  if (!entriesBlock) return null;

  const prompt = TEAM_OVERVIEW_PROMPT.replace('{ENTRIES}', entriesBlock);
  let raw: string;
  try {
    raw = await callLLM(prompt, { temperature: 0.3, maxTokens: 400 });
  } catch {
    return null;
  }
  const out = (raw || '').trim();
  if (!out || out.includes(TEAM_OVERVIEW_NO_CONTENT_MARKER)) return null;
  return out;
}

const PERSONAL_CALLOUT_PROMPT = `You're spotting collaboration opportunities for a team member.

This user (@{HANDLE}) has been working on these recent entries:
{USER_ENTRIES}

Today the team produced these entries:
{TEAM_ENTRIES}

Find ONE specific, concrete connection between the user's recent work and today's team activity that they should know about. Examples of good output:
- "Claire is doing a backend migration that touches the same tables as your timeline refactor — worth syncing on schema."
- "Andrew just shipped design tokens v2; if you're touching frontend, it might affect your componentry."

Rules:
- Be concrete. Name the entry/person/topic.
- 1-2 sentences max.
- Use the same language as the user's entries.
- If you can't find a real, specific, actionable connection, output exactly: ${PERSONAL_CALLOUT_NO_CONNECTION_MARKER}

Don't force connections. "${PERSONAL_CALLOUT_NO_CONNECTION_MARKER}" is a perfectly fine answer when no real overlap exists.`;

export async function synthesizePersonalCallout(
  callLLM: LLMCaller,
  userHandle: string,
  userRecentEntries: RouterEntry[],
  teamEntriesWeek: RouterEntry[],
): Promise<string | null> {
  if (userRecentEntries.length === 0 || teamEntriesWeek.length === 0) return null;

  const userBlock = truncEntries(userRecentEntries, 1200);
  const teamBlock = truncEntries(teamEntriesWeek, 1800);
  if (!userBlock || !teamBlock) return null;

  const prompt = PERSONAL_CALLOUT_PROMPT
    .replace('{HANDLE}', userHandle)
    .replace('{USER_ENTRIES}', userBlock)
    .replace('{TEAM_ENTRIES}', teamBlock);

  let raw: string;
  try {
    raw = await callLLM(prompt, { temperature: 0.4, maxTokens: 200 });
  } catch {
    return null;
  }
  const out = (raw || '').trim();
  if (!out || out.includes(PERSONAL_CALLOUT_NO_CONNECTION_MARKER)) return null;
  return out;
}
