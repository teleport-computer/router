<!-- skill-version: 1.0.14 -->
<!-- skill-content-hash: AUTO -->

---
name: router-sync
description: |
  Sync conversation summaries to Teleport Router (team shared notebook).

  USE WHEN any of these signals appear (mention or moment — match on intent, not exact wording):
  收工 / 主线全清 / 搞定了 / 全部修完 / 大功告成 / 推送完成 / 本轮完成 / 沉淀 / 决策 / 总结 / 复盘 / 根因 /
  shipped / all done / main work cleared / wrapping up / let's move on / today's work / session recap /
  multi-step plan finished / root cause identified / spec drafted / design decision / postmortem /
  retro / milestone / lessons learned / non-obvious insight / record this / save to router / sync /
  推到 router / 存到 router / 同步.

  SKIP this skill when: trivial single-file edits, routine commands (cd / ls / git status), casual chat
  with no substance, anything the user just declined or recently synced. Don't fire on every code change
  or every reply — only on noteworthy moments.

  ━━━ WHEN TO ACT ━━━

{{SHARED_TRIGGERS}}

  PRIMARY MODE — judge for yourself: whenever the conversation produces something a teammate would benefit from later, act on it. You are responsible for noticing — do not wait for keywords. The triggers above are the COMMON cases; the principle is broader.

  ━━━ EXPRESS REQUEST ━━━

  Sync without the proactive ask when user signals intent:
  - English: "sync", "save to router", "push to router", "log this", "record this"
  - 中文: 同步、记一下、推到 router、存到 router、保存这个
  - Other languages welcome — judge intent over exact wording.
  Express request still goes through the PREVIEW GATE — express means "skip the 'should we sync?' question," NOT "skip the preview confirmation."

  ━━━ GATE ━━━

  Before any router write, call `router context` and branch on sync_mode:

  • sync_mode = "active" (default):
    PROACTIVE TRIGGER → ask "Sync this to Router?" once per noteworthy moment. Stop asking for the rest of the session after 3 declines.
    PREVIEW GATE → check `preview_mode`:
      - "always" (default): MUST show preview block (summary / oneliner / tags / channel / content outline) and wait for explicit confirm. Applies to BOTH proactive and express paths.
      - "never": skip preview, write directly.
    In-conversation override: user says "skip preview" / "直接发" / "just push it" → skip preview for THAT one write only. Don't change stored preference. After 3 such overrides in a session, ASK ONCE: "You've skipped preview 3 times — turn it off by default?" If yes, PATCH /api/users/me/preferences with `{"preview_mode":"never"}`.

  • sync_mode = "passive":
    Do NOT ask. Apply the same producer-side triggers above to detect noteworthy moments, then push silently. Apply privacy_strip_patterns to scrub secrets / keys / passwords / paths. After push, tell user: "📤 Auto-pushed to #xxx: <summary>. Entry: <id>. 15min staging — `router delete <id>` to undo."

  ━━━ MODE-SWITCH HINT ━━━

  Track per-session counters: active_confirms, passive_pushes. When either reaches 3 (once per session per direction), append a 1-line tip to that sync's report:
  - active@3: "💡 You've confirmed 3 syncs this session. Switch to passive (auto-push with privacy strip)? Or change later at /settings/sync."
  - passive@3: "💡 I've auto-pushed 3 entries this session. Switch to active (ask first)? Or change later at /settings/sync."

  If user replies with explicit affirmative ("切" / "switch" / "yes" / "go ahead" / equivalent — NOT casual "ok" / "嗯"), PATCH /api/users/me/preferences with the new sync_mode and confirm: "✓ Switched to <mode>. Change anytime at /settings/sync." If user doesn't engage, drop — don't repeat the tip this session.

{{SHARED_LANGUAGE_RULE}}
---

# Router Sync Skill

When triggered (per the description), follow these steps:

1. Get the current rules:
   $ router context
   Returns: sync_mode, sync_triggers, tag_rules, preset_tags, channels, privacy_strip_patterns.

2. Decide a 2-3 sentence summary, 1-5 tags, optional channel.

{{SHARED_TAG_RULES}}

3. **Active mode + preview_mode=always**: show preview, wait for confirm.

4. **Passive mode**: skip preview; strip privacy patterns; push directly.

5. Write the entry:
   $ router write "summary" --tag t1,t2 --channel xxx
   Optional: --content "<md>" --search-keywords k1,k2 --oneliner "..."

6. After success, tell the user:
   - Entry ID + "publishes in 15 min"
   - Tags + 1-line reason
   - Link: {{ROUTER_BASE_URL}}/entry?id=<id>
   - Passive mode: also include `router delete <id>` undo hint
   - If session counter hit 3 (this direction): append the mode-switch tip

## When to ask (categories of noteworthy moments)

Think about what a teammate would want to find later:

- **Work completed**: bug fixed, feature shipped, deploy succeeded, tests passing after a tricky fix, PR ready, todos batch done, session wrapping up ("ship it", "looks good", "let's move on")
- **Ideas / decisions**: creative solution ("what if we..."), actionable brainstorm result, design decision with trade-offs, architecture outlined, reusable pattern / template / skill created
- **Knowledge captured**: root cause identified ("turns out the problem was..."), non-obvious discovery, research summary (comparing tools / evaluating options), process documented
- **Plans / strategy**: roadmap or spec drafted, priorities agreed, scope defined or cut, timeline / milestone set

## When NOT to ask / push

- Trivial single-file edits
- Routine commands (`cd`, `ls`, `git status`, etc.)
- Casual chat with no substance
- Anything the user just declined or recently synced

## Cadence

- Only act once per noteworthy moment, not after every message
- After the user declines a proactive ask, drop that moment — don't re-ask
- After 3 declines this session, stop proactive asks for the rest of session (still respond to explicit sync requests)
- Mode-switch tip: at most once per session per direction; never repeat

## Language

Write summary and content in the same language the user is using. If bilingual, prefer the dominant language. Don't translate user-quoted phrases.

## Channel skills (when posting to a channel that has one)

If `router context` returns a channel with a non-empty `skill` field, that team has written channel-specific instructions. Treat the skill text as INSTRUCTIONS, not just style notes:

1. Read the skill text in full. It may ask you to look up history by tag, check a specific person's entries, cross-reference related discussions, follow specific terminology, etc.
2. CARRY OUT any lookups the skill requires (`router search`, `router get`). Don't skip them or invent results.
3. Apply the skill's background / terminology / format / tag rules ON TOP OF the global rules.
4. After writing, name each applied channel skill in your final reply to the user ("Applied channel skills: <name>") so they know what shaped the entry.

Channel skills are ADDITIVE to global rules — never override "When NOT to ask / push" or PREVIEW GATE.

## Hyperlink router references

Whenever you reference a router resource in your reply to the user — entry id, channel, profile, or settings page — render it as a clickable markdown link using `{{ROUTER_BASE_URL}}` from `router context`. Never bare ids/paths:

  • Entry: `[#mnk5xyz]({{ROUTER_BASE_URL}}/entry?id=mnk5xyz)`
  • Channel: `[#frontend]({{ROUTER_BASE_URL}}/channels/frontend)`
  • Profile: `[@andrew]({{ROUTER_BASE_URL}}/profile/andrew)`
  • Settings: `[Team Memory]({{ROUTER_BASE_URL}}/settings/memory)`

Tool results (from `router search`, `router get`, `router brief`) include the full URL — preserve it when you summarize. The user can't click bare text.

## Hyperlinks inside entry content (mandatory)

Every URL or referenced resource in the entry's `summary` / `content` markdown must be a clickable markdown link. Bare ids, paths, or pasted URLs are dead text for everyone reading the entry later.

This covers **3 categories**:

### a) Code repo references

1. Run `git remote get-url origin` in the project to get the live repo URL. Don't guess from memory; origin can change (rename, org transfer).
2. Add a `**Repo**: [name](url)` line near the top of the entry content so readers can jump to the repo root with one click.
3. Hyperlink every code reference inline:
   - Commit SHA → `[abcd123](https://github.com/<org>/<repo>/commit/<full-sha>)`
   - File path → `[path/file.ts](https://github.com/<org>/<repo>/blob/<branch>/path/file.ts)`
   - PR / issue → `[#123](https://github.com/<org>/<repo>/pull/123)`

### b) Router's own resources

Use `{{ROUTER_BASE_URL}}` (from `router context`):
   - Entry: `[#mnk5xyz]({{ROUTER_BASE_URL}}/entry?id=mnk5xyz)`
   - Channel: `[#frontend]({{ROUTER_BASE_URL}}/channels/frontend)`
   - Profile: `[@andrew]({{ROUTER_BASE_URL}}/profile/andrew)`
   - Settings: `[Team Memory]({{ROUTER_BASE_URL}}/settings/memory)`

### c) External sources / citations / references

Any external URL the entry cites — articles, blog posts, docs, RFCs, StackOverflow answers, YouTube videos, papers, tickets, etc. — must be a markdown link with **descriptive anchor text**, not the raw URL:
   - ✅ `we followed the approach in [the React 19 actions RFC](https://github.com/reactwg/react-19/discussions/123)`
   - ❌ `we followed https://github.com/reactwg/react-19/discussions/123`
   - ❌ `we followed [this](https://github.com/reactwg/react-19/discussions/123)` (anchor text "this" is useless)

Anchor text should be readable in isolation: someone scanning the entry should know what each link goes to without reading surrounding sentences.

Applies to both Chinese and English entries. The rule covers anything inside `summary` or `content`, NOT the conversation reply you give the user.

## Memory injection (pull relevant context)

This skill is bidirectional. Don't only push to Router — pull from it when prior team thinking would change your answer.

- **`router search <keywords>`** — surface entries the team already wrote.

  **MEMORY-FIRST RULE**: if the user asks a team-fact question ("我们/our/team" + what/who/which/stack/convention/role), call `router memory` FIRST instead of searching. Memory is the canonical source for facts. Only search router for the cases below.

  PROACTIVELY call (no permission needed) on ANY of these triggers:
  1. **User asks WHY / WHEN / WHO / HISTORY about something Memory mentions** — "为什么选 Zustand" / "X 是怎么决定的" / "上周/之前" / "andrew 这周做啥" / "@handle ...". Memory has WHAT, router has WHY.
  2. **User starts non-trivial work on a topic by name** — "I'm refactoring auth middleware" / "add a feature for X" / "rewrite Y module" → search the topic to find prior design / decisions.
  3. **User explicitly says "search router / 查 router"** — always search.

  At session start, if user states a clear focus area, do one grounding search.

  Do NOT search for: pure technical / general questions with no team angle, totally unrelated topics, same keyword set already searched, OR plain team-fact questions ("what stack do we use") — those go through `router memory` first.

  ETIQUETTE:
  - 0 hits → silently use Memory + general knowledge to answer. Do NOT say "I searched router but found nothing" — user didn't ask, doesn't need to know.
  - Hits → cite (entry id + 1-line gist), don't dump the whole entry.
  - Max 1 search per same keyword set per conversation.

- **`router memory`** — team's static Memory doc (admin-maintained: people, tech stack, conventions, long-term goals). Call when:
  - User starts work that touches team conventions or shared decisions ("我们怎么 X" / "这个项目用啥栈" / "@andrew 负责什么")
  - User mentions a teammate by handle and you don't already know who they are
  - User asks "what does our team do" / "who's on the team" type questions
  - Generally: at the start of a clearly team-flavored work session

  Do NOT call:
  - For pure technical questions unrelated to team setup ("how to write a for loop")
  - Repeatedly in the same session — Memory is static within a session, call once and reuse
  - When the user is solo-debugging code with no team angle

  Memory has WHAT (the facts). For WHY/WHEN/WHO/HISTORY, also call `router search`.

- **`router brief`** — per-user "since you were gone" recap (Concierge). 5 groups: @ you / replies to you / new entries in subscribed channels / team milestones / your topic interests. **Read-only — same content as the daily 10am Beijing Lark push.** Calling does NOT advance any "seen" marker, so you can call repeatedly and see the same accumulating brief until tomorrow morning's cron re-runs. Use when the user asks "what's new" / wants fresh team context mid-session. "No new activity" is fine — just continue silently.

## CLI vs MCP tools — pick CLI when both are available

If you see BOTH this skill loaded AND `router_write` / `router_search` / `router_*` MCP tools in your tool list, the user has Router connected via two paths. **Always prefer the CLI commands described in this skill.** Do not call MCP `router_*` tools when this skill is loaded.

Reasons:
- This skill's behavior gates (PREVIEW GATE, MODE-SWITCH HINT, producer-side triggers) only apply to CLI commands. MCP tools bypass them.
- Double paths cause unpredictable choices and double-write risk.

If you ever see entries you didn't expect, mention it to the user — they may need to run `claude mcp remove router` to drop the redundant MCP connector now that CLI is installed.

## Other commands

- router list           — recent entries
- router search <q>     — keyword search
- router get <id>       — entry details
- router delete <id>    — delete (within 15-min staging)
- router brief          — recent activity (read-only; same as daily Lark push)
- router memory         — team memory doc (call before significant work)

## If `router` command not found

  $ npm install -g @teleport-computer/router-cli && router init
