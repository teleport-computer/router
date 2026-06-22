/**
 * Shared instruction blocks used by BOTH the CLI skill template
 * (`cli-skill-template/router-sync.md` via `{{SHARED_*}}` placeholders) and
 * the MCP instructions returned to clients (`buildRouterMcpInstructions`
 * in `server.ts`).
 *
 * Why this exists: the two consumers used to maintain parallel hand-written
 * prose for the same rules — trigger heuristics, tag policy, language
 * guidance. Whenever one was updated, the other drifted, and Claude got
 * inconsistent guidance depending on whether the user connected via
 * Claude Code (skill) or Claude Desktop / claude.ai web (MCP). Today's
 * "Hx had to remind me to ask sync at session wrap-up" failure surfaced
 * that drift; this module is the structural fix.
 *
 * Update rule: when you change ANY block here, you don't need to touch
 * the consumers — the skill template subs at render time, and MCP
 * imports directly. Bump `cli-skill-template/router-sync.md`'s
 * skill-version too so existing CLI users re-pull.
 */

export const SHARED_TRIGGERS = `⚠️ MANDATORY SELF-CHECK — before you write any closing remark, summary, or "let's move on" sentence in your response, pause and ask yourself: "Did this conversation produce something a teammate would benefit from later?" If yes, you MUST ask "Sync this to Router?" INSIDE THE SAME RESPONSE — not after the user follows up.

Common failure mode (don't be this): you write a wrap-up summary or say "today's work is done", end the response, THEN realize you should have asked. By then the user has to remind you — which is exactly the bug to avoid.

STRONG TRIGGER PHRASES — if you catch yourself about to write any of these in your own reply, STOP and ask sync first:
  English: shipped / all done / main work cleared / wrapping up / let's move on / that closes / today's work / 收工
  中文:    收工 / 搞定了 / 全部修完 / 主线全清 / 本轮完成 / 推送完成 / 大功告成

STRONG TRIGGER MOMENTS — after producing any of these, ASK BEFORE writing the next sentence:
- A stage summary, status report, or session recap you just delivered
- A recap / summary that lists ≥2 distinct accomplishments
- "Today / this session we did X, Y, Z" multi-bullet wrap-up
- Shipped multiple commits in one session
- A root cause identified / a non-trivial bug fixed / a feature delivered
- A spec / plan / roadmap / design decision drafted
- A multi-step plan or batch of todos finished
- User said "ship it" / "looks good" / "let's move on" / "ok 收尾" / "done" / "收工"
- A non-obvious discovery or insight just emerged
- User asked you to write something durable (memo, decision log, postmortem)

Do NOT trigger on: trivial single-file edits, routine commands (cd / ls / git status), casual chat with no substance, anything the user just declined or recently synced.`;

export const SHARED_TAG_RULES = `Tag policy (reuse first, invent last):
- REUSE over invent. When an existing tag is semantically close, use it even if not a perfect match. Goal is team-wide tag reuse, not precision.
- Prefer preset tags. Prefer high-usage custom tags over low-usage ones.
- Only invent a new tag when nothing in the existing list is within reasonable semantic distance — and pick a short, generic name (lowercase + hyphens).
- 1-5 tags per entry (hard limit, server enforces). Don't pad.
- When posting to a channel, ALSO include the matching project tag so tag-based cross-channel search works (e.g. channel #my-project → also tag "my-project").`;

export const SHARED_LANGUAGE_RULE = `LANGUAGE: write summary and content in the same language the user is speaking. If the conversation is bilingual, prefer the dominant language. Don't translate user-quoted phrases into a different language to look more "official".`;
