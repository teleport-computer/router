# M2b — Manual E2E Verification Checklist

Run before merging M2b.5 to main. Requires a real Lark dev tenant and `ngrok` (or equivalent) for `/api/lark/card-callback`.

## Prereqs
- [ ] Lark App credentials in `server/.env`
- [ ] `LARK_BOT_ENABLED=true`
- [ ] `LARK_VERIFICATION_TOKEN` matches Lark App console
- [ ] Bot scopes include: im:message, im:chat, contact:user.base:readonly
- [ ] Card callback URL in Lark console = `https://<ngrok>/api/lark/card-callback`

## Bind a chat
- [ ] In Lark client, pull bot into a test group
- [ ] In router web → Channels → pick a channel → Lark tab
- [ ] Click "Bind new group" → modal lists the test group → click Bind
- [ ] Reload page → binding shows in list

## /summarize
- [ ] In test group: `@RouterBot /summarize` → bot replies with a card showing "最近 30 分钟"
- [ ] `/summarize 1h` → card shows "最近 1h"
- [ ] `/summarize today` → card shows "今天 00:00 至今"
- [ ] `/summarize 帮我看看早上 10 点到现在` → card shows interpretation matching natural language
- [ ] `/summarize` again within 5 min → bot replies rate-limit card
- [ ] In an unbound group: `/summarize` → bot replies "本群未绑定 router channel"

## Card buttons
- [ ] Trigger a router entry that fires a channel skill into the bound chat (write a new entry tagged with the channel)
- [ ] Card appears with three buttons
- [ ] Click "已读" → toast "已记录已读"
- [ ] Click "评论" → opens router web entry page with comment focus
- [ ] Click "打开" → opens router web entry page

## Audit
- [ ] Verify Postgres: `SELECT action, count(*) FROM lark_card_actions GROUP BY action;` shows clicks recorded

## Health
- [ ] `curl http://localhost:3000/health` returns `{"ok":true,"lark_ws":{"connected":true,"lastEventAt":...}}`

---

## M2b.5 (Save + In-Chat Connect) Verification

### In-chat commands
- [ ] In Lark group: `@bot help` → bot replies with help card listing 5 commands
- [ ] `@bot 帮助` (Chinese alias) → same help card
- [ ] `@bot connect feedling` → "已连接「群名」到 #feedling" success card
- [ ] Re-run `@bot connect feedling` → "本群已绑..." error card
- [ ] `@bot archive shipped` → "归档目标改为 #shipped"
- [ ] `@bot disconnect` → "已解绑..."
- [ ] Random text `@bot foobar` → bot replies with help card

### Save summary
- [ ] In bound group: `@bot /summarize` → card has [📂 #feedling ▼] dropdown + [💾 保存] button
- [ ] Click 💾 保存 with default → toast "✅ 已保存到 #feedling → https://..."
- [ ] In router web → #feedling → see entry, author=`lark-bot-{teamId}`, tag=`lark-summary`
- [ ] Open entry: content has `> 整理：@xxx · 来自 Lark 群「群名」 · ⏰ ...` header
- [ ] Empty sections (e.g. `Open questions: []`) NOT rendered in card or entry

### Privacy / web
- [ ] router web → channels → Lark tab: read-only list, no "绑定新群" button
- [ ] curl `POST /api/lark/chats/joined` → 404
- [ ] curl `POST /api/lark/bindings` → 404
- [ ] curl `GET /api/lark/bindings?channel_id=feedling` → still works (200)
- [ ] curl `DELETE /api/lark/bindings/oc_xxx` → still works (with auth)

### Error cases
- [ ] `@bot connect nonexistent` → "找不到 channel #nonexistent"
- [ ] Non-admin tries `@bot connect feedling` → "你不是 #feedling 的管理员"
- [ ] Save card click after 1h+ → toast "卡片已过期"
- [ ] Save with deleted channel → toast "已删除"
