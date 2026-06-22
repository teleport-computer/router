# Router — User Guide

> 🌐 **Language** · **English** · [中文](./USAGE.zh.md)

Router is a team-shared notebook for Claude conversations. You chat with Claude the way you always do — when something's worth keeping, say "sync" and Claude turns the important parts into an entry everyone on the team can read, search, and build on.

**Live site**: <https://router.feedling.app>

Switch UI language (English / 中文) in Settings.

---

## Contents

- [3-minute setup](#3-minute-setup)
- [Three ways to sync](#three-ways-to-sync)
- [What happens after a sync](#what-happens-after-a-sync)
- [Browsing and searching](#browsing-and-searching)
- [Channels — topics and subscriptions](#channels--topics-and-subscriptions)
- [Channel Skill — teach Claude your channel's voice](#channel-skill--teach-claude-your-channels-voice)
- [Webhook Skill — push to Lark / HTTP](#webhook-skill--push-to-lark--http)
- [Personal notification webhook — get pinged when you're mentioned](#personal-notification-webhook--get-pinged-when-youre-mentioned)
- [Feedback](#feedback)
- [FAQ](#faq)

---

## 3-minute setup

### Step 1 — Create an account / join a team

Go to <https://router.feedling.app/register>:

- **Create a Team** — pick a handle (lowercase letters, digits, underscore, e.g. `alex`) and a team name. You'll get back a secret key. **Save it immediately** — this is your identity. There's no password reset.
- **Join a Team** — paste the invite link your admin shared, or enter the invite code manually.

### Step 2 — Connect Claude

Open Settings → "Connect Claude" and pick your client:

- **Claude Code (CLI)** — copy this command into your terminal:
  ```
  claude mcp add router --transport sse --scope user "https://router.feedling.app/mcp/sse?key=YOUR_KEY"
  ```
- **Claude Desktop / Web** — copy the MCP URL, then Settings → Connectors → Add custom connector.
- **OpenAI Codex / Cursor / Windsurf** — see the Codex tab in Settings for a one-click `.codex/config.json` template; Cursor and Windsurf accept the same config shape.

That's it. Router's skill is auto-loaded from the MCP server on connect — you don't need to copy anything into CLAUDE.md.

### Step 3 — Try it

Open Claude, chat about anything technical, then say **"sync"** or **"sync to router"**. Claude will generate a summary, pick tags, and post to Router. Refresh <https://router.feedling.app> and it should be there.

---

## Three ways to sync

Router's core action is "sync" — turning a worthwhile moment in your Claude conversation into a persistent entry the team can see. Three ways it happens:

### ① Manual sync (fires immediately)

Tell Claude any of these and the entry is posted right away:

| Trigger | Works in |
|---------|----------|
| "sync" / "sync to router" / "push to router" | English |
| "save this" / "log this" / "write it up" | English |
| "同步" / "同步一下" / "记一下" | Chinese |
| "同步到 router" / "推送到 router" | Chinese |

Target a channel by naming it:

```
sync this to #feedling
push to #design
```

### ② Claude asks you (needs confirmation)

When the conversation hits a natural wrap-up signal, Claude will quietly ask at the end of its reply:

> "Sync this to Router?"

Signals it watches for:

- **Decision landed**: "let's go with this", "final call", "decided"
- **Insight or discovery**: "turns out…", "I found…", "interesting"
- **Problem solved**: bug fixed, feature working, deploy succeeded
- **Natural wrap-up**: "ok", "done", "that's it for now"

Say "yes" or "sync" to confirm, "no" or "skip" to decline. Claude only asks once per conversation.

### ③ When Router stays quiet

- Pure execution — file edits, command runs, typo fixes
- Casual chat with no decision or insight
- Anything you explicitly say "don't record" or "skip this" about

---

## What happens after a sync

Claude's reply always includes four things:

```
✅ Synced to Router (and the channel, if you named one)
📝 The summary it wrote (so you can verify)
🏷️ The tags it picked + a one-line reason
🔗 Entry ID + staging time + link
```

**15-minute staging window**: the entry is pending for 15 minutes. During this window:

- Only you can see it
- You can delete it from the Dashboard
- You can click "Publish now" to skip the wait
- You can edit the summary / content / tags / **channel** — pending entries are fully editable
- After 15 minutes it auto-publishes to the team and may fire channel webhooks

You can change the staging delay in Settings → Publishing Delay, including setting it to 0 (publish immediately).

---

## Browsing and searching

Once you're logged in, <https://router.feedling.app> is your Dashboard:

### Filters

- **Click a tag** — filter by that tag. Click again to clear.
- **Click an author** — only see that teammate's entries.
- **Search** — the magnifier button bottom-right. Supports keywords or `@handle`.
- **Tag presets** — save your most-used tag combinations as one-click shortcuts.

### Navigation

Top nav:

- **🔔 Notifications** — red dot when someone comments or @-mentions you
- **Channels** — browse channels, subscribe/unsubscribe, configure channel skills
- **Members** — see teammates and their recent entries
- **Bookmarks** — entries you saved
- **Guide** — this document
- **Settings** — profile, Claude connection, delay, personal webhook, language
- **Profile** — your own page

### Per-entry actions

Each entry card has a `···` menu with:

- **Bookmark** — save for later
- **Copy summary** — plain text to clipboard
- **Share link** (published entries only) — copies oneliner + link, ready to paste in chat
- **Edit**, **Hide**, **Delete** — only shown on your own entries

The bottom of each entry also has:

- **Show full content** — expand the markdown body with Copy / Download .md buttons

---

## Channels — topics and subscriptions

A channel is a topic-scoped sub-feed inside your team. You might have:

- `#feedling` — all discussion about the Feedling product
- `#design` — design decisions
- `#daily` — daily standups
- `#feedback` — product feedback (Router auto-creates this the first time you submit feedback)

### How to use channels

- **Write** — tell Claude "sync to #feedling" and the entry posts to that channel
- **Subscribe** — `/channels` → click a channel → Join (or use an invite code for invite-only channels)
- **Leave** — same page, Leave button
- **Browse** — Dashboard filters by channel too

### Channel permissions

- **Open channel** — anyone can join
- **Invite-only** — needs a code from a channel admin

---

## Channel Skill — teach Claude your channel's voice

This is Router's most powerful feature. For any channel, you can write a **channel briefing** — a free-form document that tells Claude anything you want it to know or do before posting there:

- Background and glossary for the project
- What to look up before writing (past entries, related threads, specific people's work)
- Required output format
- Which tags are mandatory
- Default perspective (frontend / backend / product / etc.)

**Claude must read and apply this briefing before any entry is saved to the channel.**

### Example

Here's a skill you might add to `#feedling`:

```markdown
## Background
Feedling is an information-stream product. React + Next.js 16.
Core modules: infinite-scroll, story-card, tag-bar.
Team: @alex (frontend), @bob (backend), @cara (design).

## Glossary
- "infinite-scroll" (not "infinite scroll")
- "story card" (not "card")
- "tag bar" refers to the Dashboard filter row only, not the
  tag chips inside an EntryCard

## Before writing
- Search this channel for related discussions from the past
  week; if you find one, cite it in the summary
  ("continues @alex's xxx")

## Format & tags
- Technical decisions: Problem / Options / Pick / Why
- Anything about performance or loading: always tag #perf
- Anything about accessibility: always tag #a11y
- No emoji

## Default perspective
Frontend, unless the content is clearly backend.
```

Next time someone says "sync to #feedling", Claude will:

1. Read the skill
2. Use Router's search tools to actually look up recent entries for context
3. Structure the summary per the rules, pick the right tags, use the right voice
4. Tell you in the final reply: **"Applied 'Background', 'Format & tags'"** so you know what shaped the entry

### Creating a channel skill

`/channels/<id>` → Skills tab → Create skill → choose **📖 Channel Skill** → fill in the 👉 marks.

### Key characteristics

- **Any team member can edit** — not admin-only
- **Takes effect immediately** — no MCP reconnect needed. The server reads skills live from the database on every write.
- **Stack multiple** — you can have several skills on one channel (background, style, format), and Claude applies them all
- **Natural language, not code** — don't write function names. Describe what you want Claude to do in plain English or Chinese; it figures out which tools to call on its own.

---

## Webhook Skill — push to Lark / HTTP

The second kind of skill: when an entry lands in the channel, the server POSTs to a URL you specify. Use this for:

- Pushing to a Lark group bot (whole group sees a card)
- Pushing to a Lark Bitable (auto-creates a spreadsheet row, great for feedback tracking)
- Slack / Discord / Telegram bots
- Any custom HTTP webhook

### Create one

`/channels/<id>` → Skills tab → Create skill → **🔔 Webhook Skill**:

- **Webhook URL** — paste the target
- **Lark message format** — Card (rich text, recommended) or plain text
- **Trigger conditions** (optional):
  - **Tags** — only fire if the entry has any of these tags
  - **Authors** — only fire if the entry is by any of these people
  - **Empty** — fires for every entry
  - Tags and authors are combined with OR, not AND — any match triggers

### Message contents

The pushed message always includes:

- Channel + author handle
- Summary
- Tags
- **View entry link** — tap to jump to the entry detail page
- Timestamp

### Common recipe: feedback into a Lark spreadsheet

1. Feedback from the `💬 Feedback` button auto-goes to `#feedback`
2. Add a Webhook Skill to `#feedback` pointing at a Lark Bitable webhook
3. Every feedback → entry in DB → auto-POST to Lark → new row in your spreadsheet
4. Triage from inside Lark (assign, tag, mark resolved)

---

## Personal notification webhook — get pinged when you're mentioned

The channel webhook skill above is a **broadcast** — everyone in the group sees it. The personal webhook is **just for you**: when someone mentions you or comments on your entry, Router pings a URL you control.

### Setup

**Settings → Personal notification webhook → paste URL → Save.**

The message is sent in **your language** (as selected in Settings), not the sender's.

### Recommended setup for Lark

Lark doesn't have real personal webhooks, but here's a trick that gives you the same experience:

1. Create a new Lark group with **just yourself** in it
2. Group settings → Bots → Add bot → Custom Bot
3. Copy the webhook URL and paste it into Router's personal webhook setting

Now when someone mentions you, the notification lands in that single-person group. On mobile you get a real push notification — effectively a personal DM.

### What it supports

The backend auto-detects Lark URLs and sends a styled interactive card. For any other URL, it sends a generic JSON envelope:

```json
{
  "type": "mention",
  "fromHandle": "alex",
  "recipient": "you",
  "preview": "First 80 chars of the comment",
  "entryId": "mn...",
  "title": "@alex mentioned you",
  "link": "https://router.feedling.app/entry?id=mn..."
}
```

So Slack, Telegram bots, Discord, email-to-webhook services, or any custom endpoint all work.

### When it does NOT fire

- Browser tab open / closed — doesn't matter, webhooks are server-side
- Self-mentions or commenting on your own entry — skipped
- Pending entries (still in the 15-min staging window) — fires only once they publish

---

## Feedback

Bottom-right of the Dashboard: 💬 Feedback button. Click it and:

- Pick a category: 🐛 Bug / 💡 Idea / 🎨 UX / 💬 Other
- Write your thoughts
- Cmd+Enter to send

Feedback is stored as a regular Router entry in your team's `#feedback` channel, so it's searchable, taggable, and can be commented on. Want it to auto-flow into a Lark spreadsheet? Add a Webhook Skill to `#feedback` (see above).

---

## FAQ

### Claude asked "Sync this to Router?" and I didn't answer. Can I still sync?

Yes — just say "sync" any time later in the conversation. Claude will handle it.

### I accidentally synced something sensitive

Open the Dashboard within 15 minutes, find the entry, delete it. After publishing you can still delete your own entries, but teammates may already have seen them.

### My new Channel Skill isn't showing up in Claude

Channel Skills are read fresh from the database on every `router_write` call. You don't need to reconnect MCP — the next sync to that channel already uses the new skill.

### Why doesn't my new Tool Skill show up?

Tool Skills are disabled in v1 — there's no UI for them and they aren't injected into the MCP tool list.

### When do I need to reconnect MCP?

Almost never. Only when we ship a new Router version that changes the MCP tool schema — the Dashboard will show an amber banner telling you to reconnect. In normal use you never need to.

### Will a synced entry include the project context automatically?

If you're running Claude inside a project directory (has `.git` or a `CLAUDE.md`), Claude prefixes the summary with `[project: <repo> @ <branch>]` so the team knows the entry's home base.

### Can I publish a pending entry immediately?

Yes — click "Publish now" on any pending entry. It fires all configured webhooks just like an auto-publish would.

### I lost my secret key. How do I recover it?

There's no recovery. This is intentional: no password, no email required. Save your key in a password manager the moment you register. If you lose it, ask an admin to invite a new account under a different handle.

---

## What's next

- Spend 5 minutes on `/channels`, subscribe to anything that's relevant to your work
- Configure your [personal notification webhook](#personal-notification-webhook--get-pinged-when-youre-mentioned) so mentions reach you wherever you are
- Pick one channel you care about and write a [Channel Skill](#channel-skill--teach-claude-your-channels-voice) so Claude posts there in your team's voice
- Send anything that bugs you to [Feedback](#feedback)
