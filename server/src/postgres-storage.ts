/**
 * PostgreSQL storage backend for Teamwork.
 * Implements the same Storage interface as MemoryStorage / FileStorage.
 */

import pg from 'pg';
import {
  type Storage,
  type RouterEntry,
  type RouterUser,
  type Team,
  type TeamInvite,
  type TeamMemory,
  type Channel,
  type ChannelInvite,
  type ChannelSubscriber,
  type TagConfig,
  type Notification,
  type Comment,
  type PresetTag,
  type LarkBindingFields,
  type LarkChatBinding,
  type LarkCardAction,
  type LarkWatchObservation,
  type LarkAutoSummaryPrefs,
  type LarkMessageReaction,
  type Session,
  type Skill,
  type SparkPairRoom,
  DEFAULT_SESSION_TTL_MS,
  generateEntryId,
  tokenize,
  encodePageCursor,
  getSparkPairKey,
  tagConfigToChannel,
} from './storage.js';
import { generateSecretKey, hashSecretKey, generateSessionToken } from './identity.js';
import { generateDeletedHandle } from './deleted-user.js';

const { Pool } = pg;

// ─────────────────────────────────────────────────────────────
// Row → Model helpers
// ─────────────────────────────────────────────────────────────

function rowToEntry(r: any): RouterEntry {
  return {
    id: r.id,
    handle: r.handle,
    teamId: r.team_id,
    client: r.client,
    content: r.content,
    summary: r.summary,
    tags: r.tags ?? [],
    role: r.role ?? undefined,
    timestamp: Number(r.timestamp),
    keywords: r.keywords ?? [],
    model: r.model ?? undefined,
    to: r.to_handles ?? [],
    inReplyTo: r.in_reply_to ?? undefined,
    channel: r.channel ?? undefined,
    publishAt: r.publish_at ? Number(r.publish_at) : undefined,
    comments: r.comments ?? [],
    hidden: r.hidden ?? false,
    oneliner: r.oneliner ?? undefined,
    translations: r.translations ?? undefined,
    webhookFired: r.webhook_fired ?? false,
    matrixMirrorRoomId: r.matrix_mirror_room_id ?? undefined,
    matrixMirrorEventId: r.matrix_mirror_event_id ?? undefined,
    matrixMirroredAt: r.matrix_mirrored_at ? Number(r.matrix_mirrored_at) : undefined,
    sourceApp: r.source_app ?? undefined,
    sourceVia: r.source_via ?? undefined,
  };
}

function rowToUser(r: any): RouterUser {
  return {
    handle: r.handle,
    secretKeyHash: r.secret_key_hash,
    teamId: r.team_id,
    displayName: r.display_name ?? undefined,
    bio: r.bio ?? undefined,
    email: r.email ?? undefined,
    role: r.role ?? undefined,
    isAdmin: r.is_admin ?? false,
    stagingDelayMs: r.staging_delay_ms ?? undefined,
    createdAt: Number(r.created_at),
    skills: r.skills ?? [],
    following: r.following ?? [],
    bookmarks: r.bookmarks ?? [],
    tagPresets: r.tag_presets ?? [],
    notificationWebhook: r.notification_webhook ?? undefined,
    lang: r.lang ?? undefined,
    syncMode: r.sync_mode ?? undefined,
    previewMode: r.preview_mode ?? undefined,
    privacyStripCustom: r.privacy_strip_custom ?? undefined,
    larkOpenId: r.lark_open_id ?? undefined,
    larkUnionId: r.lark_union_id ?? undefined,
    larkName: r.lark_name ?? undefined,
    larkAvatarUrl: r.lark_avatar_url ?? undefined,
    larkRefreshToken: r.lark_refresh_token ?? undefined,
    larkRefreshTokenExpiresAt: r.lark_refresh_token_expires_at ? Number(r.lark_refresh_token_expires_at) : undefined,
    larkScopes: r.lark_scopes ?? undefined,
    larkBoundAt: r.lark_bound_at ? Number(r.lark_bound_at) : undefined,
    matrixUserId: r.matrix_user_id ?? undefined,
    matrixBoundAt: r.matrix_bound_at ? Number(r.matrix_bound_at) : undefined,
    larkNotificationPrefs: r.lark_notification_prefs ?? undefined,
    lastConciergeSeenAt: r.last_concierge_seen_at ? Number(r.last_concierge_seen_at) : undefined,
    conciergeRecapEnabled: r.concierge_recap_enabled ?? undefined,
    previousSecretKeyHash: r.previous_secret_key_hash ?? undefined,
    previousSecretKeyExpiresAt: r.previous_secret_key_expires_at ? Number(r.previous_secret_key_expires_at) : undefined,
  };
}

function rowToTeam(r: any): Team {
  return {
    id: r.id,
    name: r.name,
    createdBy: r.created_by,
    createdAt: Number(r.created_at),
  };
}

function rowToTeamInvite(r: any): TeamInvite {
  return {
    code: r.code,
    teamId: r.team_id,
    createdBy: r.created_by,
    createdAt: Number(r.created_at),
    expiresAt: r.expires_at ? Number(r.expires_at) : undefined,
    maxUses: r.max_uses ?? undefined,
    uses: r.uses,
  };
}

function rowToSparkPairRoom(r: any): SparkPairRoom {
  return {
    teamId: r.team_id,
    pairKey: r.pair_key,
    sourceHandle: r.source_handle,
    targetHandle: r.target_handle,
    roomId: r.room_id,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function rowToChannel(r: any): Channel {
  return {
    id: r.id,
    teamId: r.team_id,
    name: r.name,
    description: r.description ?? undefined,
    joinRule: r.join_rule,
    createdBy: r.created_by,
    createdAt: Number(r.created_at),
    skills: r.skills ?? [],
    subscribers: r.subscribers ?? [],
  };
}

function rowToTagConfig(r: any): TagConfig {
  return {
    teamId: r.team_id,
    tag: r.tag,
    name: r.name ?? undefined,
    description: r.description ?? undefined,
    createdBy: r.created_by ?? undefined,
    createdAt: r.created_at != null ? Number(r.created_at) : undefined,
    skills: (r.skills ?? []) as Skill[],
    subscribers: (r.subscribers ?? []) as ChannelSubscriber[],
  };
}

function rowToChannelInvite(r: any): ChannelInvite {
  return {
    token: r.token,
    channelId: r.channel_id,
    createdBy: r.created_by,
    createdAt: Number(r.created_at),
    expiresAt: r.expires_at ? Number(r.expires_at) : undefined,
    maxUses: r.max_uses ?? undefined,
    uses: r.uses,
  };
}

function rowToNotification(r: any): Notification {
  return {
    id: r.id,
    recipientHandle: r.recipient_handle,
    teamId: r.team_id,
    type: r.type,
    fromHandle: r.from_handle,
    entryId: r.entry_id,
    commentId: r.comment_id ?? undefined,
    preview: r.preview,
    read: r.read,
    timestamp: Number(r.timestamp),
  };
}

function rowToPresetTag(r: any): PresetTag {
  return {
    name: r.name,
    description: r.description,
    createdAt: Number(r.created_at),
  };
}

function rowToAutoSummary(r: any): LarkAutoSummaryPrefs {
  return {
    chatId: r.chat_id,
    enabled: !!r.enabled,
    cadenceKind: r.cadence_kind,
    cadenceValue: r.cadence_value === null ? null : Number(r.cadence_value),
    fireHour: Number(r.fire_hour),
    setupByOpenId: r.setup_by_open_id ?? null,
    lastRunAt: r.last_run_at === null ? null : Number(r.last_run_at),
    updatedAt: Number(r.updated_at),
  };
}

// ─────────────────────────────────────────────────────────────
// PostgresStorage
// ─────────────────────────────────────────────────────────────

export class PostgresStorage implements Storage {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async close() {
    await this.pool.end();
  }

  // ── Entry methods ──────────────────────────────────────────

  async addEntry(entry: Omit<RouterEntry, 'id'>, _stagingDelayMs?: number): Promise<RouterEntry> {
    const id = generateEntryId();
    const keywords = tokenize([entry.content, entry.summary, ...entry.tags].join(' '));
    const { rows } = await this.pool.query(
      `INSERT INTO entries
         (id, handle, team_id, client, content, summary, tags, role, timestamp,
          keywords, model, to_handles, in_reply_to, channel, publish_at, comments, hidden, oneliner,
          source_app, source_via)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [
        id, entry.handle, entry.teamId, entry.client,
        entry.content, entry.summary ?? '',
        JSON.stringify(entry.tags ?? []),
        entry.role ?? null,
        entry.timestamp,
        JSON.stringify(keywords),
        entry.model ?? null,
        JSON.stringify(entry.to ?? []),
        entry.inReplyTo ?? null,
        entry.channel ?? null,
        entry.publishAt ?? null,
        JSON.stringify(entry.comments ?? []),
        entry.hidden ?? false,
        entry.oneliner ?? null,
        entry.sourceApp ?? null,
        entry.sourceVia ?? null,
      ],
    );
    return rowToEntry(rows[0]);
  }

  async getEntry(id: string): Promise<RouterEntry | null> {
    const { rows } = await this.pool.query('SELECT * FROM entries WHERE id=$1', [id]);
    return rows[0] ? rowToEntry(rows[0]) : null;
  }

  async getEntries(teamId: string, limit = 50, offset = 0, cursor?: string): Promise<RouterEntry[]> {
    if (cursor) {
      let parsed: { t: number; id: string } | null = null;
      try {
        parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      } catch { /* ignore bad cursor */ }
      if (parsed) {
        const { rows } = await this.pool.query(
          `SELECT * FROM entries
           WHERE team_id=$1 AND (timestamp < $2 OR (timestamp=$2 AND id < $3))
           ORDER BY timestamp DESC, id DESC LIMIT $4`,
          [teamId, parsed.t, parsed.id, limit],
        );
        return rows.map(rowToEntry);
      }
    }
    const { rows } = await this.pool.query(
      'SELECT * FROM entries WHERE team_id=$1 ORDER BY timestamp DESC, id DESC LIMIT $2 OFFSET $3',
      [teamId, limit, offset],
    );
    return rows.map(rowToEntry);
  }

  async getEntriesByHandle(teamId: string, handle: string, limit = 50, since?: number): Promise<RouterEntry[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM entries WHERE team_id=$1 AND handle=$2
       ${since ? 'AND timestamp >= $4' : ''}
       ORDER BY timestamp DESC LIMIT $3`,
      since ? [teamId, handle, limit, since] : [teamId, handle, limit],
    );
    return rows.map(rowToEntry);
  }

  async searchEntries(teamId: string, query: string, limit = 50, since?: number): Promise<RouterEntry[]> {
    const queryKeywords = tokenize(query);
    if (queryKeywords.length === 0) return [];
    // keywords column is a JSONB array — use ?| (any of the keys exist as values)
    // Cast to text[] for the @> / ?| check
    const { rows } = await this.pool.query(
      `SELECT * FROM entries
       WHERE team_id=$1
         AND keywords ?| $2
         ${since ? 'AND timestamp >= $4' : ''}
       ORDER BY timestamp DESC LIMIT $3`,
      since ? [teamId, queryKeywords, limit, since] : [teamId, queryKeywords, limit],
    );
    return rows.map(rowToEntry);
  }

  async getEntriesByTags(teamId: string, tags: string[], limit?: number, offset = 0): Promise<RouterEntry[]> {
    // tags @> $2 means the entry tags array contains ALL requested tags
    const limitClause = limit != null ? ` LIMIT $3 OFFSET $4` : ` OFFSET $3`;
    const params = limit != null
      ? [teamId, JSON.stringify(tags), limit, offset]
      : [teamId, JSON.stringify(tags), offset];
    const { rows } = await this.pool.query(
      `SELECT * FROM entries WHERE team_id=$1 AND tags @> $2
       ORDER BY timestamp DESC${limitClause}`,
      params,
    );
    return rows.map(rowToEntry);
  }

  async getEntriesSince(teamId: string, since: number, limit = 50): Promise<RouterEntry[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM entries WHERE team_id=$1 AND timestamp>=$2 ORDER BY timestamp DESC LIMIT $3',
      [teamId, since, limit],
    );
    return rows.map(rowToEntry);
  }

  async getEntryCount(teamId?: string): Promise<number> {
    const { rows } = teamId
      ? await this.pool.query('SELECT COUNT(*) FROM entries WHERE team_id=$1', [teamId])
      : await this.pool.query('SELECT COUNT(*) FROM entries');
    return parseInt(rows[0].count, 10);
  }

  async deleteEntry(id: string): Promise<void> {
    await this.pool.query('DELETE FROM entries WHERE id=$1', [id]);
  }

  async updateEntryTags(id: string, tags: string[]): Promise<RouterEntry | null> {
    const keywords = tokenize(tags.join(' '));
    const { rows } = await this.pool.query(
      `UPDATE entries SET tags=$2, keywords=$3 WHERE id=$1 RETURNING *`,
      [id, JSON.stringify(tags), JSON.stringify(keywords)],
    );
    return rows[0] ? rowToEntry(rows[0]) : null;
  }

  async updateEntry(
    id: string,
    updates: Partial<Pick<RouterEntry, 'summary' | 'content' | 'tags' | 'role' | 'hidden' | 'channel' | 'to' | 'translations' | 'webhookFired' | 'publishAt' | 'matrixMirrorRoomId' | 'matrixMirrorEventId' | 'matrixMirroredAt'>>,
  ): Promise<RouterEntry | null> {
    // Build dynamic SET clause
    const setClauses: string[] = [];
    const values: any[] = [id];
    let idx = 2;

    if (updates.summary !== undefined) { setClauses.push(`summary=$${idx++}`); values.push(updates.summary); }
    if (updates.content !== undefined) { setClauses.push(`content=$${idx++}`); values.push(updates.content); }
    if (updates.tags !== undefined)    { setClauses.push(`tags=$${idx++}`);    values.push(JSON.stringify(updates.tags)); }
    if (updates.role !== undefined)    { setClauses.push(`role=$${idx++}`);    values.push(updates.role); }
    if (updates.hidden !== undefined)  { setClauses.push(`hidden=$${idx++}`);  values.push(updates.hidden); }
    if (updates.channel !== undefined) { setClauses.push(`channel=$${idx++}`); values.push(updates.channel || null); }
    if (updates.to !== undefined)      { setClauses.push(`to_handles=$${idx++}`); values.push(JSON.stringify(updates.to || [])); }
    if (updates.translations !== undefined) { setClauses.push(`translations=$${idx++}`); values.push(updates.translations ? JSON.stringify(updates.translations) : null); }
    if (updates.webhookFired !== undefined) { setClauses.push(`webhook_fired=$${idx++}`); values.push(updates.webhookFired); }
    if (updates.publishAt !== undefined) { setClauses.push(`publish_at=$${idx++}`); values.push(updates.publishAt ?? null); }
    if (updates.matrixMirrorRoomId !== undefined) { setClauses.push(`matrix_mirror_room_id=$${idx++}`); values.push(updates.matrixMirrorRoomId || null); }
    if (updates.matrixMirrorEventId !== undefined) { setClauses.push(`matrix_mirror_event_id=$${idx++}`); values.push(updates.matrixMirrorEventId || null); }
    if (updates.matrixMirroredAt !== undefined) { setClauses.push(`matrix_mirrored_at=$${idx++}`); values.push(updates.matrixMirroredAt ?? null); }

    if (setClauses.length === 0) return this.getEntry(id);

    // Recompute keywords when content/summary/tags change
    if (updates.content !== undefined || updates.summary !== undefined || updates.tags !== undefined) {
      const current = await this.getEntry(id);
      if (current) {
        const merged = {
          content: updates.content ?? current.content,
          summary: updates.summary ?? current.summary,
          tags: updates.tags ?? current.tags,
        };
        const kw = tokenize([merged.content, merged.summary, ...merged.tags].join(' '));
        setClauses.push(`keywords=$${idx++}`);
        values.push(JSON.stringify(kw));
      }
    }

    const { rows } = await this.pool.query(
      `UPDATE entries SET ${setClauses.join(', ')} WHERE id=$1 RETURNING *`,
      values,
    );
    return rows[0] ? rowToEntry(rows[0]) : null;
  }

  async getPendingEntries(): Promise<RouterEntry[]> {
    // Includes past-due rows — those are drafts the server died before
    // publishing. StagedStorage flips them promptly on the next tick.
    const { rows } = await this.pool.query(
      `SELECT * FROM entries WHERE publish_at IS NOT NULL`,
    );
    return rows.map(rowToEntry);
  }

  async getTagStats(teamId: string): Promise<Array<{ tag: string; count: number }>> {
    // Unnest the JSONB tags array and aggregate
    const { rows } = await this.pool.query(
      `SELECT tag, COUNT(*) AS count
       FROM entries, jsonb_array_elements_text(tags) AS tag
       WHERE team_id=$1
       GROUP BY tag ORDER BY count DESC`,
      [teamId],
    );
    return rows.map(r => ({ tag: r.tag, count: parseInt(r.count, 10) }));
  }

  async getEntriesAddressedTo(teamId: string, handle: string, limit = 50): Promise<RouterEntry[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM entries
       WHERE team_id=$1 AND (to_handles ? $2 OR to_handles ? $3)
       ORDER BY timestamp DESC LIMIT $4`,
      [teamId, handle, `@${handle}`, limit],
    );
    return rows.map(rowToEntry);
  }

  async getRepliesTo(entryId: string, limit = 50): Promise<RouterEntry[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM entries WHERE in_reply_to=$1 ORDER BY timestamp ASC LIMIT $2',
      [entryId, limit],
    );
    return rows.map(rowToEntry);
  }

  async addComment(entryId: string, comment: Comment): Promise<RouterEntry | null> {
    const { rows } = await this.pool.query(
      `UPDATE entries
       SET comments = comments || $2::jsonb
       WHERE id=$1 RETURNING *`,
      [entryId, JSON.stringify([comment])],
    );
    return rows[0] ? rowToEntry(rows[0]) : null;
  }

  async deleteComment(entryId: string, commentId: string): Promise<RouterEntry | null> {
    // Filter the comments JSONB array server-side
    const { rows } = await this.pool.query(
      `UPDATE entries
       SET comments = (
         SELECT COALESCE(jsonb_agg(c), '[]'::jsonb)
         FROM jsonb_array_elements(comments) AS c
         WHERE c->>'id' != $2
       )
       WHERE id=$1 RETURNING *`,
      [entryId, commentId],
    );
    return rows[0] ? rowToEntry(rows[0]) : null;
  }

  async updateComment(entryId: string, commentId: string, updates: Partial<Pick<Comment, 'translations'>>): Promise<Comment | null> {
    if (updates.translations === undefined) {
      const { rows } = await this.pool.query(`SELECT comments FROM entries WHERE id=$1`, [entryId]);
      const comments = rows[0]?.comments as Comment[] | undefined;
      return comments?.find(c => c.id === commentId) ?? null;
    }
    const { rows } = await this.pool.query(
      `UPDATE entries
       SET comments = (
         SELECT COALESCE(jsonb_agg(
           CASE WHEN c->>'id' = $2
             THEN c || jsonb_build_object('translations', $3::jsonb)
             ELSE c
           END
         ), '[]'::jsonb)
         FROM jsonb_array_elements(comments) AS c
       )
       WHERE id=$1 RETURNING comments`,
      [entryId, commentId, JSON.stringify(updates.translations)],
    );
    const comments = rows[0]?.comments as Comment[] | undefined;
    return comments?.find(c => c.id === commentId) ?? null;
  }

  async getChannelEntries(teamId: string, channelId: string, limit = 50): Promise<RouterEntry[]> {
    // Legacy alias for getEntriesByTag. Channel-as-tag equivalence is part
    // of the tag unification: any entry tagged #channelId or with the legacy
    // entries.channel = channelId is included.
    return this.getEntriesByTag(teamId, channelId, limit);
  }

  // ── Notification methods ───────────────────────────────────

  async addNotification(notification: Notification): Promise<Notification> {
    const { rows } = await this.pool.query(
      `INSERT INTO notifications
         (id, recipient_handle, team_id, type, from_handle, entry_id, comment_id, preview, read, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        notification.id, notification.recipientHandle, notification.teamId,
        notification.type, notification.fromHandle, notification.entryId ?? null,
        notification.commentId ?? null, notification.preview,
        notification.read, notification.timestamp,
      ],
    );
    return rowToNotification(rows[0]);
  }

  async getNotifications(handle: string, limit = 50): Promise<Notification[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM notifications WHERE recipient_handle=$1 ORDER BY timestamp DESC LIMIT $2',
      [handle, limit],
    );
    return rows.map(rowToNotification);
  }

  async getUnreadCount(handle: string): Promise<number> {
    const { rows } = await this.pool.query(
      'SELECT COUNT(*) FROM notifications WHERE recipient_handle=$1 AND read=FALSE',
      [handle],
    );
    return parseInt(rows[0].count, 10);
  }

  async markNotificationRead(id: string): Promise<void> {
    await this.pool.query('UPDATE notifications SET read=TRUE WHERE id=$1', [id]);
  }

  async markAllNotificationsRead(handle: string): Promise<void> {
    await this.pool.query('UPDATE notifications SET read=TRUE WHERE recipient_handle=$1', [handle]);
  }

  // ── User methods ───────────────────────────────────────────

  async createUser(user: Omit<RouterUser, 'createdAt'>): Promise<RouterUser> {
    const createdAt = Date.now();
    const { rows } = await this.pool.query(
      `INSERT INTO users
         (handle, secret_key_hash, team_id, display_name, bio, email, role,
          is_admin, staging_delay_ms, created_at, skills, following, bookmarks, tag_presets)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        user.handle, user.secretKeyHash, user.teamId,
        user.displayName ?? null, user.bio ?? null, user.email ?? null,
        user.role ?? null, user.isAdmin ?? false,
        user.stagingDelayMs ?? null, createdAt,
        JSON.stringify(user.skills ?? []),
        JSON.stringify(user.following ?? []),
        JSON.stringify(user.bookmarks ?? []),
        JSON.stringify(user.tagPresets ?? []),
      ],
    );
    return rowToUser(rows[0]);
  }

  async getUser(handle: string): Promise<RouterUser | null> {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE handle=$1', [handle]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async getUserByKeyHash(keyHash: string): Promise<RouterUser | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM users
         WHERE secret_key_hash = $1
            OR (previous_secret_key_hash = $1 AND previous_secret_key_expires_at > $2)
         LIMIT 1`,
      [keyHash, Date.now()],
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async updateUser(
    handle: string,
    updates: Partial<Omit<RouterUser, 'handle' | 'secretKeyHash' | 'createdAt'>>,
  ): Promise<RouterUser | null> {
    const setClauses: string[] = [];
    const values: any[] = [handle];
    let idx = 2;

    const scalar = (col: string, val: any) => { setClauses.push(`${col}=$${idx++}`); values.push(val); };
    const json   = (col: string, val: any) => { setClauses.push(`${col}=$${idx++}`); values.push(JSON.stringify(val)); };

    if (updates.displayName   !== undefined) scalar('display_name',    updates.displayName ?? null);
    if (updates.bio           !== undefined) scalar('bio',             updates.bio ?? null);
    if (updates.email         !== undefined) scalar('email',           updates.email ?? null);
    if (updates.role          !== undefined) scalar('role',            updates.role ?? null);
    if (updates.isAdmin       !== undefined) scalar('is_admin',        updates.isAdmin);
    if (updates.stagingDelayMs !== undefined) scalar('staging_delay_ms', updates.stagingDelayMs ?? null);
    if (updates.skills        !== undefined) json('skills',            updates.skills);
    if (updates.following     !== undefined) json('following',         updates.following);
    if (updates.bookmarks     !== undefined) json('bookmarks',         updates.bookmarks);
    if (updates.tagPresets    !== undefined) json('tag_presets',       updates.tagPresets);
    if (updates.notificationWebhook !== undefined) scalar('notification_webhook', updates.notificationWebhook ?? null);
    if (updates.lang !== undefined) scalar('lang', updates.lang ?? null);
    if (updates.larkNotificationPrefs !== undefined) json('lark_notification_prefs', updates.larkNotificationPrefs ?? null);
    if (updates.matrixUserId !== undefined) scalar('matrix_user_id', updates.matrixUserId ?? null);
    if (updates.matrixBoundAt !== undefined) scalar('matrix_bound_at', updates.matrixBoundAt ?? null);
    if (updates.lastConciergeSeenAt !== undefined) scalar('last_concierge_seen_at', updates.lastConciergeSeenAt ?? null);
    if (updates.conciergeRecapEnabled !== undefined) scalar('concierge_recap_enabled', updates.conciergeRecapEnabled);

    if (setClauses.length === 0) return this.getUser(handle);

    const { rows } = await this.pool.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE handle=$1 RETURNING *`,
      values,
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async updateUserPreferences(handle: string, prefs: { syncMode?: 'active' | 'passive'; previewMode?: 'always' | 'never'; privacyStripCustom?: string[] }): Promise<void> {
    const sets: string[] = [];
    const vals: any[] = [];
    if (prefs.syncMode !== undefined) { sets.push(`sync_mode=$${sets.length + 1}`); vals.push(prefs.syncMode); }
    if (prefs.previewMode !== undefined) { sets.push(`preview_mode=$${sets.length + 1}`); vals.push(prefs.previewMode); }
    if (prefs.privacyStripCustom !== undefined) { sets.push(`privacy_strip_custom=$${sets.length + 1}`); vals.push(JSON.stringify(prefs.privacyStripCustom)); }
    if (sets.length === 0) return;
    vals.push(handle);
    await this.pool.query(`UPDATE users SET ${sets.join(', ')} WHERE handle=$${vals.length}`, vals);
  }

  async isHandleAvailable(handle: string): Promise<boolean> {
    const { rows } = await this.pool.query('SELECT 1 FROM users WHERE handle=$1', [handle]);
    return rows.length === 0;
  }

  async searchUsers(prefix: string, limit = 10): Promise<RouterUser[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM users WHERE handle ILIKE $1 LIMIT $2',
      [`${prefix}%`, limit],
    );
    return rows.map(rowToUser);
  }

  async deleteUser(handle: string): Promise<void> {
    // Anonymize-on-delete (P1 fix for handle-reuse data leak).
    // See docs/superpowers/specs/2026-05-14-handle-reuse-leak-fix-design.md.
    //
    // All scalar + JSONB handle references in dependent tables are rewritten
    // to a fresh `_deleted_<6 hex>` placeholder, then the users row is dropped.
    // Wrapped in a transaction so a partial failure can't leave the data in a
    // half-rewritten state where the new owner of the handle would see a
    // mix of old + new content.
    const placeholder = generateDeletedHandle();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Scalar columns
      await client.query('UPDATE entries SET handle=$1 WHERE handle=$2', [placeholder, handle]);
      await client.query('UPDATE notifications SET recipient_handle=$1 WHERE recipient_handle=$2', [placeholder, handle]);
      await client.query('UPDATE notifications SET from_handle=$1 WHERE from_handle=$2', [placeholder, handle]);

      // entries.to_handles: JSONB array of strings ("@hx" / "#channel"). Replace
      // any "@<original>" element with "@<placeholder>".
      await client.query(
        `UPDATE entries
         SET to_handles = (
           SELECT COALESCE(jsonb_agg(
             CASE WHEN elem = to_jsonb($1::text) THEN to_jsonb($2::text) ELSE elem END
           ), '[]'::jsonb)
           FROM jsonb_array_elements(to_handles) AS elem
         )
         WHERE to_handles ? $1`,
        [`@${handle}`, `@${placeholder}`],
      );

      // entries.comments: JSONB array of objects { handle, ... }. Rewrite the
      // inner handle field on any comment authored by the deleted user.
      await client.query(
        `UPDATE entries
         SET comments = (
           SELECT COALESCE(jsonb_agg(
             CASE WHEN c->>'handle' = $1
                  THEN jsonb_set(c, '{handle}', to_jsonb($2::text))
                  ELSE c
             END
           ), '[]'::jsonb)
           FROM jsonb_array_elements(comments) AS c
         )
         WHERE comments @> $3::jsonb`,
        [handle, placeholder, JSON.stringify([{ handle }])],
      );

      // users.following: JSONB array of { handle, note }. Rewrite handle on
      // every remaining user's follow list that referenced the deleted user.
      await client.query(
        `UPDATE users
         SET following = (
           SELECT COALESCE(jsonb_agg(
             CASE WHEN f->>'handle' = $1
                  THEN jsonb_set(f, '{handle}', to_jsonb($2::text))
                  ELSE f
             END
           ), '[]'::jsonb)
           FROM jsonb_array_elements(following) AS f
         )
         WHERE following @> $3::jsonb`,
        [handle, placeholder, JSON.stringify([{ handle }])],
      );

      // Finally drop the user row — handle becomes available for re-registration
      await client.query('DELETE FROM users WHERE handle=$1', [handle]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getUserCount(): Promise<number> {
    const { rows } = await this.pool.query('SELECT COUNT(*) FROM users');
    return parseInt(rows[0].count, 10);
  }

  async getAllUsers(teamId?: string): Promise<RouterUser[]> {
    const { rows } = teamId
      ? await this.pool.query('SELECT * FROM users WHERE team_id=$1 ORDER BY handle', [teamId])
      : await this.pool.query('SELECT * FROM users ORDER BY handle');
    return rows.map(rowToUser);
  }

  // ── Lark binding ────────────────────────────────────────────

  async getUserByLarkOpenId(openId: string): Promise<RouterUser | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM users WHERE lark_open_id = $1 LIMIT 1`,
      [openId],
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async bindLarkAccount(handle: string, fields: LarkBindingFields): Promise<RouterUser | null> {
    // Conflict check: open_id held by ANOTHER user?
    const conflict = await this.pool.query(
      `SELECT 1 FROM users WHERE lark_open_id = $1 AND handle <> $2 LIMIT 1`,
      [fields.larkOpenId, handle],
    );
    if (conflict.rows.length > 0) return null;

    const { rows } = await this.pool.query(
      `UPDATE users SET
         lark_open_id = $1,
         lark_union_id = $2,
         lark_name = $3,
         lark_avatar_url = $4,
         lark_refresh_token = $5,
         lark_refresh_token_expires_at = $6,
         lark_scopes = $7,
         lark_bound_at = $8
       WHERE handle = $9
       RETURNING *`,
      [
        fields.larkOpenId,
        fields.larkUnionId ?? null,
        fields.larkName ?? null,
        fields.larkAvatarUrl ?? null,
        fields.larkRefreshToken,
        fields.larkRefreshTokenExpiresAt,
        JSON.stringify(fields.larkScopes),
        fields.larkBoundAt,
        handle,
      ],
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async unbindLarkAccount(handle: string): Promise<RouterUser | null> {
    const { rows } = await this.pool.query(
      `UPDATE users SET
         lark_open_id = NULL,
         lark_union_id = NULL,
         lark_name = NULL,
         lark_avatar_url = NULL,
         lark_refresh_token = NULL,
         lark_refresh_token_expires_at = NULL,
         lark_scopes = NULL,
         lark_bound_at = NULL
       WHERE handle = $1
       RETURNING *`,
      [handle],
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async getUserByMatrixUserId(matrixUserId: string): Promise<RouterUser | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM users WHERE matrix_user_id = $1 LIMIT 1`,
      [matrixUserId],
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async bindMatrixAccount(handle: string, matrixUserId: string, boundAt = Date.now()): Promise<RouterUser | null> {
    const conflict = await this.pool.query(
      `SELECT 1 FROM users WHERE matrix_user_id = $1 AND handle <> $2 LIMIT 1`,
      [matrixUserId, handle],
    );
    if (conflict.rows.length > 0) return null;

    const { rows } = await this.pool.query(
      `UPDATE users SET
         matrix_user_id = $1,
         matrix_bound_at = $2
       WHERE handle = $3
       RETURNING *`,
      [matrixUserId, boundAt, handle],
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async getSparkPairRoom(teamId: string, handleA: string, handleB: string): Promise<SparkPairRoom | null> {
    const pairKey = getSparkPairKey(handleA, handleB);
    const { rows } = await this.pool.query(
      `SELECT * FROM spark_pair_rooms WHERE team_id = $1 AND pair_key = $2 LIMIT 1`,
      [teamId, pairKey],
    );
    return rows[0] ? rowToSparkPairRoom(rows[0]) : null;
  }

  async setSparkPairRoom(teamId: string, handleA: string, handleB: string, roomId: string, now = Date.now()): Promise<SparkPairRoom> {
    const pairKey = getSparkPairKey(handleA, handleB);
    const sourceHandle = handleA.replace(/^@/, '').trim().toLowerCase();
    const targetHandle = handleB.replace(/^@/, '').trim().toLowerCase();
    const { rows } = await this.pool.query(
      `INSERT INTO spark_pair_rooms
         (team_id, pair_key, source_handle, target_handle, room_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (team_id, pair_key) DO UPDATE SET
         room_id = EXCLUDED.room_id,
         source_handle = EXCLUDED.source_handle,
         target_handle = EXCLUDED.target_handle,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [teamId, pairKey, sourceHandle, targetHandle, roomId, now],
    );
    return rowToSparkPairRoom(rows[0]);
  }

  async rotateSecretKey(handle: string, graceMs = 7 * 86400 * 1000): Promise<{ newKey: string; user: RouterUser } | null> {
    const newKey = generateSecretKey();
    const newHash = hashSecretKey(newKey);
    const expiresAt = Date.now() + graceMs;

    const { rows } = await this.pool.query(
      `UPDATE users SET
         previous_secret_key_hash = secret_key_hash,
         previous_secret_key_expires_at = $1,
         secret_key_hash = $2
       WHERE handle = $3
       RETURNING *`,
      [expiresAt, newHash, handle],
    );
    if (!rows[0]) return null;
    return { newKey, user: rowToUser(rows[0]) };
  }

  async generateAdditionalKeyForUser(handle: string): Promise<string> {
    // v1 single-key model: rotate to a new key. Multi-key per user is v1.1.
    const key = generateSecretKey();
    const tag = hashSecretKey(key);
    await this.pool.query(`UPDATE users SET secret_key_hash=$1 WHERE handle=$2`, [tag, handle]);
    return key;
  }

  // ── Team methods ───────────────────────────────────────────

  async createTeam(team: Team): Promise<Team> {
    const { rows } = await this.pool.query(
      `INSERT INTO teams (id, name, created_by, created_at) VALUES ($1,$2,$3,$4) RETURNING *`,
      [team.id, team.name, team.createdBy, team.createdAt],
    );
    return rowToTeam(rows[0]);
  }

  async getTeam(id: string): Promise<Team | null> {
    const { rows } = await this.pool.query('SELECT * FROM teams WHERE id=$1', [id]);
    return rows[0] ? rowToTeam(rows[0]) : null;
  }

  async isTeamIdAvailable(id: string): Promise<boolean> {
    const { rows } = await this.pool.query('SELECT 1 FROM teams WHERE id=$1', [id]);
    return rows.length === 0;
  }

  // ── Team Memory methods ───────────────────────────────────

  async getTeamMemory(teamId: string): Promise<TeamMemory | null> {
    const { rows } = await this.pool.query(
      'SELECT team_id, content, previous_content, updated_at, updated_by_handle FROM team_memory WHERE team_id=$1',
      [teamId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      teamId: r.team_id,
      content: r.content,
      previousContent: r.previous_content ?? null,
      updatedAt: Number(r.updated_at),
      updatedByHandle: r.updated_by_handle ?? null,
    };
  }

  async upsertTeamMemory(teamId: string, content: string, byHandle: string): Promise<TeamMemory> {
    const now = Date.now();
    // Two-step so we capture existing.content as previous_content before overwriting.
    const existing = await this.getTeamMemory(teamId);
    const previous = existing?.content ?? null;
    await this.pool.query(
      `INSERT INTO team_memory (team_id, content, previous_content, updated_at, updated_by_handle)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (team_id) DO UPDATE
       SET content = EXCLUDED.content,
           previous_content = EXCLUDED.previous_content,
           updated_at = EXCLUDED.updated_at,
           updated_by_handle = EXCLUDED.updated_by_handle`,
      [teamId, content, previous, now, byHandle],
    );
    return { teamId, content, previousContent: previous, updatedAt: now, updatedByHandle: byHandle };
  }

  async rollbackTeamMemory(teamId: string, byHandle: string): Promise<TeamMemory | null> {
    const existing = await this.getTeamMemory(teamId);
    if (!existing || existing.previousContent === null) return null;
    const now = Date.now();
    const swapped: TeamMemory = {
      teamId,
      content: existing.previousContent,
      previousContent: existing.content,
      updatedAt: now,
      updatedByHandle: byHandle,
    };
    await this.pool.query(
      `UPDATE team_memory
       SET content=$1, previous_content=$2, updated_at=$3, updated_by_handle=$4
       WHERE team_id=$5`,
      [swapped.content, swapped.previousContent, now, byHandle, teamId],
    );
    return swapped;
  }

  // ── Team invite methods ────────────────────────────────────

  async createTeamInvite(invite: TeamInvite): Promise<TeamInvite> {
    const { rows } = await this.pool.query(
      `INSERT INTO team_invites (code, team_id, created_by, created_at, expires_at, max_uses, uses)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [invite.code, invite.teamId, invite.createdBy, invite.createdAt,
       invite.expiresAt ?? null, invite.maxUses ?? null, invite.uses],
    );
    return rowToTeamInvite(rows[0]);
  }

  async getTeamInvite(code: string): Promise<TeamInvite | null> {
    const { rows } = await this.pool.query('SELECT * FROM team_invites WHERE code=$1', [code]);
    return rows[0] ? rowToTeamInvite(rows[0]) : null;
  }

  async useTeamInvite(code: string): Promise<TeamInvite> {
    const invite = await this.getTeamInvite(code);
    if (!invite) throw new Error('Invite not found.');
    if (invite.expiresAt && Date.now() > invite.expiresAt) throw new Error('Invite has expired.');
    if (invite.maxUses && invite.uses >= invite.maxUses) throw new Error('Invite has reached maximum uses.');
    const { rows } = await this.pool.query(
      'UPDATE team_invites SET uses=uses+1 WHERE code=$1 RETURNING *',
      [code],
    );
    return rowToTeamInvite(rows[0]);
  }

  async listTeamInvites(teamId: string): Promise<TeamInvite[]> {
    const { rows } = await this.pool.query('SELECT * FROM team_invites WHERE team_id=$1', [teamId]);
    return rows.map(rowToTeamInvite);
  }

  // ── Tag config + legacy Channel methods ───────────────────────
  //
  // The channels table is frozen post-Phase-1; all reads and writes go to
  // tag_configs. Legacy Channel methods are wrappers over the tag_configs
  // SQL. See docs/superpowers/specs/2026-05-15-tag-unification-design.md.

  async getTagConfig(teamId: string, tag: string): Promise<TagConfig | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM tag_configs WHERE team_id=$1 AND tag=$2',
      [teamId, tag],
    );
    return rows[0] ? rowToTagConfig(rows[0]) : null;
  }

  async listTagConfigs(teamId: string, opts?: { handle?: string }): Promise<TagConfig[]> {
    void opts;
    const { rows } = await this.pool.query(
      'SELECT * FROM tag_configs WHERE team_id=$1 ORDER BY tag ASC',
      [teamId],
    );
    return rows.map(rowToTagConfig);
  }

  async upsertTagConfig(
    teamId: string,
    tag: string,
    fields: Partial<Omit<TagConfig, 'teamId' | 'tag' | 'createdAt'>>,
  ): Promise<TagConfig> {
    const now = Date.now();
    // INSERT path coalesces null -> '[]' so the NOT NULL constraint on
    // subscribers/skills is satisfied. UPDATE path references the bound param
    // directly (not EXCLUDED, which would already be the coalesced value), so
    // passing `null` from JS still means "preserve existing value".
    const { rows } = await this.pool.query(
      `INSERT INTO tag_configs (team_id, tag, name, description, created_by, created_at, subscribers, skills)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::jsonb, '[]'::jsonb), COALESCE($8::jsonb, '[]'::jsonb))
       ON CONFLICT (team_id, tag) DO UPDATE SET
         name = COALESCE($3, tag_configs.name),
         description = COALESCE($4, tag_configs.description),
         created_by = COALESCE(tag_configs.created_by, $5),
         subscribers = COALESCE($7::jsonb, tag_configs.subscribers),
         skills = COALESCE($8::jsonb, tag_configs.skills)
       RETURNING *`,
      [
        teamId, tag,
        fields.name ?? null,
        fields.description ?? null,
        fields.createdBy ?? null,
        now,
        fields.subscribers ? JSON.stringify(fields.subscribers) : null,
        fields.skills ? JSON.stringify(fields.skills) : null,
      ],
    );
    return rowToTagConfig(rows[0]);
  }

  async addTagSubscriber(
    teamId: string,
    tag: string,
    handle: string,
    role: 'admin' | 'member' = 'member',
  ): Promise<TagConfig> {
    const subscriber: ChannelSubscriber = { handle, role, joinedAt: Date.now() };
    const { rows } = await this.pool.query(
      `INSERT INTO tag_configs (team_id, tag, created_at, subscribers, skills)
       VALUES ($1, $2, $3, $4::jsonb, '[]'::jsonb)
       ON CONFLICT (team_id, tag) DO UPDATE SET
         subscribers = CASE
           WHEN EXISTS (
             SELECT 1 FROM jsonb_array_elements(tag_configs.subscribers) AS s
             WHERE s->>'handle' = $5
           )
           THEN tag_configs.subscribers
           ELSE tag_configs.subscribers || $4::jsonb
         END
       RETURNING *`,
      [teamId, tag, Date.now(), JSON.stringify([subscriber]), handle],
    );
    return rowToTagConfig(rows[0]);
  }

  async removeTagSubscriber(teamId: string, tag: string, handle: string): Promise<TagConfig | null> {
    const { rows } = await this.pool.query(
      `UPDATE tag_configs SET subscribers = (
         SELECT COALESCE(jsonb_agg(s), '[]'::jsonb)
         FROM jsonb_array_elements(subscribers) AS s
         WHERE s->>'handle' != $3
       )
       WHERE team_id=$1 AND tag=$2
       RETURNING *`,
      [teamId, tag, handle],
    );
    return rows[0] ? rowToTagConfig(rows[0]) : null;
  }

  async getEntriesByTag(teamId: string, tag: string, limit = 50): Promise<RouterEntry[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM entries
       WHERE team_id=$1
         AND (tags @> $2::jsonb OR channel=$3 OR to_handles ? $4)
       ORDER BY timestamp DESC LIMIT $5`,
      [teamId, JSON.stringify([tag]), tag, `#${tag}`, limit],
    );
    return rows.map(rowToEntry);
  }

  async getSubscribedTags(handle: string): Promise<TagConfig[]> {
    const { rows } = await this.pool.query(
      `SELECT hc.* FROM tag_configs hc
       JOIN users u ON u.team_id = hc.team_id
       WHERE u.handle = $1
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(hc.subscribers) AS s
           WHERE s->>'handle' = $1
         )
       ORDER BY hc.tag ASC`,
      [handle],
    );
    return rows.map(rowToTagConfig);
  }

  // ── Legacy Channel API (wrappers over tag_configs) ──

  async createChannel(channel: Channel): Promise<Channel> {
    const existing = await this.getTagConfig(channel.teamId, channel.id);
    if (existing) throw new Error(`Channel "${channel.id}" already exists.`);
    const cfg = await this.upsertTagConfig(channel.teamId, channel.id, {
      name: channel.name,
      description: channel.description,
      createdBy: channel.createdBy,
      skills: channel.skills ?? [],
      subscribers: channel.subscribers ?? [],
    });
    return tagConfigToChannel(cfg);
  }

  async getChannel(id: string): Promise<Channel | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM tag_configs WHERE tag=$1 LIMIT 1',
      [id],
    );
    return rows[0] ? tagConfigToChannel(rowToTagConfig(rows[0])) : null;
  }

  async updateChannel(
    id: string,
    updates: Partial<Omit<Channel, 'id' | 'createdBy' | 'createdAt' | 'teamId'>>,
  ): Promise<Channel | null> {
    const setClauses: string[] = [];
    const values: any[] = [id];
    let idx = 2;

    if (updates.name        !== undefined) { setClauses.push(`name=$${idx++}`);        values.push(updates.name); }
    if (updates.description !== undefined) { setClauses.push(`description=$${idx++}`); values.push(updates.description ?? null); }
    // updates.joinRule is dropped — tag_configs has no join_rule column. B-plus
    // treats every tag as "open".
    if (updates.skills      !== undefined) { setClauses.push(`skills=$${idx++}`);      values.push(JSON.stringify(updates.skills)); }
    if (updates.subscribers !== undefined) { setClauses.push(`subscribers=$${idx++}`); values.push(JSON.stringify(updates.subscribers)); }

    if (setClauses.length === 0) return this.getChannel(id);

    const { rows } = await this.pool.query(
      `UPDATE tag_configs SET ${setClauses.join(', ')} WHERE tag=$1 RETURNING *`,
      values,
    );
    return rows[0] ? tagConfigToChannel(rowToTagConfig(rows[0])) : null;
  }

  async deleteChannel(id: string): Promise<void> {
    await this.pool.query('DELETE FROM channel_invites WHERE channel_id=$1', [id]);
    await this.pool.query('DELETE FROM tag_configs WHERE tag=$1', [id]);
  }

  async listChannels(teamId: string, opts?: { handle?: string }): Promise<Channel[]> {
    void opts;
    return (await this.listTagConfigs(teamId)).map(tagConfigToChannel);
  }

  async listAllChannels(): Promise<Channel[]> {
    const { rows } = await this.pool.query('SELECT * FROM tag_configs ORDER BY tag ASC');
    return rows.map(r => tagConfigToChannel(rowToTagConfig(r)));
  }

  async addSubscriber(channelId: string, handle: string, role: 'admin' | 'member'): Promise<void> {
    // Legacy signature: only channelId provided. Resolve team_id from the
    // matching tag_configs row.
    const { rows } = await this.pool.query(
      'SELECT team_id FROM tag_configs WHERE tag=$1 LIMIT 1',
      [channelId],
    );
    if (!rows[0]) throw new Error(`Channel "${channelId}" not found.`);
    await this.addTagSubscriber(rows[0].team_id, channelId, handle, role);
  }

  async removeSubscriber(channelId: string, handle: string): Promise<void> {
    const { rows } = await this.pool.query(
      'SELECT team_id FROM tag_configs WHERE tag=$1 LIMIT 1',
      [channelId],
    );
    if (!rows[0]) throw new Error(`Channel "${channelId}" not found.`);
    await this.removeTagSubscriber(rows[0].team_id, channelId, handle);
  }

  async getSubscribedChannels(handle: string): Promise<Channel[]> {
    // Channels are team-public — return every hash_config in the user's team.
    const u = await this.pool.query(`SELECT team_id FROM users WHERE handle=$1 LIMIT 1`, [handle]);
    const teamId = u.rows[0]?.team_id;
    if (!teamId) return [];
    return (await this.listTagConfigs(teamId)).map(tagConfigToChannel);
  }

  async createInvite(invite: ChannelInvite): Promise<ChannelInvite> {
    const { rows } = await this.pool.query(
      `INSERT INTO channel_invites
         (token, channel_id, created_by, created_at, expires_at, max_uses, uses)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [invite.token, invite.channelId, invite.createdBy, invite.createdAt,
       invite.expiresAt ?? null, invite.maxUses ?? null, invite.uses],
    );
    return rowToChannelInvite(rows[0]);
  }

  async getInvite(token: string): Promise<ChannelInvite | null> {
    const { rows } = await this.pool.query('SELECT * FROM channel_invites WHERE token=$1', [token]);
    return rows[0] ? rowToChannelInvite(rows[0]) : null;
  }

  async useInvite(token: string): Promise<Channel> {
    const invite = await this.getInvite(token);
    if (!invite) throw new Error('Invite not found.');
    if (invite.expiresAt && Date.now() > invite.expiresAt) throw new Error('Invite has expired.');
    if (invite.maxUses && invite.uses >= invite.maxUses) throw new Error('Invite has reached maximum uses.');
    await this.pool.query('UPDATE channel_invites SET uses=uses+1 WHERE token=$1', [token]);
    const channel = await this.getChannel(invite.channelId);
    if (!channel) throw new Error('Channel not found.');
    return channel;
  }

  // ── Preset tag methods ────────────────────────────────────────

  async getPresetTags(): Promise<PresetTag[]> {
    const { rows } = await this.pool.query('SELECT * FROM preset_tags ORDER BY name');
    return rows.map(rowToPresetTag);
  }

  async addPresetTag(tag: PresetTag): Promise<PresetTag> {
    const { rows } = await this.pool.query(
      'INSERT INTO preset_tags (name, description, created_at) VALUES ($1, $2, $3) RETURNING *',
      [tag.name, tag.description, tag.createdAt],
    );
    return rowToPresetTag(rows[0]);
  }

  async updatePresetTag(name: string, description: string): Promise<PresetTag | null> {
    const { rows } = await this.pool.query(
      'UPDATE preset_tags SET description=$2 WHERE name=$1 RETURNING *',
      [name, description],
    );
    return rows[0] ? rowToPresetTag(rows[0]) : null;
  }

  async deletePresetTag(name: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM preset_tags WHERE name=$1', [name]);
    return (rowCount ?? 0) > 0;
  }

  // ── Sessions ──────────────────────────────────────────────

  async createSession(handle: string, ttlMs: number = DEFAULT_SESSION_TTL_MS, userAgent?: string): Promise<{ token: string; expiresAt: number }> {
    const token = generateSessionToken();
    const now = Date.now();
    const expiresAt = now + ttlMs;
    await this.pool.query(
      `INSERT INTO sessions (token, handle, created_at, expires_at, user_agent) VALUES ($1, $2, $3, $4, $5)`,
      [token, handle, now, expiresAt, userAgent ?? null],
    );
    return { token, expiresAt };
  }

  async getSession(token: string): Promise<Session | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM sessions WHERE token=$1 LIMIT 1`,
      [token],
    );
    const r = rows[0];
    if (!r) return null;
    if (Number(r.expires_at) <= Date.now()) {
      // Lazy delete on expiry
      await this.pool.query(`DELETE FROM sessions WHERE token=$1`, [token]);
      return null;
    }
    return {
      token: r.token,
      handle: r.handle,
      createdAt: Number(r.created_at),
      expiresAt: Number(r.expires_at),
      userAgent: r.user_agent ?? undefined,
    };
  }

  async touchSession(token: string, ttlMs: number = DEFAULT_SESSION_TTL_MS): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET expires_at = $1 WHERE token = $2`,
      [Date.now() + ttlMs, token],
    );
  }

  async deleteSession(token: string): Promise<void> {
    await this.pool.query(`DELETE FROM sessions WHERE token=$1`, [token]);
  }

  // ── Lark Phase 1 ──

  async createLarkChatBinding(b: Omit<LarkChatBinding, 'lastSummaryTs' | 'lastSummaryAt'>): Promise<LarkChatBinding> {
    await this.pool.query(
      `INSERT INTO lark_chat_bindings (chat_id, channel_id, team_id, bound_by, bound_at, chat_name, archive_channel_id, push_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [b.chatId, b.channelId, b.teamId, b.boundBy, b.boundAt, b.chatName, b.archiveChannelId ?? null, b.pushEnabled ?? false],
    );
    return { pushEnabled: false, ...b };
  }

  async getLarkChatBinding(chatId: string): Promise<LarkChatBinding | null> {
    const { rows } = await this.pool.query(`SELECT * FROM lark_chat_bindings WHERE chat_id=$1 LIMIT 1`, [chatId]);
    const r = rows[0];
    return r ? this.rowToBinding(r) : null;
  }

  async listLarkChatBindingsByChannel(channelId: string): Promise<LarkChatBinding[]> {
    const { rows } = await this.pool.query(`SELECT * FROM lark_chat_bindings WHERE channel_id=$1 ORDER BY bound_at DESC`, [channelId]);
    return rows.map((r: any) => this.rowToBinding(r));
  }

  async listLarkChatBindingsByTeam(teamId: string): Promise<LarkChatBinding[]> {
    const { rows } = await this.pool.query(`SELECT * FROM lark_chat_bindings WHERE team_id=$1 ORDER BY bound_at DESC`, [teamId]);
    return rows.map((r: any) => this.rowToBinding(r));
  }

  async deleteLarkChatBinding(chatId: string): Promise<void> {
    await this.pool.query(`DELETE FROM lark_chat_bindings WHERE chat_id=$1`, [chatId]);
  }

  async updateLarkLastSummary(chatId: string, lastSummaryTs: number, lastSummaryAt: number): Promise<void> {
    await this.pool.query(
      `UPDATE lark_chat_bindings SET last_summary_ts=$1, last_summary_at=$2 WHERE chat_id=$3`,
      [lastSummaryTs, lastSummaryAt, chatId],
    );
  }

  async updateLarkBindingArchive(chatId: string, archiveChannelId: string | null): Promise<void> {
    await this.pool.query(
      `UPDATE lark_chat_bindings SET archive_channel_id=$1 WHERE chat_id=$2`,
      [archiveChannelId, chatId],
    );
  }

  async updateLarkBindingPushEnabled(chatId: string, pushEnabled: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE lark_chat_bindings SET push_enabled=$1 WHERE chat_id=$2`,
      [pushEnabled, chatId],
    );
  }

  async updateLarkBindingSummaryStyle(chatId: string, style: 'person' | 'topic' | 'free'): Promise<void> {
    await this.pool.query(
      `UPDATE lark_chat_bindings SET summary_style=$1 WHERE chat_id=$2`,
      [style, chatId],
    );
  }

  async getLarkChatStyle(chatId: string): Promise<'person' | 'topic' | 'free' | null> {
    const { rows } = await this.pool.query(
      `SELECT summary_style FROM lark_chat_prefs WHERE chat_id=$1 LIMIT 1`,
      [chatId],
    );
    const v = rows[0]?.summary_style;
    if (v === 'person' || v === 'topic' || v === 'free') return v;
    return null;
  }

  async setLarkChatStyle(chatId: string, style: 'person' | 'topic' | 'free'): Promise<void> {
    await this.pool.query(
      `INSERT INTO lark_chat_prefs (chat_id, summary_style, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (chat_id) DO UPDATE SET summary_style = EXCLUDED.summary_style, updated_at = EXCLUDED.updated_at`,
      [chatId, style, Date.now()],
    );
  }

  async getLarkAutoSummary(chatId: string): Promise<LarkAutoSummaryPrefs | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM lark_auto_summary WHERE chat_id=$1 LIMIT 1`,
      [chatId],
    );
    if (rows.length === 0) return null;
    return rowToAutoSummary(rows[0]);
  }

  async setLarkAutoSummary(
    chatId: string,
    prefs: Omit<LarkAutoSummaryPrefs, 'chatId' | 'updatedAt' | 'lastRunAt'>,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO lark_auto_summary
         (chat_id, enabled, cadence_kind, cadence_value, fire_hour, setup_by_open_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (chat_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         cadence_kind = EXCLUDED.cadence_kind,
         cadence_value = EXCLUDED.cadence_value,
         fire_hour = EXCLUDED.fire_hour,
         setup_by_open_id = EXCLUDED.setup_by_open_id,
         updated_at = EXCLUDED.updated_at`,
      [
        chatId,
        prefs.enabled,
        prefs.cadenceKind,
        prefs.cadenceValue,
        prefs.fireHour,
        prefs.setupByOpenId,
        Date.now(),
      ],
    );
  }

  async recordLarkAutoSummaryRan(chatId: string, ranAt: number): Promise<void> {
    await this.pool.query(
      `UPDATE lark_auto_summary SET last_run_at=$1 WHERE chat_id=$2`,
      [ranAt, chatId],
    );
  }

  async listLarkAutoSummaryEnabled(): Promise<LarkAutoSummaryPrefs[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM lark_auto_summary WHERE enabled=TRUE`,
    );
    return rows.map(rowToAutoSummary);
  }

  async updateLarkBindingWatchEnabled(chatId: string, enabled: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE lark_chat_bindings SET watch_enabled=$1 WHERE chat_id=$2`,
      [enabled, chatId],
    );
  }

  async incrementLarkWatchMsgCount(chatId: string): Promise<void> {
    await this.pool.query(
      `UPDATE lark_chat_bindings SET watch_msg_count = COALESCE(watch_msg_count, 0) + 1 WHERE chat_id=$1`,
      [chatId],
    );
  }

  async recordLarkWatchRan(chatId: string, ranAt: number): Promise<void> {
    await this.pool.query(
      `UPDATE lark_chat_bindings SET watch_last_ran_at=$1, watch_msg_count=0 WHERE chat_id=$2`,
      [ranAt, chatId],
    );
  }

  async recordLarkWatchPosted(chatId: string, postedAt: number): Promise<void> {
    await this.pool.query(
      `UPDATE lark_chat_bindings SET watch_last_posted_at=$1 WHERE chat_id=$2`,
      [postedAt, chatId],
    );
  }

  async recordLarkWatchObservations(chatId: string, ranAt: number, observations: LarkWatchObservation['observations']): Promise<void> {
    if (!observations.length) return;
    await this.pool.query(
      `INSERT INTO lark_watch_observations (chat_id, ran_at, observations) VALUES ($1, $2, $3)`,
      [chatId, ranAt, JSON.stringify(observations)],
    );
  }

  async listLarkWatchObservationsRecent(chatId: string, limit: number): Promise<LarkWatchObservation[]> {
    const { rows } = await this.pool.query(
      `SELECT id, chat_id, ran_at, observations FROM lark_watch_observations
       WHERE chat_id=$1 ORDER BY ran_at DESC LIMIT $2`,
      [chatId, limit],
    );
    return rows
      .map((r: any) => ({
        id: Number(r.id),
        chatId: r.chat_id,
        ranAt: Number(r.ran_at),
        observations: typeof r.observations === 'string' ? JSON.parse(r.observations) : r.observations,
      }))
      .reverse();  // oldest-first
  }

  async deleteLarkWatchObservationsBefore(cutoffMs: number): Promise<number> {
    const r = await this.pool.query(`DELETE FROM lark_watch_observations WHERE ran_at < $1`, [cutoffMs]);
    return r.rowCount ?? 0;
  }

  async recordLarkMessageReaction(r: Omit<LarkMessageReaction, 'id'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO lark_message_reactions (chat_id, message_id, open_id, emoji_type, action, reacted_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.chatId, r.messageId, r.openId, r.emojiType, r.action, r.reactedAt],
    );
  }

  async listLarkMessageReactionsByMessage(messageId: string): Promise<LarkMessageReaction[]> {
    const { rows } = await this.pool.query(
      `SELECT id, chat_id, message_id, open_id, emoji_type, action, reacted_at FROM lark_message_reactions
       WHERE message_id=$1 ORDER BY reacted_at ASC`,
      [messageId],
    );
    return rows.map((row: any) => ({
      id: Number(row.id),
      chatId: row.chat_id,
      messageId: row.message_id,
      openId: row.open_id,
      emojiType: row.emoji_type,
      action: row.action,
      reactedAt: Number(row.reacted_at),
    }));
  }

  async recordLarkEntryMessage(messageId: string, entryId: string, chatId: string, postedAt: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO lark_entry_messages (message_id, entry_id, chat_id, posted_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id) DO UPDATE SET entry_id = EXCLUDED.entry_id, chat_id = EXCLUDED.chat_id, posted_at = EXCLUDED.posted_at`,
      [messageId, entryId, chatId, postedAt],
    );
  }

  async getEntryReactionSummary(entryId: string): Promise<Array<{ emojiType: string; count: number }>> {
    // For each (open_id, emoji_type), find the latest action across all
    // messages tied to the entry. Count when latest action is 'added'.
    const { rows } = await this.pool.query(
      `SELECT emoji_type, COUNT(*) AS n FROM (
         SELECT DISTINCT ON (r.open_id, r.emoji_type)
           r.open_id, r.emoji_type, r.action
         FROM lark_message_reactions r
         JOIN lark_entry_messages m ON r.message_id = m.message_id
         WHERE m.entry_id = $1
         ORDER BY r.open_id, r.emoji_type, r.reacted_at DESC
       ) latest
       WHERE action = 'added'
       GROUP BY emoji_type
       ORDER BY n DESC`,
      [entryId],
    );
    return rows.map((r: any) => ({ emojiType: r.emoji_type, count: Number(r.n) }));
  }

  async recordLarkCardAction(a: Omit<LarkCardAction, 'id'>): Promise<LarkCardAction> {
    const { rows } = await this.pool.query(
      `INSERT INTO lark_card_actions (entry_id, chat_id, open_id, action, payload, acted_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [a.entryId, a.chatId, a.openId, a.action, a.payload ? JSON.stringify(a.payload) : null, a.actedAt],
    );
    return { ...a, id: Number(rows[0].id) };
  }

  async listLarkCardActionsByEntry(entryId: string): Promise<LarkCardAction[]> {
    const { rows } = await this.pool.query(`SELECT * FROM lark_card_actions WHERE entry_id=$1 ORDER BY acted_at ASC`, [entryId]);
    return rows.map((r: any) => ({
      id: Number(r.id),
      entryId: r.entry_id,
      chatId: r.chat_id,
      openId: r.open_id,
      action: r.action,
      payload: r.payload ?? undefined,
      actedAt: Number(r.acted_at),
    }));
  }

  private rowToBinding(r: any): LarkChatBinding {
    return {
      chatId: r.chat_id,
      channelId: r.channel_id,
      teamId: r.team_id,
      boundBy: r.bound_by,
      boundAt: Number(r.bound_at),
      chatName: r.chat_name,
      archiveChannelId: r.archive_channel_id ?? undefined,
      lastSummaryTs: r.last_summary_ts != null ? Number(r.last_summary_ts) : undefined,
      lastSummaryAt: r.last_summary_at != null ? Number(r.last_summary_at) : undefined,
      pushEnabled: r.push_enabled == null ? false : !!r.push_enabled,
      watchEnabled: r.watch_enabled == null ? false : !!r.watch_enabled,
      watchMsgCount: r.watch_msg_count == null ? 0 : Number(r.watch_msg_count),
      watchLastRanAt: r.watch_last_ran_at != null ? Number(r.watch_last_ran_at) : undefined,
      watchLastPostedAt: r.watch_last_posted_at != null ? Number(r.watch_last_posted_at) : undefined,
      summaryStyle: (r.summary_style === 'topic' || r.summary_style === 'free') ? r.summary_style : 'person',
    };
  }

  // Usage / observability — backs /api/admin/usage-stats. Used to make
  // data-driven decisions about MCP deprecation timing.
  async getUsageStats(): Promise<{
    by_client_30d: { client: string; count: number }[];
    by_client_7d: { client: string; count: number }[];
    unique_users_30d: { client: string; users: number }[];
  }> {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const since30 = now - 30 * day;
    const since7 = now - 7 * day;

    const [byClient30, byClient7, uniqueUsers30] = await Promise.all([
      this.pool.query(
        `SELECT client, COUNT(*)::int AS count
         FROM entries
         WHERE timestamp > $1
         GROUP BY client
         ORDER BY count DESC`,
        [since30],
      ),
      this.pool.query(
        `SELECT client, COUNT(*)::int AS count
         FROM entries
         WHERE timestamp > $1
         GROUP BY client
         ORDER BY count DESC`,
        [since7],
      ),
      this.pool.query(
        `SELECT client, COUNT(DISTINCT handle)::int AS users
         FROM entries
         WHERE timestamp > $1
         GROUP BY client
         ORDER BY users DESC`,
        [since30],
      ),
    ]);

    return {
      by_client_30d: byClient30.rows,
      by_client_7d: byClient7.rows,
      unique_users_30d: uniqueUsers30.rows,
    };
  }
}
