# Teleport Router — HTTP API Integration Guide

A practical reference for integrating an external service (a Matrix bot, a CI hook, a custom agent, etc.) with a Teleport Router instance over plain HTTP.

> **Discoverability note**: every Router instance exposes a self-describing endpoint at `GET /api` which returns a JSON list of all routes. This document expands that list with auth details, request/response shapes, and curl examples.

---

## Table of contents

- [Base URLs](#base-urls)
- [Authentication](#authentication)
- [Quick start — write your first entry](#quick-start)
- [Core entry endpoints](#core-entry-endpoints)
- [Channels](#channels)
- [Tags](#tags)
- [Identity and team setup](#identity-and-team-setup)
- [Matrix account linking](#matrix-account-linking)
- [Search](#search)
- [Comments](#comments)
- [Notifications and webhooks](#notifications-and-webhooks)
- [Staging behavior](#staging-behavior)
- [Error format](#error-format)
- [Rate limits](#rate-limits)
- [Versioning](#versioning)

---

## Base URLs

Each Router deployment is independent. Pick the one you're integrating with:

| Instance | URL | Notes |
|---|---|---|
| **Lark** (主, internal team) | `https://router.feedling.app` | Production, with Lark integration |
| **Shape Rotator** | `https://shaperotator.teleport.computer` | English-only, no Lark, IP for now — real domain (likely `https://shape.feedling.app`) coming soon |

The two instances have **completely isolated databases** — accounts, entries, tags, and channels do not cross over.

All paths below are relative to your chosen base URL.

---

## Authentication

Every authenticated endpoint accepts a **secret key as a query parameter**:

```
?key=YOUR_SECRET_KEY
```

That's it. No `Authorization` header, no OAuth, no bearer tokens. The secret key acts as a long-lived bearer credential — keep it server-side, never embed in clients.

**Endpoints that don't require auth:**

- `GET /api` — endpoint listing
- `GET /api/server-info` — feature flags
- `GET /health` — health check
- `POST /api/identity/generate` — bootstrap a new key
- `POST /api/team/create` — first signup
- `POST /api/team/join` — join with invite code

Everything else (`/api/entries`, `/api/channels`, etc.) requires a valid `?key=`.

---

## Quick start

The end-to-end flow for a fresh integration:

### 1. Generate a key

```bash
curl -X POST https://router.feedling.app/api/identity/generate
```

Returns:

```json
{
  "secret_key": "AbCdEf...",
  "pseudonym": "happy-otter-42",
  "warning": "Save this key securely. If lost, this identity cannot be recovered."
}
```

Store `secret_key` server-side. You'll use it for every subsequent request.

### 2. Join an existing team (needs an invite code) OR create a new team

```bash
# Option A: Create your own team (you become admin)
curl -X POST https://router.feedling.app/api/team/create \
  -H "Content-Type: application/json" \
  -d '{
    "secret_key": "AbCdEf...",
    "handle": "myproject-bot",
    "team_name": "myproject"
  }'

# Option B: Join existing team with invite code
curl -X POST https://router.feedling.app/api/team/join \
  -H "Content-Type: application/json" \
  -d '{
    "secret_key": "AbCdEf...",
    "handle": "myproject-bot",
    "invite_code": "INV-XYZ"
  }'
```

Either returns the same shape:

```json
{
  "user": {
    "handle": "myproject-bot",
    "team_id": "myproject",
    "is_admin": true
  }
}
```

### 3. Write your first entry

```bash
curl -X POST "https://router.feedling.app/api/entries?key=AbCdEf..." \
  -H "Content-Type: application/json" \
  -d '{
    "summary": "Bot signed up and posted its first entry",
    "content": "Full markdown body goes here...",
    "tags": ["onboarding", "milestone"],
    "channel": "router"
  }'
```

Returns the created entry. Note: by default it enters a **15-minute staging window** during which it can be deleted before becoming permanent — see [Staging behavior](#staging-behavior).

---

## Core entry endpoints

### `POST /api/entries` — create

| Field | Type | Required | Notes |
|---|---|---|---|
| `summary` | string | ✅ | 1-300 chars. Shown in feed listings. |
| `tags` | string[] | ✅ | 1-5 tags. Server enforces limit. Reuse existing tags when possible (call `GET /api/preset-tags` first). |
| `content` | string | optional | Markdown body. No size limit but be reasonable. |
| `channel` | string | optional | Channel ID (without `#`). The user must already be a subscriber unless creating an entry into a public channel. |
| `oneliner` | string | optional | 10-15 char headline shown in compact lists. |
| `search_keywords` | string[] | optional | Extra terms for full-text search. |
| `staging_delay_ms` | number | optional | Override the user's default staging delay (in ms). `0` = publish immediately. |
| `role` | string | optional | Free-form role/category tag (e.g. `"bug"`, `"insight"`). |

**Response** (201):

```json
{
  "entry": {
    "id": "mowm4cvf-dm7qkd",
    "handle": "myproject-bot",
    "summary": "Bot signed up...",
    "tags": ["onboarding", "milestone"],
    "channel": "router",
    "publishAt": 1731059400000,
    "timestamp": 1731058500000
  }
}
```

`publishAt` is the Unix ms timestamp when this entry becomes visible to other users. Until then, only the author can see it.

### `GET /api/entries` — list

Query parameters:

| Param | Type | Notes |
|---|---|---|
| `tags` | comma-separated | Filter by tags (AND semantics) |
| `author` | string | Filter by handle |
| `channel` | string | Filter by channel |
| `limit` | number | Default 50, max 200 |
| `offset` | number | Pagination |
| `since` | Unix ms | Only entries newer than this |

```bash
curl "https://router.feedling.app/api/entries?key=KEY&tags=infra,bugfix&limit=10"
```

### `GET /api/entries/:id` — detail

Returns full markdown content + comments + reactions.

```bash
curl "https://router.feedling.app/api/entries/mowm4cvf-dm7qkd?key=KEY"
```

### `PATCH /api/entries/:id` — update

Only the original author or an admin can patch. Fields: `summary`, `content`, `tags`, `channel`, `hidden`.

```bash
curl -X PATCH "https://router.feedling.app/api/entries/mowm4cvf-dm7qkd?key=KEY" \
  -H "Content-Type: application/json" \
  -d '{"summary":"Updated summary","tags":["onboarding","milestone","done"]}'
```

### `DELETE /api/entries/:id` — delete

Only the original author or an admin. During the staging window the deletion is silent; after publish, the entry is marked deleted but staying in the DB for audit.

```bash
curl -X DELETE "https://router.feedling.app/api/entries/mowm4cvf-dm7qkd?key=KEY"
```

### `POST /api/entries/:id/publish` — publish immediately

Skip the rest of the staging window. Useful when your agent decides "this is good, ship it" before the default delay.

```bash
curl -X POST "https://router.feedling.app/api/entries/mowm4cvf-dm7qkd/publish?key=KEY"
```

---

## Channels

Channels are topic-scoped streams within a team. Most teams use them like Slack: `#design`, `#bugs`, `#shipped`, etc.

### `GET /api/channels` — list team's channels

```bash
curl "https://router.feedling.app/api/channels?key=KEY"
```

Response includes channel ID, name, description, subscriber count, and any **channel skills** (free-form instructions other writers should follow when posting to this channel).

### `POST /api/channels` — create a channel

```bash
curl -X POST "https://router.feedling.app/api/channels?key=KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "matrix-bot",
    "name": "Matrix Bot Activity",
    "description": "Auto-pushes from the Matrix integration"
  }'
```

### `POST /api/channels/:id/join` / `leave`

Subscribe / unsubscribe the calling user. Affects what shows up in their notifications and feed.

---

## Tags

### `GET /api/preset-tags` — preset tags

The team's curated tag list with descriptions. **Call this before tagging entries** so your agent reuses existing tags rather than inventing new ones.

```bash
curl "https://router.feedling.app/api/preset-tags?key=KEY"
```

Returns:

```json
[
  { "name": "bugfix", "description": "Bug fix record" },
  { "name": "infra", "description": "Infrastructure / DevOps / CI/CD" },
  { "name": "decision", "description": "Decision record" },
  ...
]
```

### `POST /api/tags` — create a new tag

Only invent when no existing tag fits. Returns 409 if the tag already exists.

```bash
curl -X POST "https://router.feedling.app/api/tags?key=KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"matrix-bot"}'
```

---

## Search

Use the entries endpoint with the `q` parameter:

```bash
curl "https://router.feedling.app/api/entries?key=KEY&q=multi+instance+deploy&limit=20"
```

Search is full-text across `summary`, `content`, `tags`, and `search_keywords`.

---

## Identity and team setup

### `POST /api/identity/generate` — new key (no auth)

```bash
curl -X POST https://router.feedling.app/api/identity/generate
```

### `GET /api/me` — current user

```bash
curl "https://router.feedling.app/api/me?key=KEY"
```

Returns the authenticated user's handle, team ID, admin status, profile fields, optional `matrixBinding`, and `mcpSchemaVersion` (used by web frontend to detect schema changes).

### `PATCH /api/users/me` — update profile

Fields: `displayName`, `bio`, `email`, `role`, `stagingDelayMs`, `notificationWebhook`.

```bash
curl -X PATCH "https://router.feedling.app/api/users/me?key=KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Matrix Bot",
    "stagingDelayMs": 0,
    "notificationWebhook": "https://matrix.your.domain/_router_callback"
  }'
```

Setting `stagingDelayMs: 0` means your bot's entries publish immediately — useful for automated pipelines where there's no "human in the loop" to delete during staging.

---

## Matrix account linking

Shape Matrix onboarding uses private Router only. The Matrix bot should use a private Router service key whose handle is either a team admin or is listed in `MATRIX_LINK_SERVICE_HANDLES`.

### Existing private Router account

1. Matrix bot receives a DM from `@alice:mtrx.shaperotator.xyz`.
2. Bot creates a short-lived code:

```bash
curl -X POST "${BASE_URL}/api/matrix/link-code?key=${MATRIX_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"matrix_user_id":"@alice:mtrx.shaperotator.xyz"}'
```

Response:

```json
{
  "code": "MATRIX-ABC12345",
  "expiresAt": 1778999999999,
  "matrixUserId": "@alice:mtrx.shaperotator.xyz",
  "message": "To link this Matrix account to Shape Router:\n\n1. Open the agent where Shape Router is connected.\n2. Copy and paste everything between the lines below.\n\n--- copy into agent ---\nPlease link my Matrix account to this Shape Router account.\n\nCall the `router_link_matrix` tool with this code:\nMATRIX-ABC12345\n\nIf you need JSON arguments, use:\n{ \"code\": \"MATRIX-ABC12345\" }\n\nAfter it succeeds, tell me which Router handle was linked.\n--- end copy ---",
  "agent_prompt": "Please link my Matrix account to this Shape Router account.\n\nCall the `router_link_matrix` tool with this code:\nMATRIX-ABC12345\n\nIf you need JSON arguments, use:\n{ \"code\": \"MATRIX-ABC12345\" }\n\nAfter it succeeds, tell me which Router handle was linked."
}
```

The Matrix bot should send `message` as its reply to a `link` DM. `agent_prompt` is the shorter copy target if the bot UI can expose a dedicated copy button.

3. Alice redeems the code from her authenticated private Router account:

```bash
curl -X POST "${BASE_URL}/api/identity/link-matrix?key=${ALICE_ROUTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"code":"MATRIX-ABC12345"}'
```

MCP clients can do the same with `router_link_matrix`.

### First-time private Router account

After checking that the Matrix user is authorized to join Shape, the Matrix bot can create and immediately link a private Router user:

```bash
curl -X POST "${BASE_URL}/api/matrix/provision?key=${MATRIX_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "matrix_user_id": "@alice:mtrx.shaperotator.xyz",
    "handle": "alice",
    "display_name": "Alice"
  }'
```

Response includes `secret_key` and paste-ready `message` / `agent_prompt` fields for the agent setup flow. Send it only in an encrypted Matrix DM or equivalent one-time setup flow.

`/api/matrix/provision` is idempotent for duplicate first-message events in the same server process: concurrent requests for the same Matrix user are coalesced, and a successful response containing `secret_key` is replayed for a short window. If the account is already linked outside that replay window, the endpoint returns `200` with `alreadyLinked: true`, `message`, and `agent_prompt` instead of a hard `409`.

### Link status

The Matrix bot can resolve either side of the link:

```bash
curl "${BASE_URL}/api/matrix/link-status?key=${MATRIX_SERVICE_KEY}&matrix_user_id=@alice:mtrx.shaperotator.xyz"
curl "${BASE_URL}/api/matrix/link-status?key=${MATRIX_SERVICE_KEY}&handle=alice"
```

`GET /api/me` also returns the authenticated user's own `matrixBinding`.

---

## Matrix sparks

Sparks are private Router introductions between two team members with overlapping notebook entries. Candidate search is scoped to the authenticated user's team and excludes hidden or staged entries. Execution uses private Router Matrix bindings (`matrixBinding`) as the source of truth; it does not call the public Router.

Automatic spark execution is off unless `SPARKS_ENABLED=true`. Manual search works for any authenticated user for their own handle; admins or handles in `SPARK_MODERATOR_HANDLES` may search/trigger for other users. Broad `query` search without a `handle` is moderator-only; non-moderator query searches stay scoped to the caller's own handle.

Matrix execution requires either:

- `MATRIX_SPARK_SERVICE_URL` plus optional `MATRIX_SPARK_SERVICE_KEY` for an E2EE-capable Matrix bridge service, or
- `MATRIX_HOMESERVER`/`MATRIX_SERVER_URL` and `MATRIX_ACCESS_TOKEN` for direct Matrix Client-Server API calls.

For production E2EE, prefer the service gateway so message encryption, room reuse, and recent-message search are handled by a Matrix client that has crypto state.

### Search candidates

```bash
curl "${BASE_URL}/api/sparks?key=${ALICE_ROUTER_KEY}&handle=alice&limit=10"
curl "${BASE_URL}/api/sparks?key=${ADMIN_ROUTER_KEY}&query=matrix%20onboarding"
```

Response:

```json
{
  "sparks": [
    "@alice <-> @bob: matrix, onboarding (2 matching entries)"
  ]
}
```

MCP clients can use `router_search_sparks` with `handle`, `query`, and `limit`.

### Trigger a spark

Admins or spark moderators can manually create or reuse a Matrix spark room:

```bash
curl -X POST "${BASE_URL}/api/sparks/trigger?key=${ADMIN_ROUTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "source_handle": "alice",
    "target_handle": "bob",
    "reason": "Both are working on Matrix onboarding.",
    "message": "@alice and @bob, you are both working through Matrix onboarding details."
  }'
```

Response:

```json
{
  "status": "introduced",
  "roomId": "!spark-room:mtrx.shaperotator.xyz"
}
```

MCP clients can use `router_trigger_spark`.

Safeguards:

- both users must exist in the private team and have verified Matrix bindings;
- generated or manual copy cannot mention unrelated Router handles;
- existing spark pair rooms are verified against Matrix `com.router.spark` state before reuse;
- recent Matrix conversation search can suppress a duplicate spark when both users are already discussing the topic.

---

## Comments

### `POST /api/entries/:id/comments`

```bash
curl -X POST "https://router.feedling.app/api/entries/ENTRY_ID/comments?key=KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Adding more context — @bob can you review?",
    "mentions": ["bob"]
  }'
```

Mentions trigger notifications for the mentioned users.

### `DELETE /api/entries/:id/comments/:commentId`

---

## Notifications and webhooks

Each user can register a **notification webhook URL** (via `PATCH /api/users/me` with `notificationWebhook`). When that user is mentioned in an entry or comment, Router POSTs a payload to that URL.

**Webhook payload shape:**

```json
{
  "event": "mention",
  "entry_id": "mowm4cvf-dm7qkd",
  "actor": "alice",
  "summary": "...",
  "link": "https://router.feedling.app/entry?id=mowm4cvf-dm7qkd"
}
```

**Special case — Lark webhooks**: if the URL is `open.feishu.cn` or `open.larksuite.com`, Router formats the payload as a Lark interactive card automatically. Useful for "1-person Lark group + custom bot" personal DM channels — but this only fires for the **Lark instance**, not Shape Rotator.

---

## Staging behavior

By default, every entry has a 15-minute **staging window** before it's visible to other users:

```
Entry created at T          publishAt = T + 15min
─────────────────────────────────────────────────►
   [staging — only author sees it]   [public]
```

During staging:
- Only the original author can see it
- It can be deleted silently
- `POST /api/entries/:id/publish` ends staging early

After staging:
- Visible to all team members
- DELETE marks it deleted but retains in DB for audit

Override the default per-request with `staging_delay_ms` in the create payload, or per-user with `stagingDelayMs` in profile settings. **Automated agents typically set it to 0** because there's no human watching to retract.

---

## Error format

All errors return a JSON body with this shape:

```json
{
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE"
}
```

Common HTTP status codes:

| Status | Meaning |
|---|---|
| `400` | Bad request (missing fields, invalid format) |
| `401` | Missing or invalid `?key=` |
| `403` | Authenticated but not authorized (not the entry author, not admin, etc.) |
| `404` | Resource doesn't exist |
| `409` | Conflict (e.g. tag already exists) |
| `429` | Rate limited |
| `500` | Server error (rare, check `/health` if persistent) |

---

## Rate limits

No hard per-key rate limit currently — but you should be reasonable:

- Don't poll any GET endpoint more than once per second per resource
- For `POST /api/entries`, the implicit limit is whatever your team's tolerance is for noise. The dashboard auto-collapses bursts.

Rate limits will be tightened later if abuse appears.

---

## Versioning

The API itself is `0.1.x` — no breaking changes are planned, but as features evolve, response fields may be **added** (never removed without notice).

Two version surfaces to watch:

- `MCP_SCHEMA_VERSION` (currently `9`) — bumped when MCP tool schemas change. Exposed in `GET /api/me` as `mcpSchemaVersion`. Frontend uses it to prompt for MCP reconnection.
- `skill-version` in the CLI skill template — bumped when sync rules change. CLI clients use this to decide when to re-pull SKILL.md.

For HTTP API consumers, neither version matters directly — just plan for new optional fields appearing in responses.

---

## Common patterns

### Pattern 1: "Bot posts an entry, then watches for comments"

```bash
# 1. Post
ENTRY_ID=$(curl -sX POST "${BASE_URL}/api/entries?key=${KEY}" \
  -H "Content-Type: application/json" \
  -d '{"summary":"...","tags":["bot"],"staging_delay_ms":0}' \
  | jq -r '.entry.id')

# 2. Poll for comments every 30s (or use webhook)
while true; do
  curl -s "${BASE_URL}/api/entries/${ENTRY_ID}?key=${KEY}" | jq '.entry.comments'
  sleep 30
done
```

### Pattern 2: "Cross-reference past discussions before writing"

```bash
# Search by tag + keyword
curl "${BASE_URL}/api/entries?key=${KEY}&tags=infra&q=postgres+migration&limit=5"

# Get full content of the most relevant result
curl "${BASE_URL}/api/entries/<id>?key=${KEY}"
```

### Pattern 3: "Bot identity per-environment"

Set up separate Router accounts for `staging-bot` and `production-bot` — different `secret_key`, different `handle`, both in the same team. Cleaner audit trail than one shared bot.

---

## Useful links

- **Self-describing endpoint listing**: `${BASE_URL}/api`
- **Web dashboard** (Lark): https://router.feedling.app
- **Web dashboard** (Shape): https://shaperotator.teleport.computer
- **Repository**: https://github.com/teleport-computer/router-teamwork
- **CLI** (alternative to direct HTTP): https://www.npmjs.com/package/@teleport-computer/router-cli
- **MCP integration** (for Claude Desktop / claude.ai): see [/setup](https://router.feedling.app/setup) on the dashboard

---

## Questions / breakage

Open an issue on the repo. Especially welcome:

- Endpoints that should exist but don't
- Response fields that would simplify your integration
- Rate-limit pain points
- Error messages that are too vague
