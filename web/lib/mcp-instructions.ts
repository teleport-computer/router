// Single source of truth for skill copy shown on register/settings pages.
//
// MCP_SKILL_INSTRUCTIONS — the baseline behavior. Auto-loaded from the MCP
//   server on connect, so users normally don't need to copy it anywhere.
//   Kept here for the "show me what Router already does" viewer.
//
// ROUTER_PERSONAL_TEMPLATE — an opt-in template users can paste into
//   ~/.claude/CLAUDE.md to teach Router *their* style: trigger words,
//   preferred tags, summary voice, things to skip.

export const MCP_SKILL_INSTRUCTIONS = `You have the Teleport Router MCP tools (router_write / router_search / router_tags / router_get_entry / router_tag).

When to sync
Sync straight away — no extra confirmation needed — when the user clearly asks for it: "sync", "push to router", "save this to router", "put this in #my-project", or the equivalent in whatever language they're using.

Proactively ask "Sync this to Router?" (without syncing yet) when the conversation hits a natural wrap-up:
- Decision landed ("let's go with this", "decided", "final call")
- Insight or discovery ("turns out...", "interesting", "I found")
- Wrap-up signal ("ok", "done", "that's it for now")
- Problem solved: bug fixed, feature working, deploy succeeded
Ask only once per conversation. If the user says no, drop it.

Language
Write the entry in whatever language the user is using. Don't translate their words into English just to look more official.

Before tagging
- Call router_tags first to see pinned presets and top team tags.
- Reuse existing tags whenever they fit. Only invent a new tag as a last resort.

After syncing, always report back
1. Confirm it synced; if the response lists "Triggered hashes: #x, #y", mention them
2. The summary you wrote
3. The tags you picked + a one-line reason
4. Entry ID + when it publishes

router_search is for looking things up in the team notebook — use it freely whenever a related topic comes up.`;

export const ROUTER_PERSONAL_TEMPLATE = `# ═══════════════════════════════════════════════════════════
# Router — my personal overrides
# Router works out of the box. Everything below is OPTIONAL — fill in
# the parts you care about, delete the sections you don't.
# ═══════════════════════════════════════════════════════════

## My extra trigger phrases
# In addition to the defaults ("sync", "push to router"), treat any of
# these as an immediate sync request (no confirmation):
# 👉 Edit to match how you actually talk
- "save this"
- "log this"
- "write it up"

## Projects and tags I care about
# Prefer reusing these tags when you sync something relevant.
# 👉 Fill in your own projects, stacks, and modules
Projects: project-x, project-y, project-z
Preferred tags: frontend, backend, decision, bug-fix, research
Tag style: lowercase + hyphens ("user-auth", not "userAuth")

## How I want summaries written
# Follow these when generating summary / content.
# 👉 Adjust to your taste
- 2–3 sentences, same language as the conversation.
- Technical entries: include one code snippet or the key file path.
- Decision entries: always include the "why" (motivation / trade-offs).
- No emoji unless the original conversation used them.

## Don't sync these
# Even if a sync signal appears, skip these:
# 👉 Add your own skip list
- Pure mechanical work — editing files, running commands, fixing typos.
- Casual chat that doesn't involve a decision or insight.
- Throwaway debugging sessions.

## After a successful sync, also
# Extra things Claude should do once the entry lands.
# 👉 Keep what you want, delete the rest
- Use router_search to find one related past entry and include it at the end of the reply as "Related".
- If the tags include #blocker or #urgent, add a clear heads-up line.
- Show only entry ID + link. Don't repeat the summary I already see.

# ═══════════════════════════════════════════════════════════
# Leave any section blank or delete it and Router falls back to defaults.
# ═══════════════════════════════════════════════════════════`;
