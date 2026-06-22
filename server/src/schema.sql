-- Teamwork — PostgreSQL Schema
-- Run once on a fresh database, or use as reference for migrations.

-- ── Entries ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entries (
  id            TEXT        PRIMARY KEY,
  handle        TEXT        NOT NULL,
  team_id       TEXT        NOT NULL,
  client        TEXT        NOT NULL,
  content       TEXT        NOT NULL,
  summary       TEXT        NOT NULL DEFAULT '',
  tags          JSONB       NOT NULL DEFAULT '[]',
  role          TEXT,
  timestamp     BIGINT      NOT NULL,
  keywords      JSONB       NOT NULL DEFAULT '[]',
  model         TEXT,
  to_handles    JSONB       NOT NULL DEFAULT '[]',
  in_reply_to   TEXT,
  channel       TEXT,
  publish_at    BIGINT,
  comments      JSONB       NOT NULL DEFAULT '[]',
  hidden        BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Migrations (idempotent — safe to re-run on every deploy)
ALTER TABLE entries ADD COLUMN IF NOT EXISTS oneliner TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_webhook TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lang TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS translations JSONB;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS webhook_fired BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS matrix_mirror_room_id TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS matrix_mirror_event_id TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS matrix_mirrored_at BIGINT;
-- Source tracking (record-only; UI to be designed once we see real data).
ALTER TABLE entries ADD COLUMN IF NOT EXISTS source_app TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS source_via TEXT;

-- ── Handle-reuse leak fix: one-shot anonymization of legacy orphans ──
-- Background: prior to 2026-05-14, deleteUser only removed the users row
-- and left entries / notifications with the original handle intact, so a
-- new user registering the freed handle inherited all the deleted user's
-- data. The runtime delete path now anonymizes (see PostgresStorage.deleteUser),
-- but historical orphans need a one-shot rewrite.
--
-- Idempotent: rewritten rows have handles starting with `_deleted_` and so
-- no longer match the WHERE clause on subsequent runs. JSONB orphans
-- (entries.to_handles, entries.comments, users.following) are not migrated
-- here — covered by the runtime path going forward; the historical residual
-- is lower-impact than scalar columns.
UPDATE entries
SET handle = '_deleted_' || substr(md5(handle), 1, 6)
WHERE handle NOT IN (SELECT handle FROM users)
  AND handle NOT LIKE '_deleted_%'
  AND handle NOT IN ('router-bot');

UPDATE notifications
SET recipient_handle = '_deleted_' || substr(md5(recipient_handle), 1, 6)
WHERE recipient_handle NOT IN (SELECT handle FROM users)
  AND recipient_handle NOT LIKE '_deleted_%'
  AND recipient_handle NOT IN ('router-bot');

UPDATE notifications
SET from_handle = '_deleted_' || substr(md5(from_handle), 1, 6)
WHERE from_handle NOT IN (SELECT handle FROM users)
  AND from_handle NOT LIKE '_deleted_%'
  AND from_handle NOT IN ('router-bot');

CREATE INDEX IF NOT EXISTS idx_entries_team_ts   ON entries (team_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_entries_handle    ON entries (team_id, handle);
CREATE INDEX IF NOT EXISTS idx_entries_channel   ON entries (team_id, channel);
CREATE INDEX IF NOT EXISTS idx_entries_reply     ON entries (in_reply_to);
CREATE INDEX IF NOT EXISTS idx_entries_tags      ON entries USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_entries_keywords  ON entries USING GIN (keywords);

-- ── Users ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  handle            TEXT    PRIMARY KEY,
  secret_key_hash   TEXT    NOT NULL UNIQUE,
  team_id           TEXT    NOT NULL,
  display_name      TEXT,
  bio               TEXT,
  email             TEXT,
  role              TEXT,
  is_admin          BOOLEAN NOT NULL DEFAULT FALSE,
  staging_delay_ms  INTEGER,
  created_at        BIGINT  NOT NULL,
  skills            JSONB   NOT NULL DEFAULT '[]',
  following         JSONB   NOT NULL DEFAULT '[]',
  bookmarks         JSONB   NOT NULL DEFAULT '[]',
  tag_presets       JSONB   NOT NULL DEFAULT '[]',
  notification_webhook TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_team       ON users (team_id);
CREATE INDEX IF NOT EXISTS idx_users_key_hash   ON users (secret_key_hash);

-- Additive migration for existing deployments
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_webhook TEXT;

-- ── Teams ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  created_by  TEXT    NOT NULL,
  created_at  BIGINT  NOT NULL
);

-- ── Team Memory ─────────────────────────────────────────────────
-- One markdown blob per team, edited by admins. Auto-loaded into CC's
-- system context at startup so CC has team-wide ground truth (people,
-- tech stack, conventions). previous_content gives a one-step undo so
-- a bad edit can be rolled back without git-level surgery.
CREATE TABLE IF NOT EXISTS team_memory (
  team_id           TEXT    PRIMARY KEY,
  content           TEXT    NOT NULL,
  previous_content  TEXT,
  updated_at        BIGINT  NOT NULL,
  updated_by_handle TEXT
);

-- ── Team invites ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_invites (
  code        TEXT    PRIMARY KEY,
  team_id     TEXT    NOT NULL,
  created_by  TEXT    NOT NULL,
  created_at  BIGINT  NOT NULL,
  expires_at  BIGINT,
  max_uses    INTEGER,
  uses        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites (team_id);

-- ── Channels ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels (
  id          TEXT    PRIMARY KEY,
  team_id     TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  join_rule   TEXT    NOT NULL DEFAULT 'open',
  created_by  TEXT    NOT NULL,
  created_at  BIGINT  NOT NULL,
  skills      JSONB   NOT NULL DEFAULT '[]',
  subscribers JSONB   NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_channels_team ON channels (team_id);

-- ── Channel invites ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_invites (
  token       TEXT    PRIMARY KEY,
  channel_id  TEXT    NOT NULL,
  created_by  TEXT    NOT NULL,
  created_at  BIGINT  NOT NULL,
  expires_at  BIGINT,
  max_uses    INTEGER,
  uses        INTEGER NOT NULL DEFAULT 0
);

-- ── Notifications ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id                TEXT      PRIMARY KEY,
  recipient_handle  TEXT      NOT NULL,
  team_id           TEXT      NOT NULL,
  type              TEXT      NOT NULL,
  from_handle       TEXT      NOT NULL,
  entry_id          TEXT,  -- optional: admin-status notifications aren't entry-bound
  comment_id        TEXT,
  preview           TEXT      NOT NULL,
  read              BOOLEAN   NOT NULL DEFAULT FALSE,
  timestamp         BIGINT    NOT NULL
);

-- Migration for databases created before entry_id became optional.
-- Idempotent: DROP NOT NULL is a no-op if the column is already nullable.
ALTER TABLE notifications ALTER COLUMN entry_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications (recipient_handle, timestamp DESC);

-- ── Preset Tags ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS preset_tags (
  name        TEXT    PRIMARY KEY,
  description TEXT    NOT NULL,
  created_at  BIGINT  NOT NULL
);

-- ── M2a: Lark Phase 0 — account binding ─────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS lark_open_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lark_union_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lark_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lark_avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lark_refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lark_refresh_token_expires_at BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lark_scopes JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lark_bound_at BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lark_notification_prefs JSONB;

-- Matrix account binding for Shape Rotator onboarding.
ALTER TABLE users ADD COLUMN IF NOT EXISTS matrix_user_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS matrix_bound_at BIGINT;

-- Concierge (proactive recap) per-user state. lastConciergeSeenAt is
-- updated on every recap fetch so subsequent calls only surface NEW
-- activity; conciergeRecapEnabled opts the user out when false.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_concierge_seen_at BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS concierge_recap_enabled BOOLEAN;

-- secret_key 7-day grace period after rotation
ALTER TABLE users ADD COLUMN IF NOT EXISTS previous_secret_key_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS previous_secret_key_expires_at BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS users_lark_open_id_idx
  ON users (lark_open_id)
  WHERE lark_open_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_matrix_user_id_idx
  ON users (matrix_user_id)
  WHERE matrix_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_previous_secret_key_hash_idx
  ON users (previous_secret_key_hash)
  WHERE previous_secret_key_hash IS NOT NULL;

-- Matrix spark introduction rooms. Private Router is the source of truth for
-- which Router handle pair owns a Matrix room; Matrix room state mirrors this
-- so stale rooms can be rejected before reuse.
CREATE TABLE IF NOT EXISTS spark_pair_rooms (
  team_id       TEXT   NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  pair_key      TEXT   NOT NULL,
  source_handle TEXT   NOT NULL REFERENCES users(handle) ON DELETE CASCADE,
  target_handle TEXT   NOT NULL REFERENCES users(handle) ON DELETE CASCADE,
  room_id       TEXT   NOT NULL,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  PRIMARY KEY (team_id, pair_key)
);

CREATE INDEX IF NOT EXISTS spark_pair_rooms_room_idx
  ON spark_pair_rooms (room_id);

-- ── M2a.5: Web sessions ─────────────────────────────────────
-- Cookie-based auth for browsers. Decouples web auth from secret_key
-- so multi-device Feishu login does NOT rotate the user's MCP key.
-- Sliding expiry: expires_at gets refreshed on every authenticated
-- request (touchSession). Lazy cleanup on auth (no cron).
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT     PRIMARY KEY,
  handle      TEXT     NOT NULL REFERENCES users(handle) ON DELETE CASCADE,
  created_at  BIGINT   NOT NULL,
  expires_at  BIGINT   NOT NULL,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS sessions_handle_idx ON sessions (handle);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

-- ── M2b: Lark Phase 1 — chat ↔ channel binding + card action audit ──
CREATE TABLE IF NOT EXISTS lark_chat_bindings (
  chat_id            TEXT     PRIMARY KEY,
  -- channel_id is the bound tag slug; no FK because tags live in tag_configs
  -- (keyed by (team_id, tag)) and the legacy `channels` table is being phased
  -- out. resolveTeamTag() in tag-resolve.ts is responsible for validating the
  -- tag exists in the user's team before insert.
  channel_id         TEXT     NOT NULL,
  team_id            TEXT     NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
  bound_by           TEXT              REFERENCES users(handle) ON DELETE SET NULL,
  bound_at           BIGINT   NOT NULL,
  chat_name          TEXT     NOT NULL,
  last_summary_ts    BIGINT,
  last_summary_at    BIGINT
);

CREATE INDEX IF NOT EXISTS lark_chat_bindings_channel_id_idx ON lark_chat_bindings (channel_id);
CREATE INDEX IF NOT EXISTS lark_chat_bindings_team_id_idx    ON lark_chat_bindings (team_id);

CREATE TABLE IF NOT EXISTS lark_card_actions (
  id              SERIAL   PRIMARY KEY,
  entry_id        TEXT     NOT NULL,
  chat_id         TEXT     NOT NULL,
  open_id         TEXT     NOT NULL,
  action          TEXT     NOT NULL,
  payload         JSONB,
  acted_at        BIGINT   NOT NULL
);

CREATE INDEX IF NOT EXISTS lark_card_actions_entry_id_idx ON lark_card_actions (entry_id);
CREATE INDEX IF NOT EXISTS lark_card_actions_open_id_idx  ON lark_card_actions (open_id);

-- ── M2b.5: Lark binding archive channel ──
ALTER TABLE lark_chat_bindings ADD COLUMN IF NOT EXISTS archive_channel_id TEXT;

-- ── M3a: per-binding push toggle (router→Lark direction) ──
-- Default OFF — the router→Lark push is opt-in per group via `@bot /push on`
-- or the web binding panel.
ALTER TABLE lark_chat_bindings ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ── M3a: watch (on-message LLM eval, suggests action when worth surfacing) ──
ALTER TABLE lark_chat_bindings ADD COLUMN IF NOT EXISTS watch_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lark_chat_bindings ADD COLUMN IF NOT EXISTS watch_msg_count INT NOT NULL DEFAULT 0;
ALTER TABLE lark_chat_bindings ADD COLUMN IF NOT EXISTS watch_last_ran_at BIGINT;
ALTER TABLE lark_chat_bindings ADD COLUMN IF NOT EXISTS watch_last_posted_at BIGINT;

CREATE TABLE IF NOT EXISTS lark_watch_observations (
  id              SERIAL   PRIMARY KEY,
  chat_id         TEXT     NOT NULL,
  ran_at          BIGINT   NOT NULL,
  observations    JSONB    NOT NULL
);
CREATE INDEX IF NOT EXISTS lark_watch_observations_chat_idx ON lark_watch_observations (chat_id, ran_at DESC);

-- ── M3a: per-binding summary style ('person' default; 'topic' = topic-leading) ──
-- Legacy: this column was the original home for summary_style. New code reads
-- from `lark_chat_prefs` instead so style works even on unbound chats.
ALTER TABLE lark_chat_bindings ADD COLUMN IF NOT EXISTS summary_style TEXT NOT NULL DEFAULT 'person';

-- ── Drop the legacy FK from lark_chat_bindings.channel_id to channels(id) ──
-- The bot now binds to any tag in `tag_configs` (including ad-hoc tags
-- discovered in entries — see resolveTeamTag in lark/tag-resolve.ts). The FK
-- against the legacy `channels` table blocked binds to those tags. tag
-- validity is enforced in application code instead.
ALTER TABLE lark_chat_bindings DROP CONSTRAINT IF EXISTS lark_chat_bindings_channel_id_fkey;

-- ── M3a: per-chat preferences (independent of binding — works in unbound chats too) ──
CREATE TABLE IF NOT EXISTS lark_chat_prefs (
  chat_id        TEXT     PRIMARY KEY,
  summary_style  TEXT     NOT NULL DEFAULT 'person',
  updated_at     BIGINT   NOT NULL
);

-- ── M3a: native Lark reactions on bot-sent messages (entry/summary cards) ──
-- Raw stream of reaction add/remove events. Linking a message_id back to the
-- entry it referenced is a future enhancement (requires storing message_id at
-- card-post time).
CREATE TABLE IF NOT EXISTS lark_message_reactions (
  id             SERIAL   PRIMARY KEY,
  chat_id        TEXT     NOT NULL,
  message_id     TEXT     NOT NULL,
  open_id        TEXT     NOT NULL,
  emoji_type     TEXT     NOT NULL,
  action         TEXT     NOT NULL CHECK (action IN ('added','removed')),
  reacted_at     BIGINT   NOT NULL
);
CREATE INDEX IF NOT EXISTS lark_msg_reactions_msg_idx
  ON lark_message_reactions (message_id, reacted_at DESC);
CREATE INDEX IF NOT EXISTS lark_msg_reactions_chat_idx
  ON lark_message_reactions (chat_id, reacted_at DESC);

-- ── M3a: Lark message ↔ router entry mapping ──
-- Recorded when bot pushes an entry card or PATCHes a saved-summary card.
-- Used to aggregate native Lark reactions back onto the entry's web page.
CREATE TABLE IF NOT EXISTS lark_entry_messages (
  message_id     TEXT     PRIMARY KEY,
  entry_id       TEXT     NOT NULL,
  chat_id        TEXT     NOT NULL,
  posted_at      BIGINT   NOT NULL
);
CREATE INDEX IF NOT EXISTS lark_entry_messages_entry_idx ON lark_entry_messages (entry_id);

-- ── M3b: periodic auto-summary preferences (clock-driven) ──
-- One row per chat. The cron loop scans WHERE enabled=TRUE and uses
-- isDue(prefs, now) in app code (timezone math). Independent of binding —
-- unbound chats still get summarized; the entry just won't carry a channel.
CREATE TABLE IF NOT EXISTS lark_auto_summary (
  chat_id           TEXT      PRIMARY KEY,
  enabled           BOOLEAN   NOT NULL DEFAULT FALSE,
  cadence_kind      TEXT      NOT NULL DEFAULT 'daily' CHECK (cadence_kind IN ('daily','weekly','hourly')),
  cadence_value     INTEGER,
  fire_hour         INTEGER   NOT NULL DEFAULT 9 CHECK (fire_hour BETWEEN 0 AND 23),
  setup_by_open_id  TEXT,
  last_run_at       BIGINT,
  updated_at        BIGINT    NOT NULL
);
CREATE INDEX IF NOT EXISTS lark_auto_summary_enabled_idx ON lark_auto_summary (enabled) WHERE enabled = TRUE;

-- ── M9 (CLI v1): user-level CLI preferences ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS sync_mode TEXT NOT NULL DEFAULT 'active'
  CHECK (sync_mode IN ('active', 'passive'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS preview_mode TEXT NOT NULL DEFAULT 'always'
  CHECK (preview_mode IN ('always', 'never'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_strip_custom JSONB;

-- ── Tag unification (B-plus): replaces channels with tag_configs ─────
-- See docs/superpowers/specs/2026-05-15-tag-unification-design.md.
--
-- tag_configs is keyed by (team_id, tag) — the same tag name (eg `decision`)
-- can legitimately exist in different teams with different configs. The old
-- channels table is left intact during the transition; new code writes only
-- to tag_configs.
--
-- An earlier branch staged this under the name `hash_configs`. The block
-- below renames-by-copying so DBs that already ran that branch get folded
-- into tag_configs idempotently.
CREATE TABLE IF NOT EXISTS tag_configs (
  team_id      TEXT    NOT NULL,
  tag          TEXT    NOT NULL,
  name         TEXT,
  description  TEXT,
  created_by   TEXT,
  created_at   BIGINT,
  subscribers  JSONB   NOT NULL DEFAULT '[]',
  skills       JSONB   NOT NULL DEFAULT '[]',
  PRIMARY KEY (team_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tag_configs_team ON tag_configs (team_id);

-- Roll forward from any pre-rename `hash_configs` table. Idempotent via
-- ON CONFLICT DO NOTHING. The hash_configs table is then left frozen
-- (Phase-2 cleanup will drop it along with `channels`).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'hash_configs'
  ) THEN
    INSERT INTO tag_configs (team_id, tag, name, description, created_by, created_at, subscribers, skills)
    SELECT team_id, hash, name, description, created_by, created_at, subscribers, skills
    FROM hash_configs
    ON CONFLICT (team_id, tag) DO NOTHING;
  END IF;
END $$;

-- One-shot migration: copy existing channels rows into tag_configs.
-- Idempotent via ON CONFLICT DO NOTHING — re-runs every deploy are no-ops.
INSERT INTO tag_configs (team_id, tag, name, description, created_by, created_at, subscribers, skills)
SELECT
  team_id,
  id,
  name,
  description,
  created_by,
  created_at,
  COALESCE(subscribers, '[]'::jsonb),
  COALESCE(skills, '[]'::jsonb)
FROM channels
ON CONFLICT (team_id, tag) DO NOTHING;

-- One-shot backfill: for each entry that has channel = X, ensure tags array
-- includes X. So filter-by-tag includes channel-only entries from before
-- the tag unification. Idempotent: the WHERE clause excludes rows already
-- containing the channel value in tags, so re-runs touch nothing.
UPDATE entries
SET tags = COALESCE(tags, '[]'::jsonb) || jsonb_build_array(channel)
WHERE channel IS NOT NULL
  AND channel <> ''
  AND NOT (COALESCE(tags, '[]'::jsonb) @> jsonb_build_array(channel));
