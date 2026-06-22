# CLAUDE.md

Project-level notes for Claude Code working in this repository.

## Lark Phase 1 (M2b) — Bot in Group

`feat/lark-phase-1` adds:
- WebSocket event client (long-poll), enabled with `LARK_BOT_ENABLED=true`
- `lark_chat_bindings` table mapping Lark chat_id → router channel
- `@bot /summarize [args]` produces a structured card via DeepSeek-V3.5
- Channel cards now carry "已读 / 评论 / 打开" buttons (when chat is bound)
- HTTP `/api/lark/card-callback` for button-action audit

See `docs/lark/M2b-e2e-checklist.md` for manual smoke before merge.

## Lark Phase 1.5 (M2b.5) — Save-to-Router + In-Chat Connect

`feat/lark-phase-1` (M2b.5 commits) adds:
- 5-section summary cards (TL;DR / Updates / Decisions / Todo / Open questions) — English titles, empty sections skipped
- 💾 保存按钮 on summary cards → creates `lark-summary`-tagged entry, authored by auto-seeded `lark-bot-{teamId}` system user, skips staging
- `archive_channel_id` per binding for "primary channel ≠ archive destination"
- In-chat commands: `@bot connect <channel>` / `@bot disconnect` / `@bot archive <channel>` / `@bot help` (Chinese aliases supported)
- Web Lark tab is read-only; web modal removed; privacy fix: `/api/lark/chats/joined` and `POST /api/lark/bindings` deleted

