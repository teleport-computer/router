/**
 * Teleport Router — Storage Layer
 *
 * Data models and storage implementations for the team collaboration hub.
 * Based on Hermes storage, adapted for multi-team use with structured tags.
 */

import { randomBytes } from 'crypto';
import { generateSecretKey, hashSecretKey, generateSessionToken } from './identity.js';
import { generateDeletedHandle } from './deleted-user.js';

// ─────────────────────────────────────────────────────────────
// Data Models
// ─────────────────────────────────────────────────────────────

export interface Comment {
  id: string;                  // Unique comment ID
  handle: string;              // Author
  content: string;             // Comment text (supports markdown)
  timestamp: number;
  translations?: Record<string, string>; // lang code → translated content
}

export interface PresetTag {
  name: string;
  description: string;
  createdAt: number;
}

export interface Notification {
  id: string;
  recipientHandle: string;     // Who receives this notification
  teamId: string;
  // 'digest' is the legacy name for what is now 'weekly_brief' (was daily, now weekly).
  // Legacy rows still in the inbox keep their type — UI labels both as "weekly brief".
  type: 'mention' | 'comment' | 'reply' | 'admin_granted' | 'admin_revoked' | 'digest' | 'weekly_brief';
  fromHandle: string;          // Who triggered it
  entryId?: string;            // Related entry (absent for non-entry events like admin_granted)
  commentId?: string;          // Related comment (if applicable)
  preview: string;             // Short text preview
  read: boolean;
  timestamp: number;
}

export interface RouterEntry {
  id: string;
  handle: string;              // Author (required, no anonymous)
  teamId: string;              // Team namespace
  client: 'desktop' | 'mobile' | 'code' | 'lark';
  content: string;             // Original content
  summary: string;             // AI-generated summary (independent field)
  tags: string[];              // Tag array (independent field, indexable)
  role?: string;               // frontend / backend / design / pm / infra
  timestamp: number;
  keywords?: string[];         // Tokenized for search
  model?: string;              // AI model identifier
  to?: string[];               // Addressing: #channels, @handles
  inReplyTo?: string;          // Thread parent entry ID (kept for backward compat)
  channel?: string;            // Channel ID
  publishAt?: number | null;   // Staged publishing: when this entry becomes visible (null/undefined = already published)
  comments?: Comment[];        // Inline comments (lightweight, attached to entry)
  hidden?: boolean;            // Only visible to author
  oneliner?: string;           // Ultra-short summary (~15 chars) for sharing contexts
  translations?: Record<string, { summary: string; content?: string; oneliner?: string }>;
  webhookFired?: boolean;       // True after channel webhooks have been evaluated for this entry
  matrixMirrorRoomId?: string;   // Matrix room where this entry was mirrored
  matrixMirrorEventId?: string;  // Matrix event id (or deterministic txn marker) for the mirror post
  matrixMirroredAt?: number;     // Timestamp when Matrix mirror succeeded
  // ── Source tracking (record-only; UI deferred until we collect real-world data) ──
  sourceApp?: string;           // Detected client app: cc-cli / cc-desktop / codex / cursor / router-cli / web / lark-bot / unknown / etc.
  sourceVia?: string;           // Transport: mcp-http / mcp-sse / http-api / internal
}

export interface LarkNotificationPrefs {
  mention?: boolean;   // default true
  comment?: boolean;   // default true
  reply?: boolean;     // default true
  digest?: boolean;    // default true — Concierge daily brief Lark push
}

export interface RouterUser {
  handle: string;              // Unique identifier (3-15 chars)
  secretKeyHash: string;       // SHA-256 tag of secret key
  teamId: string;              // Team membership
  displayName?: string;
  bio?: string;
  email?: string;
  role?: string;               // Team role
  isAdmin?: boolean;           // Team admin flag
  stagingDelayMs?: number;     // How long entries stay pending before publishing (default 15 minutes)
  createdAt: number;
  skills?: Skill[];            // User-created skills
  following?: { handle: string; note: string }[];
  bookmarks?: string[];        // Bookmarked entry IDs
  tagPresets?: TagPreset[];    // Saved tag combinations
  notificationWebhook?: string; // Personal webhook URL — POST'd on @mentions etc.
  lang?: 'en' | 'zh';            // Preferred UI + notification language (default en)
  syncMode?: 'active' | 'passive';            // CLI v1: sync behavior preference
  previewMode?: 'always' | 'never';           // CLI v1: show preview before push
  privacyStripCustom?: string[];              // CLI v1: extra regex patterns for passive mode

  // ── Lark Phase 0 binding ──
  larkOpenId?: string;
  larkUnionId?: string;
  larkName?: string;
  larkAvatarUrl?: string;
  larkRefreshToken?: string;
  larkRefreshTokenExpiresAt?: number;
  larkScopes?: string[];
  larkBoundAt?: number;

  // ── Matrix account binding ──
  matrixUserId?: string;
  matrixBoundAt?: number;

  // ── Lark notification preferences ──
  larkNotificationPrefs?: LarkNotificationPrefs;

  // ── Concierge (proactive recap) ──
  // Last time we delivered a "since you were gone" recap to this user.
  // Updated whenever the user fetches /api/concierge/recap so subsequent
  // calls only surface NEW activity. null/undefined → first-time user;
  // algorithm defaults to a 7-day lookback in that case.
  lastConciergeSeenAt?: number;
  // Opt-out: when false, MCP instructions / brief endpoints don't return
  // recap content. Defaults to true (recap is on for everyone).
  conciergeRecapEnabled?: boolean;

  // ── secret_key 7-day grace period after rotation ──
  previousSecretKeyHash?: string;
  previousSecretKeyExpiresAt?: number;
}

// ─────────────────────────────────────────────────────────────
// Lark chat binding (M2b)
// ─────────────────────────────────────────────────────────────

export interface LarkChatBinding {
  chatId: string;
  channelId: string;
  teamId: string;
  boundBy: string | null;        // null when binder user got deleted
  boundAt: number;
  chatName: string;
  archiveChannelId?: string;
  lastSummaryTs?: number;
  lastSummaryAt?: number;
  /**
   * When true (default), router entries created in `channelId` are pushed to
   * this Lark chat as cards. Toggleable via `@bot push on/off` or web UI.
   */
  pushEnabled?: boolean;
  /**
   * Watch feature: when true (default), bot evaluates chat for actionable
   * signals on each message + cooldown gate; posts a card only when truly
   * worth surfacing. Toggleable via `@bot /watch on/off`.
   */
  watchEnabled?: boolean;
  /** Counter incremented per non-bot message, reset after each evaluation. */
  watchMsgCount?: number;
  /** Last evaluation timestamp (ms). Used for the 1h cooldown. */
  watchLastRanAt?: number;
  /** Last card-posted timestamp (ms). Used for the 6h post-throttle. */
  watchLastPostedAt?: number;
  /**
   * Summary writing style for /summarize output.
   *   - 'person' (default): person-leading updates ("@hx 分享 X / Y")
   *   - 'topic':            topic-leading updates ("X — @hx")
   */
  summaryStyle?: 'person' | 'topic' | 'free';
}

export interface LarkWatchObservation {
  id: number;
  chatId: string;
  ranAt: number;
  observations: { kind: string; content: string; suggested_action?: string }[];
}

/**
 * Periodic auto-summary preferences (per chat). Cron loop scans these and
 * fires when due, regardless of whether the chat is bound to a channel.
 *
 * Cadence variants:
 *   - daily   → fire once per day at fire_hour (Asia/Shanghai)
 *   - weekly  → fire once per week, on weekday=1 (Mon ISO), at fire_hour
 *   - hourly  → fire every cadence_value hours (e.g., 6h, 12h)
 *
 * fire_hour is 0-23 (Asia/Shanghai). fire_minute always 0 (room to grow).
 *
 * setupByOpenId is the user who toggled it on; needed to recover teamId at
 * fire-time for unbound chats (their team becomes the entry's team).
 */
export interface LarkAutoSummaryPrefs {
  chatId: string;
  enabled: boolean;
  cadenceKind: 'daily' | 'weekly' | 'hourly';
  cadenceValue: number | null;   // hourly: N hours; otherwise null
  fireHour: number;              // 0-23 Asia/Shanghai
  setupByOpenId: string | null;
  lastRunAt: number | null;      // unix ms
  updatedAt: number;
}

export interface LarkMessageReaction {
  id: number;
  chatId: string;
  messageId: string;
  openId: string;
  emojiType: string;     // raw Lark emoji_type (e.g. 'THUMBSUP', 'EYES', 'DONE')
  action: 'added' | 'removed';
  reactedAt: number;     // unix ms
}

export interface LarkCardAction {
  id: number;
  entryId: string;
  chatId: string;
  openId: string;
  action: 'mark_read' | 'comment' | 'open';
  payload?: any;
  actedAt: number;
}

export interface TagPreset {
  id: string;
  name: string;
  tags: string[];
  createdAt: number;
}

export interface TeamMemory {
  teamId: string;                  // PK
  content: string;                 // current markdown
  previousContent: string | null;  // last saved version (one-step undo)
  updatedAt: number;               // ms epoch
  updatedByHandle: string | null;  // null = never edited (only template ever shown)
}

export interface Team {
  id: string;                  // Slug, e.g. "teleport"
  name: string;                // Display name, e.g. "Teleport"
  createdBy: string;           // Creator handle
  createdAt: number;
}

export interface TeamInvite {
  code: string;                // "tpr-abc123def456"
  teamId: string;              // Which team to join
  createdBy: string;           // Admin handle
  createdAt: number;
  expiresAt?: number;
  maxUses?: number;
  uses: number;
}

export interface SparkPairRoom {
  teamId: string;
  pairKey: string;
  sourceHandle: string;
  targetHandle: string;
  roomId: string;
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────
// Skill types
// ─────────────────────────────────────────────────────────────

export interface SkillParameter {
  name: string;
  type: 'string' | 'boolean' | 'number' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
  default?: any;
}

export type SkillTrigger =
  | { type: 'on_entry_write'; filter?: { tags?: string[]; authors?: string[] } }
  | { type: 'manual' }
  | { type: 'cron'; schedule: string };

export type SkillEffect =
  | { type: 'lark_webhook'; url: string; template?: 'card' | 'text' }
  | { type: 'http_post'; url: string; headers?: Record<string, string> };

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  parameters?: SkillParameter[];
  // 'prewrite'  — channel skill: injected into router_write, forces restructure before writing
  // 'context'   — webhook skill (server-side effects); hidden from tools/list
  // 'digest'    — periodic LLM summary of channel entries (weekly/monthly)
  // 'tool'      — (v1: hidden) named MCP tool; kept for backward compatibility
  // 'both'      — (v1: hidden) legacy
  exposeAs: 'tool' | 'context' | 'both' | 'prewrite' | 'digest';
  // Digest-specific config (only when exposeAs === 'digest')
  digestConfig?: {
    schedule: 'weekly' | 'monthly';     // weekly = 7 days, monthly = 30 days
    cronExpression?: string;            // e.g. "0 9 * * 1" (Mon 9am) — optional for cron
    lookbackDays?: number;              // override: 7 for weekly, 30 for monthly
    postToChannel?: boolean;            // write digest as an entry (default true)
    webhookUrl?: string;                // also push to Lark / HTTP (optional)
    lastRunAt?: number;                 // timestamp of last digest run
  };
  triggers?: SkillTrigger[];
  effects?: SkillEffect[];

  // Metadata (preserved community-sharing fields)
  public?: boolean;
  author?: string;
  clonedFrom?: string;
  cloneCount?: number;
  createdAt: number;
  updatedAt?: number;
}

// ─────────────────────────────────────────────────────────────
// Channel types
// ─────────────────────────────────────────────────────────────

export interface ChannelSubscriber {
  handle: string;
  role: 'admin' | 'member';
  joinedAt: number;
}

export interface Channel {
  id: string;                  // Slug, e.g. "feedling"
  teamId: string;              // Team namespace
  name: string;                // Display name
  description?: string;
  joinRule: 'open' | 'invite';
  createdBy: string;
  createdAt: number;
  skills: Skill[];
  subscribers: ChannelSubscriber[];
}

// B-plus replacement for Channel. Keyed by (teamId, tag); any tag in
// entries.tags[] can have a tag_configs row. Channel methods are kept as
// thin wrappers over tag_configs during transition. See
// docs/superpowers/specs/2026-05-15-tag-unification-design.md.
export interface TagConfig {
  teamId: string;
  tag: string;                // Slug, eg "feedling" — same identifier used in entries.tags[]
  name?: string;               // Display name; defaults to `tag` when missing
  description?: string;
  createdBy?: string;
  createdAt?: number;
  subscribers: ChannelSubscriber[];
  skills: Skill[];
}

/** Convert a TagConfig into a legacy Channel object for backward-compat APIs. */
export function tagConfigToChannel(cfg: TagConfig): Channel {
  return {
    id: cfg.tag,
    teamId: cfg.teamId,
    name: cfg.name ?? cfg.tag,
    description: cfg.description,
    joinRule: 'open',
    createdBy: cfg.createdBy ?? '',
    createdAt: cfg.createdAt ?? 0,
    skills: cfg.skills ?? [],
    subscribers: cfg.subscribers ?? [],
  };
}

/** Convert a Channel (eg from a legacy createChannel() call) into a TagConfig. */
export function channelToTagConfig(channel: Channel): TagConfig {
  return {
    teamId: channel.teamId,
    tag: channel.id,
    name: channel.name,
    description: channel.description,
    createdBy: channel.createdBy,
    createdAt: channel.createdAt,
    subscribers: channel.subscribers ?? [],
    skills: channel.skills ?? [],
  };
}

export interface ChannelInvite {
  token: string;
  channelId: string;
  createdBy: string;
  createdAt: number;
  expiresAt?: number;
  maxUses?: number;
  uses: number;
}

/** Validate channel ID: lowercase alphanumeric + hyphens, 2-30 chars */
export function isValidChannelId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$/.test(id);
}

/** Validate team ID: same rules as channel ID */
export function isValidTeamId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$/.test(id);
}

/** Normalize team name to slug */
export function teamNameToId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ─────────────────────────────────────────────────────────────
// Search utilities
// ─────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
  'she', 'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where',
  'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'about', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'any', 'also', 'being', 'their',
  'them', 'him', 'her', 'our', 'your', 'out', 'up', 'down', 'off', 'over',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter(word => word.length > 2)
    .filter(word => !STOP_WORDS.has(word))
    .filter((word, index, arr) => arr.indexOf(word) === index);
}

// ─────────────────────────────────────────────────────────────
// Pagination utilities
// ─────────────────────────────────────────────────────────────

interface PageCursor {
  t: number;
  id: string;
}

function decodePageCursorInternal(cursor?: string): PageCursor | null {
  if (!cursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as PageCursor;
    if (typeof decoded?.t !== 'number' || typeof decoded?.id !== 'string' || !Number.isFinite(decoded.t) || decoded.id.length === 0) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function encodePageCursor(item: { timestamp: number; id: string }): string {
  return Buffer.from(JSON.stringify({ t: item.timestamp, id: item.id }), 'utf8').toString('base64url');
}

function compareByFeedOrder(a: { timestamp: number; id: string }, b: { timestamp: number; id: string }): number {
  if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
  return b.id.localeCompare(a.id);
}

function normalizeSparkHandle(handle: string): string {
  return handle.replace(/^@/, '').trim().toLowerCase();
}

export function getSparkPairKey(handleA: string, handleB: string): string {
  return [normalizeSparkHandle(handleA), normalizeSparkHandle(handleB)].sort().join(':');
}

/** Generate a unique entry ID */
export function generateEntryId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

/** Generate a team invite code */
export function generateInviteCode(): string {
  return `tpr-${randomBytes(6).toString('hex')}`;
}

// ─────────────────────────────────────────────────────────────
// Web session (cookie-based auth)
// ─────────────────────────────────────────────────────────────

export interface Session {
  token: string;
  handle: string;
  createdAt: number;
  expiresAt: number;
  userAgent?: string;
}

export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─────────────────────────────────────────────────────────────
// Lark binding fields (used by bindLarkAccount)
// ─────────────────────────────────────────────────────────────

export interface LarkBindingFields {
  larkOpenId: string;
  larkUnionId?: string;
  larkName?: string;
  larkAvatarUrl?: string;
  larkRefreshToken: string;
  larkRefreshTokenExpiresAt: number;
  larkScopes: string[];
  larkBoundAt: number;
}

// ─────────────────────────────────────────────────────────────
// Storage Interface
// ─────────────────────────────────────────────────────────────

export interface Storage {
  // Entry methods (all scoped by teamId)
  addEntry(entry: Omit<RouterEntry, 'id'>, stagingDelayMs?: number): Promise<RouterEntry>;
  getEntry(id: string): Promise<RouterEntry | null>;
  getEntries(teamId: string, limit?: number, offset?: number, cursor?: string): Promise<RouterEntry[]>;
  getEntriesByHandle(teamId: string, handle: string, limit?: number, since?: number): Promise<RouterEntry[]>;
  searchEntries(teamId: string, query: string, limit?: number, since?: number): Promise<RouterEntry[]>;
  getEntriesByTags(teamId: string, tags: string[], limit?: number, offset?: number): Promise<RouterEntry[]>;
  getEntriesSince(teamId: string, since: number, limit?: number): Promise<RouterEntry[]>;
  getEntryCount(teamId?: string): Promise<number>;
  deleteEntry(id: string): Promise<void>;
  updateEntryTags(id: string, tags: string[]): Promise<RouterEntry | null>;
  updateEntry(id: string, updates: Partial<Pick<RouterEntry, 'summary' | 'content' | 'tags' | 'role' | 'hidden' | 'channel' | 'to' | 'translations' | 'webhookFired' | 'publishAt' | 'matrixMirrorRoomId' | 'matrixMirrorEventId' | 'matrixMirroredAt'>>): Promise<RouterEntry | null>;
  getTagStats(teamId: string): Promise<Array<{ tag: string; count: number }>>;
  getEntriesAddressedTo(teamId: string, handle: string, limit?: number): Promise<RouterEntry[]>;
  getRepliesTo(entryId: string, limit?: number): Promise<RouterEntry[]>;
  addComment(entryId: string, comment: Comment): Promise<RouterEntry | null>;
  deleteComment(entryId: string, commentId: string): Promise<RouterEntry | null>;
  updateComment(entryId: string, commentId: string, updates: Partial<Pick<Comment, 'translations'>>): Promise<Comment | null>;
  // All entries whose publishAt is set and in the future. Used by
  // StagedStorage to rehydrate its pending index on startup.
  getPendingEntries(): Promise<RouterEntry[]>;

  // Notification methods
  addNotification(notification: Notification): Promise<Notification>;
  getNotifications(handle: string, limit?: number): Promise<Notification[]>;
  getUnreadCount(handle: string): Promise<number>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(handle: string): Promise<void>;

  getChannelEntries(teamId: string, channelId: string, limit?: number): Promise<RouterEntry[]>;

  // User methods
  createUser(user: Omit<RouterUser, 'createdAt'>): Promise<RouterUser>;
  getUser(handle: string): Promise<RouterUser | null>;
  getUserByKeyHash(keyHash: string): Promise<RouterUser | null>;
  updateUser(handle: string, updates: Partial<Omit<RouterUser, 'handle' | 'secretKeyHash' | 'createdAt'>>): Promise<RouterUser | null>;
  updateUserPreferences(handle: string, prefs: { syncMode?: 'active' | 'passive'; previewMode?: 'always' | 'never'; privacyStripCustom?: string[] }): Promise<void>;
  isHandleAvailable(handle: string): Promise<boolean>;
  searchUsers(prefix: string, limit?: number): Promise<RouterUser[]>;
  deleteUser(handle: string): Promise<void>;
  getUserCount(): Promise<number>;
  getAllUsers(teamId?: string): Promise<RouterUser[]>;

  // ── Lark binding methods ──
  getUserByLarkOpenId(openId: string): Promise<RouterUser | null>;
  bindLarkAccount(handle: string, fields: LarkBindingFields): Promise<RouterUser | null>;
  unbindLarkAccount(handle: string): Promise<RouterUser | null>;
  getUserByMatrixUserId(matrixUserId: string): Promise<RouterUser | null>;
  bindMatrixAccount(handle: string, matrixUserId: string, boundAt?: number): Promise<RouterUser | null>;
  rotateSecretKey(handle: string, graceMs?: number): Promise<{ newKey: string; user: RouterUser } | null>;
  generateAdditionalKeyForUser(handle: string): Promise<string>;

  // Spark pair rooms (Matrix introduction rooms), scoped by team
  getSparkPairRoom(teamId: string, handleA: string, handleB: string): Promise<SparkPairRoom | null>;
  setSparkPairRoom(teamId: string, handleA: string, handleB: string, roomId: string, now?: number): Promise<SparkPairRoom>;

  // Team methods
  createTeam(team: Team): Promise<Team>;
  getTeam(id: string): Promise<Team | null>;
  isTeamIdAvailable(id: string): Promise<boolean>;

  // Team Memory methods (one row per team; admin-edited markdown shown to CC at startup)
  getTeamMemory(teamId: string): Promise<TeamMemory | null>;
  upsertTeamMemory(teamId: string, content: string, byHandle: string): Promise<TeamMemory>;
  rollbackTeamMemory(teamId: string, byHandle: string): Promise<TeamMemory | null>;

  // Team invite methods
  createTeamInvite(invite: TeamInvite): Promise<TeamInvite>;
  getTeamInvite(code: string): Promise<TeamInvite | null>;
  useTeamInvite(code: string): Promise<TeamInvite>;
  listTeamInvites(teamId: string): Promise<TeamInvite[]>;

  // Channel methods (scoped by teamId)
  //
  // Channels are deprecated: these now act as thin wrappers over tag_configs.
  // Old callers keep the same signatures, but reads/writes hit tag_configs
  // exclusively. Channels table is frozen and slated for removal in Phase 2.
  createChannel(channel: Channel): Promise<Channel>;
  getChannel(id: string): Promise<Channel | null>;
  updateChannel(id: string, updates: Partial<Omit<Channel, 'id' | 'createdBy' | 'createdAt' | 'teamId'>>): Promise<Channel | null>;
  deleteChannel(id: string): Promise<void>;
  listChannels(teamId: string, opts?: { handle?: string }): Promise<Channel[]>;
  addSubscriber(channelId: string, handle: string, role: 'admin' | 'member'): Promise<void>;
  removeSubscriber(channelId: string, handle: string): Promise<void>;
  getSubscribedChannels(handle: string): Promise<Channel[]>;
  createInvite(invite: ChannelInvite): Promise<ChannelInvite>;
  getInvite(token: string): Promise<ChannelInvite | null>;
  useInvite(token: string): Promise<Channel>;

  // Tag configs (B-plus successor to channels — keyed by team-scoped tag name).
  // Any tag in entries.tags[] can have a tag_configs row attached; the row
  // declares subscribers and skills (effects, webhooks, mcp tools). When absent,
  // the tag is a plain tag.
  getTagConfig(teamId: string, tag: string): Promise<TagConfig | null>;
  listTagConfigs(teamId: string, opts?: { handle?: string }): Promise<TagConfig[]>;
  upsertTagConfig(teamId: string, tag: string, fields: Partial<Omit<TagConfig, 'teamId' | 'tag' | 'createdAt'>>): Promise<TagConfig>;
  addTagSubscriber(teamId: string, tag: string, handle: string, role?: 'admin' | 'member'): Promise<TagConfig>;
  removeTagSubscriber(teamId: string, tag: string, handle: string): Promise<TagConfig | null>;
  getEntriesByTag(teamId: string, tag: string, limit?: number): Promise<RouterEntry[]>;
  getSubscribedTags(handle: string): Promise<TagConfig[]>;

  // Preset tag methods
  getPresetTags(): Promise<PresetTag[]>;
  addPresetTag(tag: PresetTag): Promise<PresetTag>;
  updatePresetTag(name: string, description: string): Promise<PresetTag | null>;
  deletePresetTag(name: string): Promise<boolean>;

  // ── Session methods (cookie-based web auth) ──
  // createSession: creates new session for handle, returns the token
  // getSession: looks up by token; returns null when missing/expired (and lazy-deletes if expired)
  // touchSession: refreshes expires_at; called on each authenticated request for sliding expiry
  // deleteSession: revokes (logout)
  createSession(handle: string, ttlMs?: number, userAgent?: string): Promise<{ token: string; expiresAt: number }>;
  getSession(token: string): Promise<Session | null>;
  touchSession(token: string, ttlMs?: number): Promise<void>;
  deleteSession(token: string): Promise<void>;

  // ── Lark Phase 1 ──
  createLarkChatBinding(b: Omit<LarkChatBinding, 'lastSummaryTs' | 'lastSummaryAt'>): Promise<LarkChatBinding>;
  getLarkChatBinding(chatId: string): Promise<LarkChatBinding | null>;
  listLarkChatBindingsByChannel(channelId: string): Promise<LarkChatBinding[]>;
  listLarkChatBindingsByTeam(teamId: string): Promise<LarkChatBinding[]>;
  deleteLarkChatBinding(chatId: string): Promise<void>;
  updateLarkLastSummary(chatId: string, lastSummaryTs: number, lastSummaryAt: number): Promise<void>;
  updateLarkBindingArchive(chatId: string, archiveChannelId: string | null): Promise<void>;
  updateLarkBindingPushEnabled(chatId: string, pushEnabled: boolean): Promise<void>;
  /** @deprecated kept for backward-compat; prefer get/setLarkChatStyle which works on unbound chats */
  updateLarkBindingSummaryStyle(chatId: string, style: 'person' | 'topic' | 'free'): Promise<void>;

  // ── Per-chat preferences (independent of binding) ──
  /** Returns the chat's saved style, or null if never set. */
  getLarkChatStyle(chatId: string): Promise<'person' | 'topic' | 'free' | null>;
  /** Upserts the chat's style — works on bound or unbound chats. */
  setLarkChatStyle(chatId: string, style: 'person' | 'topic' | 'free'): Promise<void>;

  // ── Watch (M3a): on-message-triggered LLM eval, posts only when worth it ──
  updateLarkBindingWatchEnabled(chatId: string, enabled: boolean): Promise<void>;
  incrementLarkWatchMsgCount(chatId: string): Promise<void>;
  /** Reset counter + bump last-ran timestamp atomically. */
  recordLarkWatchRan(chatId: string, ranAt: number): Promise<void>;
  /** Bump last-posted timestamp (after a card actually posts). */
  recordLarkWatchPosted(chatId: string, postedAt: number): Promise<void>;
  /** Append observations from a watch run; LLM uses last few as memory. */
  recordLarkWatchObservations(chatId: string, ranAt: number, observations: LarkWatchObservation['observations']): Promise<void>;
  /** Most-recent observations for memory context (typically last 3, oldest-first). */
  listLarkWatchObservationsRecent(chatId: string, limit: number): Promise<LarkWatchObservation[]>;
  /** Drop watch observations older than `cutoffMs` (unix ms); returns rows deleted. */
  deleteLarkWatchObservationsBefore(cutoffMs: number): Promise<number>;

  // ── Periodic auto-summary (M3b): clock-driven scheduled summarize ──
  /** Get auto-summary prefs for a chat; null if never configured. */
  getLarkAutoSummary(chatId: string): Promise<LarkAutoSummaryPrefs | null>;
  /** Upsert prefs (works on bound or unbound chats). */
  setLarkAutoSummary(chatId: string, prefs: Omit<LarkAutoSummaryPrefs, 'chatId' | 'updatedAt' | 'lastRunAt'>): Promise<void>;
  /** Bump last_run_at. */
  recordLarkAutoSummaryRan(chatId: string, ranAt: number): Promise<void>;
  /** All enabled rows; cron filters by isDue() in app code. */
  listLarkAutoSummaryEnabled(): Promise<LarkAutoSummaryPrefs[]>;

  // ── Native Lark reactions on bot messages ──
  recordLarkMessageReaction(r: Omit<LarkMessageReaction, 'id'>): Promise<void>;
  listLarkMessageReactionsByMessage(messageId: string): Promise<LarkMessageReaction[]>;

  // ── Lark message ↔ router entry mapping ──
  /** Called when bot posts/patches a card that represents an entry. */
  recordLarkEntryMessage(messageId: string, entryId: string, chatId: string, postedAt: number): Promise<void>;
  /**
   * Aggregate net reactions for an entry across all bot-sent messages that
   * represent it. "Net" = each (open_id, emoji_type) counted once based on
   * the last action (added or removed); only `added` contributes.
   */
  getEntryReactionSummary(entryId: string): Promise<Array<{ emojiType: string; count: number }>>;

  recordLarkCardAction(a: Omit<LarkCardAction, 'id'>): Promise<LarkCardAction>;
  listLarkCardActionsByEntry(entryId: string): Promise<LarkCardAction[]>;
}

// ─────────────────────────────────────────────────────────────
// In-Memory Storage (development / testing)
// ─────────────────────────────────────────────────────────────

export class MemoryStorage implements Storage {
  protected entries: RouterEntry[] = [];
  protected users: Map<string, RouterUser> = new Map();
  protected teams: Map<string, Team> = new Map();
  protected teamMemories = new Map<string, TeamMemory>();
  protected teamInvites: Map<string, TeamInvite> = new Map();
  // Primary store for both legacy `Channel` access and the new `TagConfig`
  // API. Keyed by `${teamId}:${tag}`. Channel methods are thin wrappers that
  // convert TagConfig ↔ Channel via tagConfigToChannel/channelToTagConfig.
  protected tagConfigs: Map<string, TagConfig> = new Map();
  protected channelInvites: Map<string, ChannelInvite> = new Map();
  private presetTags = new Map<string, PresetTag>();
  protected sessions = new Map<string, Session>();
  protected larkBindings = new Map<string, LarkChatBinding>();
  protected larkCardActions: LarkCardAction[] = [];
  protected larkWatchObservations: LarkWatchObservation[] = [];
  protected larkWatchObservationSeq = 1;
  protected larkChatPrefs = new Map<string, { summaryStyle: 'person' | 'topic' | 'free'; updatedAt: number }>();
  protected larkAutoSummary = new Map<string, LarkAutoSummaryPrefs>();
  protected larkMessageReactions: LarkMessageReaction[] = [];
  protected larkMessageReactionSeq = 1;
  protected larkEntryMessages = new Map<string, { entryId: string; chatId: string; postedAt: number }>();
  protected larkCardActionSeq = 1;
  protected sparkPairRooms = new Map<string, SparkPairRoom>();
  protected nextId = 1;

  // ── Entry methods ──

  async addEntry(entry: Omit<RouterEntry, 'id'>): Promise<RouterEntry> {
    const newEntry: RouterEntry = {
      ...entry,
      id: generateEntryId(),
      keywords: tokenize([entry.content, entry.summary, ...entry.tags].join(' ')),
    };
    this.entries.unshift(newEntry);
    return newEntry;
  }

  async getEntry(id: string): Promise<RouterEntry | null> {
    return this.entries.find(e => e.id === id) || null;
  }

  async getEntries(teamId: string, limit = 50, offset = 0, cursor?: string): Promise<RouterEntry[]> {
    const teamEntries = this.entries.filter(e => e.teamId === teamId);
    const parsedCursor = decodePageCursorInternal(cursor);
    if (parsedCursor) {
      return teamEntries
        .slice()
        .sort(compareByFeedOrder)
        .filter(e => compareByFeedOrder(e, { timestamp: parsedCursor.t, id: parsedCursor.id }) > 0)
        .slice(0, limit);
    }
    return teamEntries.slice(offset, offset + limit);
  }

  async getEntriesByHandle(teamId: string, handle: string, limit = 50, since?: number): Promise<RouterEntry[]> {
    return this.entries
      .filter(e => e.teamId === teamId && e.handle === handle && (!since || e.timestamp >= since))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async searchEntries(teamId: string, query: string, limit = 50, since?: number): Promise<RouterEntry[]> {
    const queryKeywords = tokenize(query);
    if (queryKeywords.length === 0) return [];

    return this.entries
      .filter(e => {
        if (e.teamId !== teamId) return false;
        if (since && e.timestamp < since) return false;
        const entryKeywords = e.keywords || tokenize([e.content, e.summary, ...e.tags].join(' '));
        return queryKeywords.some(qk => entryKeywords.includes(qk));
      })
      .slice(0, limit);
  }

  async getEntriesByTags(teamId: string, tags: string[], limit?: number, offset = 0): Promise<RouterEntry[]> {
    const sorted = this.entries
      .filter(e => e.teamId === teamId && tags.every(tag => e.tags.includes(tag)))
      .sort((a, b) => b.timestamp - a.timestamp);
    return limit != null ? sorted.slice(offset, offset + limit) : sorted.slice(offset);
  }

  async getEntriesSince(teamId: string, since: number, limit = 50): Promise<RouterEntry[]> {
    return this.entries
      .filter(e => e.teamId === teamId && e.timestamp >= since)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async getEntryCount(teamId?: string): Promise<number> {
    if (teamId) return this.entries.filter(e => e.teamId === teamId).length;
    return this.entries.length;
  }

  async deleteEntry(id: string): Promise<void> {
    this.entries = this.entries.filter(e => e.id !== id);
  }

  async updateEntryTags(id: string, tags: string[]): Promise<RouterEntry | null> {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return null;
    entry.tags = tags;
    entry.keywords = tokenize([entry.content, entry.summary, ...tags].join(' '));
    return entry;
  }

  async updateEntry(id: string, updates: Partial<Pick<RouterEntry, 'summary' | 'content' | 'tags' | 'role' | 'hidden' | 'channel' | 'to' | 'translations' | 'webhookFired' | 'publishAt' | 'matrixMirrorRoomId' | 'matrixMirrorEventId' | 'matrixMirroredAt'>>): Promise<RouterEntry | null> {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return null;
    if (updates.summary !== undefined) entry.summary = updates.summary;
    if (updates.content !== undefined) entry.content = updates.content;
    if (updates.tags !== undefined) entry.tags = updates.tags;
    if (updates.role !== undefined) entry.role = updates.role;
    if (updates.hidden !== undefined) entry.hidden = updates.hidden;
    if (updates.channel !== undefined) entry.channel = updates.channel || undefined;
    if (updates.to !== undefined) entry.to = updates.to;
    if (updates.translations !== undefined) entry.translations = updates.translations || undefined;
    if (updates.webhookFired !== undefined) entry.webhookFired = updates.webhookFired;
    if (updates.publishAt !== undefined) entry.publishAt = updates.publishAt ?? undefined;
    if (updates.matrixMirrorRoomId !== undefined) entry.matrixMirrorRoomId = updates.matrixMirrorRoomId || undefined;
    if (updates.matrixMirrorEventId !== undefined) entry.matrixMirrorEventId = updates.matrixMirrorEventId || undefined;
    if (updates.matrixMirroredAt !== undefined) entry.matrixMirroredAt = updates.matrixMirroredAt ?? undefined;
    entry.keywords = tokenize([entry.content, entry.summary, ...entry.tags].join(' '));
    return entry;
  }

  async getPendingEntries(): Promise<RouterEntry[]> {
    // Includes past-due (publishAt <= now) rows — those represent drafts the
    // server died before publishing. Callers (StagedStorage) decide when to
    // flip them to published.
    return this.entries.filter(e => e.publishAt !== undefined && e.publishAt !== null);
  }

  async getTagStats(teamId: string): Promise<Array<{ tag: string; count: number }>> {
    const counts = new Map<string, number>();
    for (const entry of this.entries) {
      if (entry.teamId !== teamId) continue;
      for (const tag of entry.tags) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  async getEntriesAddressedTo(teamId: string, handle: string, limit = 50): Promise<RouterEntry[]> {
    const handlePattern = `@${handle}`;
    return this.entries
      .filter(e => {
        if (e.teamId !== teamId) return false;
        if (!e.to || e.to.length === 0) return false;
        return e.to.some(dest => dest === handlePattern || dest === handle);
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async getRepliesTo(entryId: string, limit = 50): Promise<RouterEntry[]> {
    return this.entries
      .filter(e => e.inReplyTo === entryId)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, limit);
  }

  async addComment(entryId: string, comment: Comment): Promise<RouterEntry | null> {
    const entry = this.entries.find(e => e.id === entryId);
    if (!entry) return null;
    if (!entry.comments) entry.comments = [];
    entry.comments.push(comment);
    return entry;
  }

  async deleteComment(entryId: string, commentId: string): Promise<RouterEntry | null> {
    const entry = this.entries.find(e => e.id === entryId);
    if (!entry || !entry.comments) return null;
    entry.comments = entry.comments.filter(c => c.id !== commentId);
    return entry;
  }

  async updateComment(entryId: string, commentId: string, updates: Partial<Pick<Comment, 'translations'>>): Promise<Comment | null> {
    const entry = this.entries.find(e => e.id === entryId);
    const comment = entry?.comments?.find(c => c.id === commentId);
    if (!comment) return null;
    if (updates.translations !== undefined) comment.translations = updates.translations;
    return comment;
  }

  // ── Notification methods ──

  protected notifications: Notification[] = [];

  async addNotification(notification: Notification): Promise<Notification> {
    this.notifications.unshift(notification);
    return notification;
  }

  async getNotifications(handle: string, limit = 50): Promise<Notification[]> {
    return this.notifications.filter(n => n.recipientHandle === handle).slice(0, limit);
  }

  async getUnreadCount(handle: string): Promise<number> {
    return this.notifications.filter(n => n.recipientHandle === handle && !n.read).length;
  }

  async markNotificationRead(id: string): Promise<void> {
    const n = this.notifications.find(n => n.id === id);
    if (n) n.read = true;
  }

  async markAllNotificationsRead(handle: string): Promise<void> {
    this.notifications.filter(n => n.recipientHandle === handle).forEach(n => n.read = true);
  }

  async getChannelEntries(teamId: string, channelId: string, limit = 50): Promise<RouterEntry[]> {
    const channelDest = `#${channelId}`;
    return this.entries
      .filter(e => e.teamId === teamId && (e.channel === channelId || (e.to && e.to.includes(channelDest))))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // ── User methods ──

  async createUser(user: Omit<RouterUser, 'createdAt'>): Promise<RouterUser> {
    const newUser: RouterUser = { ...user, createdAt: Date.now() };
    this.users.set(user.handle, newUser);
    return newUser;
  }

  async getUser(handle: string): Promise<RouterUser | null> {
    return this.users.get(handle) || null;
  }

  async getUserByKeyHash(keyHash: string): Promise<RouterUser | null> {
    // Primary: current secret_key_hash
    for (const user of this.users.values()) {
      if (user.secretKeyHash === keyHash) return user;
    }
    // Fallback: previous_secret_key_hash within 7-day grace window
    const now = Date.now();
    for (const user of this.users.values()) {
      if (
        user.previousSecretKeyHash === keyHash &&
        user.previousSecretKeyExpiresAt &&
        user.previousSecretKeyExpiresAt > now
      ) {
        return user;
      }
    }
    return null;
  }

  async updateUser(handle: string, updates: Partial<Omit<RouterUser, 'handle' | 'secretKeyHash' | 'createdAt'>>): Promise<RouterUser | null> {
    const user = this.users.get(handle);
    if (!user) return null;
    const updated = { ...user, ...updates };
    this.users.set(handle, updated);
    return updated;
  }

  async updateUserPreferences(handle: string, prefs: { syncMode?: 'active' | 'passive'; previewMode?: 'always' | 'never'; privacyStripCustom?: string[] }): Promise<void> {
    const user = this.users.get(handle);
    if (!user) return;
    if (prefs.syncMode !== undefined) user.syncMode = prefs.syncMode;
    if (prefs.previewMode !== undefined) user.previewMode = prefs.previewMode;
    if (prefs.privacyStripCustom !== undefined) user.privacyStripCustom = prefs.privacyStripCustom;
  }

  async isHandleAvailable(handle: string): Promise<boolean> {
    return !this.users.has(handle);
  }

  async searchUsers(prefix: string, limit = 10): Promise<RouterUser[]> {
    const lowerPrefix = prefix.toLowerCase();
    return Array.from(this.users.values())
      .filter(u => u.handle.toLowerCase().startsWith(lowerPrefix))
      .slice(0, limit);
  }

  async deleteUser(handle: string): Promise<void> {
    // Anonymize-on-delete (P1 fix). See PostgresStorage.deleteUser comment.
    const placeholder = generateDeletedHandle();

    // Scalar entry author + comment authors
    for (const e of this.entries) {
      if (e.handle === handle) e.handle = placeholder;
      if (e.to) {
        e.to = e.to.map(t => (t === `@${handle}` ? `@${placeholder}` : t));
      }
      if (e.comments) {
        for (const c of e.comments) {
          if (c.handle === handle) c.handle = placeholder;
        }
      }
    }

    // Notifications (recipient + sender) — flat array, filter-and-mutate in place
    for (const n of this.notifications) {
      if (n.recipientHandle === handle) n.recipientHandle = placeholder;
      if (n.fromHandle === handle) n.fromHandle = placeholder;
    }

    // Other users' follow lists
    for (const u of this.users.values()) {
      if (!u.following) continue;
      u.following = u.following.map(f =>
        f.handle === handle ? { ...f, handle: placeholder } : f,
      );
    }

    this.users.delete(handle);
  }

  async getUserCount(): Promise<number> {
    return this.users.size;
  }

  async getAllUsers(teamId?: string): Promise<RouterUser[]> {
    const users = Array.from(this.users.values());
    if (teamId) return users.filter(u => u.teamId === teamId);
    return users;
  }

  // ── Lark binding ──

  async getUserByLarkOpenId(openId: string): Promise<RouterUser | null> {
    for (const u of this.users.values()) {
      if (u.larkOpenId === openId) return { ...u };
    }
    return null;
  }

  async bindLarkAccount(handle: string, fields: LarkBindingFields): Promise<RouterUser | null> {
    const user = this.users.get(handle);
    if (!user) return null;
    // Reject if open_id is held by ANOTHER user
    for (const [h, u] of this.users) {
      if (h !== handle && u.larkOpenId === fields.larkOpenId) return null;
    }
    Object.assign(user, fields);
    return { ...user };
  }

  async unbindLarkAccount(handle: string): Promise<RouterUser | null> {
    const user = this.users.get(handle);
    if (!user) return null;
    delete user.larkOpenId;
    delete user.larkUnionId;
    delete user.larkName;
    delete user.larkAvatarUrl;
    delete user.larkRefreshToken;
    delete user.larkRefreshTokenExpiresAt;
    delete user.larkScopes;
    delete user.larkBoundAt;
    return { ...user };
  }

  async getUserByMatrixUserId(matrixUserId: string): Promise<RouterUser | null> {
    for (const u of this.users.values()) {
      if (u.matrixUserId === matrixUserId) return { ...u };
    }
    return null;
  }

  async bindMatrixAccount(handle: string, matrixUserId: string, boundAt = Date.now()): Promise<RouterUser | null> {
    const user = this.users.get(handle);
    if (!user) return null;
    for (const [h, u] of this.users) {
      if (h !== handle && u.matrixUserId === matrixUserId) return null;
    }
    user.matrixUserId = matrixUserId;
    user.matrixBoundAt = boundAt;
    return { ...user };
  }

  async getSparkPairRoom(teamId: string, handleA: string, handleB: string): Promise<SparkPairRoom | null> {
    return this.sparkPairRooms.get(`${teamId}:${getSparkPairKey(handleA, handleB)}`) || null;
  }

  async setSparkPairRoom(teamId: string, handleA: string, handleB: string, roomId: string, now = Date.now()): Promise<SparkPairRoom> {
    const pairKey = getSparkPairKey(handleA, handleB);
    const existing = this.sparkPairRooms.get(`${teamId}:${pairKey}`);
    const record: SparkPairRoom = {
      teamId,
      pairKey,
      sourceHandle: normalizeSparkHandle(handleA),
      targetHandle: normalizeSparkHandle(handleB),
      roomId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.sparkPairRooms.set(`${teamId}:${pairKey}`, record);
    return { ...record };
  }

  async rotateSecretKey(handle: string, graceMs = 7 * 86400 * 1000): Promise<{ newKey: string; user: RouterUser } | null> {
    const user = this.users.get(handle);
    if (!user) return null;
    const newKey = generateSecretKey();
    user.previousSecretKeyHash = user.secretKeyHash;
    user.previousSecretKeyExpiresAt = Date.now() + graceMs;
    user.secretKeyHash = hashSecretKey(newKey);
    return { newKey, user: { ...user } };
  }

  async generateAdditionalKeyForUser(handle: string): Promise<string> {
    const user = this.users.get(handle);
    if (!user) throw new Error('user not found');
    // v1 single-key model: rotate to a new key. Multi-key per user is v1.1.
    const key = generateSecretKey();
    user.secretKeyHash = hashSecretKey(key);
    return key;
  }

  // ── Team methods ──

  async createTeam(team: Team): Promise<Team> {
    if (this.teams.has(team.id)) {
      throw new Error(`Team "${team.id}" already exists.`);
    }
    this.teams.set(team.id, { ...team });
    return team;
  }

  async getTeam(id: string): Promise<Team | null> {
    return this.teams.get(id) || null;
  }

  async isTeamIdAvailable(id: string): Promise<boolean> {
    return !this.teams.has(id);
  }

  // ── Team Memory methods ──

  async getTeamMemory(teamId: string): Promise<TeamMemory | null> {
    return this.teamMemories.get(teamId) ?? null;
  }

  async upsertTeamMemory(teamId: string, content: string, byHandle: string): Promise<TeamMemory> {
    const existing = this.teamMemories.get(teamId);
    const next: TeamMemory = {
      teamId,
      content,
      previousContent: existing?.content ?? null,
      updatedAt: Date.now(),
      updatedByHandle: byHandle,
    };
    this.teamMemories.set(teamId, next);
    return next;
  }

  async rollbackTeamMemory(teamId: string, byHandle: string): Promise<TeamMemory | null> {
    const existing = this.teamMemories.get(teamId);
    if (!existing || existing.previousContent === null) return null;
    const next: TeamMemory = {
      teamId,
      content: existing.previousContent,
      previousContent: existing.content,   // swap so a second click toggles back
      updatedAt: Date.now(),
      updatedByHandle: byHandle,
    };
    this.teamMemories.set(teamId, next);
    return next;
  }

  // ── Team invite methods ──

  async createTeamInvite(invite: TeamInvite): Promise<TeamInvite> {
    this.teamInvites.set(invite.code, { ...invite });
    return invite;
  }

  async getTeamInvite(code: string): Promise<TeamInvite | null> {
    return this.teamInvites.get(code) || null;
  }

  async useTeamInvite(code: string): Promise<TeamInvite> {
    const invite = this.teamInvites.get(code);
    if (!invite) throw new Error('Invite not found.');
    if (invite.expiresAt && Date.now() > invite.expiresAt) {
      throw new Error('Invite has expired.');
    }
    if (invite.maxUses && invite.uses >= invite.maxUses) {
      throw new Error('Invite has reached maximum uses.');
    }
    invite.uses++;
    return invite;
  }

  async listTeamInvites(teamId: string): Promise<TeamInvite[]> {
    return Array.from(this.teamInvites.values()).filter(i => i.teamId === teamId);
  }

  // ── Tag config + legacy Channel methods ──
  //
  // All Channel methods are wrappers over tag_configs. The channels Map
  // no longer exists — single source of truth is `this.tagConfigs`.

  protected tagKey(teamId: string, tag: string): string {
    return `${teamId}:${tag}`;
  }

  /** Locate (teamId, tag) for a legacy channel id-only lookup. */
  private findTagConfigById(id: string): TagConfig | null {
    for (const cfg of this.tagConfigs.values()) {
      if (cfg.tag === id) return cfg;
    }
    return null;
  }

  async getTagConfig(teamId: string, tag: string): Promise<TagConfig | null> {
    return this.tagConfigs.get(this.tagKey(teamId, tag)) ?? null;
  }

  async listTagConfigs(teamId: string, opts?: { handle?: string }): Promise<TagConfig[]> {
    // Tag configs are team-public; `opts.handle` reserved but currently unused.
    void opts;
    return Array.from(this.tagConfigs.values()).filter(c => c.teamId === teamId);
  }

  async upsertTagConfig(
    teamId: string,
    tag: string,
    fields: Partial<Omit<TagConfig, 'teamId' | 'tag' | 'createdAt'>>,
  ): Promise<TagConfig> {
    const key = this.tagKey(teamId, tag);
    const existing = this.tagConfigs.get(key);
    const next: TagConfig = existing
      ? {
          ...existing,
          ...fields,
          subscribers: fields.subscribers ?? existing.subscribers,
          skills: fields.skills ?? existing.skills,
        }
      : {
          teamId,
          tag,
          name: fields.name,
          description: fields.description,
          createdBy: fields.createdBy,
          createdAt: Date.now(),
          subscribers: fields.subscribers ?? [],
          skills: fields.skills ?? [],
        };
    this.tagConfigs.set(key, next);
    return next;
  }

  async addTagSubscriber(
    teamId: string,
    tag: string,
    handle: string,
    role: 'admin' | 'member' = 'member',
  ): Promise<TagConfig> {
    const key = this.tagKey(teamId, tag);
    let cfg = this.tagConfigs.get(key);
    if (!cfg) {
      // B-plus: auto-create on first subscriber.
      cfg = {
        teamId, tag,
        createdAt: Date.now(),
        subscribers: [],
        skills: [],
      };
      this.tagConfigs.set(key, cfg);
    }
    if (!cfg.subscribers.some(s => s.handle === handle)) {
      cfg.subscribers.push({ handle, role, joinedAt: Date.now() });
    }
    return cfg;
  }

  async removeTagSubscriber(teamId: string, tag: string, handle: string): Promise<TagConfig | null> {
    const key = this.tagKey(teamId, tag);
    const cfg = this.tagConfigs.get(key);
    if (!cfg) return null;
    cfg.subscribers = cfg.subscribers.filter(s => s.handle !== handle);
    return cfg;
  }

  async getEntriesByTag(teamId: string, tag: string, limit = 50): Promise<RouterEntry[]> {
    // Union: entries with `tag` in tags[] OR entries whose legacy `channel`
    // value still equals the tag. Migration backfills channel into tags but
    // we union here for any in-flight rows that bypass the backfill.
    const channelDest = `#${tag}`;
    return this.entries
      .filter(e =>
        e.teamId === teamId &&
        (e.tags.includes(tag) || e.channel === tag || (e.to && e.to.includes(channelDest)))
      )
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async getSubscribedTags(handle: string): Promise<TagConfig[]> {
    const user = this.users.get(handle);
    if (!user) return [];
    return Array.from(this.tagConfigs.values()).filter(
      c => c.teamId === user.teamId && c.subscribers.some(s => s.handle === handle),
    );
  }

  // ── Legacy Channel API (wrappers over tag_configs) ──

  async createChannel(channel: Channel): Promise<Channel> {
    const key = this.tagKey(channel.teamId, channel.id);
    if (this.tagConfigs.has(key)) {
      throw new Error(`Channel "${channel.id}" already exists.`);
    }
    const cfg = channelToTagConfig(channel);
    this.tagConfigs.set(key, cfg);
    return tagConfigToChannel(cfg);
  }

  async getChannel(id: string): Promise<Channel | null> {
    const cfg = this.findTagConfigById(id);
    return cfg ? tagConfigToChannel(cfg) : null;
  }

  async updateChannel(
    id: string,
    updates: Partial<Omit<Channel, 'id' | 'createdBy' | 'createdAt' | 'teamId'>>,
  ): Promise<Channel | null> {
    const cfg = this.findTagConfigById(id);
    if (!cfg) return null;
    const updatedCfg = await this.upsertTagConfig(cfg.teamId, cfg.tag, {
      name: updates.name ?? cfg.name,
      description: updates.description ?? cfg.description,
      subscribers: updates.subscribers ?? cfg.subscribers,
      skills: updates.skills ?? cfg.skills,
    });
    return tagConfigToChannel(updatedCfg);
  }

  async deleteChannel(id: string): Promise<void> {
    const cfg = this.findTagConfigById(id);
    if (cfg) this.tagConfigs.delete(this.tagKey(cfg.teamId, cfg.tag));
    for (const [token, invite] of this.channelInvites) {
      if (invite.channelId === id) this.channelInvites.delete(token);
    }
  }

  async listChannels(teamId: string, opts?: { handle?: string }): Promise<Channel[]> {
    void opts;
    return (await this.listTagConfigs(teamId)).map(tagConfigToChannel);
  }

  async addSubscriber(channelId: string, handle: string, role: 'admin' | 'member'): Promise<void> {
    const cfg = this.findTagConfigById(channelId);
    if (!cfg) throw new Error(`Channel "${channelId}" not found.`);
    await this.addTagSubscriber(cfg.teamId, cfg.tag, handle, role);
  }

  async removeSubscriber(channelId: string, handle: string): Promise<void> {
    const cfg = this.findTagConfigById(channelId);
    if (!cfg) throw new Error(`Channel "${channelId}" not found.`);
    await this.removeTagSubscriber(cfg.teamId, cfg.tag, handle);
  }

  async getSubscribedChannels(handle: string): Promise<Channel[]> {
    // Channels are team-public; legacy callers expect every channel in the
    // user's team.
    const user = this.users.get(handle);
    if (!user) return [];
    return (await this.listTagConfigs(user.teamId)).map(tagConfigToChannel);
  }

  async createInvite(invite: ChannelInvite): Promise<ChannelInvite> {
    this.channelInvites.set(invite.token, { ...invite });
    return invite;
  }

  async getInvite(token: string): Promise<ChannelInvite | null> {
    return this.channelInvites.get(token) || null;
  }

  async useInvite(token: string): Promise<Channel> {
    const invite = this.channelInvites.get(token);
    if (!invite) throw new Error('Invite not found.');
    if (invite.expiresAt && Date.now() > invite.expiresAt) {
      throw new Error('Invite has expired.');
    }
    if (invite.maxUses && invite.uses >= invite.maxUses) {
      throw new Error('Invite has reached maximum uses.');
    }
    invite.uses++;
    const channel = await this.getChannel(invite.channelId);
    if (!channel) throw new Error(`Channel "${invite.channelId}" not found.`);
    return channel;
  }

  // ── Preset tag methods ──

  async getPresetTags(): Promise<PresetTag[]> {
    return Array.from(this.presetTags.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async addPresetTag(tag: PresetTag): Promise<PresetTag> {
    if (this.presetTags.has(tag.name)) throw new Error(`Preset tag "${tag.name}" already exists`);
    this.presetTags.set(tag.name, tag);
    return tag;
  }

  async updatePresetTag(name: string, description: string): Promise<PresetTag | null> {
    const existing = this.presetTags.get(name);
    if (!existing) return null;
    existing.description = description;
    return existing;
  }

  async deletePresetTag(name: string): Promise<boolean> {
    return this.presetTags.delete(name);
  }

  // ── Sessions ──

  async createSession(handle: string, ttlMs: number = DEFAULT_SESSION_TTL_MS, userAgent?: string): Promise<{ token: string; expiresAt: number }> {
    const token = generateSessionToken();
    const now = Date.now();
    const expiresAt = now + ttlMs;
    this.sessions.set(token, { token, handle, createdAt: now, expiresAt, userAgent });
    return { token, expiresAt };
  }

  async getSession(token: string): Promise<Session | null> {
    const s = this.sessions.get(token);
    if (!s) return null;
    if (s.expiresAt <= Date.now()) {
      // Lazy delete on expiry
      this.sessions.delete(token);
      return null;
    }
    return { ...s };
  }

  async touchSession(token: string, ttlMs: number = DEFAULT_SESSION_TTL_MS): Promise<void> {
    const s = this.sessions.get(token);
    if (!s) return;
    s.expiresAt = Date.now() + ttlMs;
  }

  async deleteSession(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  // ── Lark Phase 1 ──

  async createLarkChatBinding(b: Omit<LarkChatBinding, 'lastSummaryTs' | 'lastSummaryAt'>): Promise<LarkChatBinding> {
    if (this.larkBindings.has(b.chatId)) throw new Error(`Binding for chat ${b.chatId} already exists`);
    const full: LarkChatBinding = { ...b };
    this.larkBindings.set(b.chatId, full);
    return full;
  }
  async getLarkChatBinding(chatId: string): Promise<LarkChatBinding | null> {
    return this.larkBindings.get(chatId) ?? null;
  }
  async listLarkChatBindingsByChannel(channelId: string): Promise<LarkChatBinding[]> {
    return [...this.larkBindings.values()].filter(b => b.channelId === channelId);
  }
  async listLarkChatBindingsByTeam(teamId: string): Promise<LarkChatBinding[]> {
    return [...this.larkBindings.values()].filter(b => b.teamId === teamId);
  }
  async deleteLarkChatBinding(chatId: string): Promise<void> {
    this.larkBindings.delete(chatId);
  }
  async updateLarkLastSummary(chatId: string, lastSummaryTs: number, lastSummaryAt: number): Promise<void> {
    const b = this.larkBindings.get(chatId);
    if (!b) return;
    this.larkBindings.set(chatId, { ...b, lastSummaryTs, lastSummaryAt });
  }
  async updateLarkBindingArchive(chatId: string, archiveChannelId: string | null): Promise<void> {
    const b = this.larkBindings.get(chatId);
    if (!b) return;
    this.larkBindings.set(chatId, {
      ...b,
      archiveChannelId: archiveChannelId === null ? undefined : archiveChannelId,
    });
  }
  async updateLarkBindingPushEnabled(chatId: string, pushEnabled: boolean): Promise<void> {
    const b = this.larkBindings.get(chatId);
    if (!b) return;
    this.larkBindings.set(chatId, { ...b, pushEnabled });
  }

  async updateLarkBindingSummaryStyle(chatId: string, style: 'person' | 'topic' | 'free'): Promise<void> {
    const b = this.larkBindings.get(chatId);
    if (!b) return;
    this.larkBindings.set(chatId, { ...b, summaryStyle: style });
  }

  async getLarkChatStyle(chatId: string): Promise<'person' | 'topic' | 'free' | null> {
    return this.larkChatPrefs.get(chatId)?.summaryStyle ?? null;
  }

  async setLarkChatStyle(chatId: string, style: 'person' | 'topic' | 'free'): Promise<void> {
    this.larkChatPrefs.set(chatId, { summaryStyle: style, updatedAt: Date.now() });
  }

  async getLarkAutoSummary(chatId: string): Promise<LarkAutoSummaryPrefs | null> {
    return this.larkAutoSummary.get(chatId) ?? null;
  }

  async setLarkAutoSummary(
    chatId: string,
    prefs: Omit<LarkAutoSummaryPrefs, 'chatId' | 'updatedAt' | 'lastRunAt'>,
  ): Promise<void> {
    const existing = this.larkAutoSummary.get(chatId);
    this.larkAutoSummary.set(chatId, {
      chatId,
      enabled: prefs.enabled,
      cadenceKind: prefs.cadenceKind,
      cadenceValue: prefs.cadenceValue,
      fireHour: prefs.fireHour,
      setupByOpenId: prefs.setupByOpenId,
      lastRunAt: existing?.lastRunAt ?? null,
      updatedAt: Date.now(),
    });
  }

  async recordLarkAutoSummaryRan(chatId: string, ranAt: number): Promise<void> {
    const p = this.larkAutoSummary.get(chatId);
    if (!p) return;
    this.larkAutoSummary.set(chatId, { ...p, lastRunAt: ranAt });
  }

  async listLarkAutoSummaryEnabled(): Promise<LarkAutoSummaryPrefs[]> {
    return Array.from(this.larkAutoSummary.values()).filter(p => p.enabled);
  }

  async updateLarkBindingWatchEnabled(chatId: string, enabled: boolean): Promise<void> {
    const b = this.larkBindings.get(chatId);
    if (!b) return;
    this.larkBindings.set(chatId, { ...b, watchEnabled: enabled });
  }

  async incrementLarkWatchMsgCount(chatId: string): Promise<void> {
    const b = this.larkBindings.get(chatId);
    if (!b) return;
    this.larkBindings.set(chatId, { ...b, watchMsgCount: (b.watchMsgCount ?? 0) + 1 });
  }

  async recordLarkWatchRan(chatId: string, ranAt: number): Promise<void> {
    const b = this.larkBindings.get(chatId);
    if (!b) return;
    this.larkBindings.set(chatId, { ...b, watchLastRanAt: ranAt, watchMsgCount: 0 });
  }

  async recordLarkWatchPosted(chatId: string, postedAt: number): Promise<void> {
    const b = this.larkBindings.get(chatId);
    if (!b) return;
    this.larkBindings.set(chatId, { ...b, watchLastPostedAt: postedAt });
  }

  async recordLarkWatchObservations(chatId: string, ranAt: number, observations: LarkWatchObservation['observations']): Promise<void> {
    if (!observations.length) return;
    this.larkWatchObservations.push({
      id: this.larkWatchObservationSeq++,
      chatId, ranAt, observations,
    });
  }

  async listLarkWatchObservationsRecent(chatId: string, limit: number): Promise<LarkWatchObservation[]> {
    return this.larkWatchObservations
      .filter(o => o.chatId === chatId)
      .sort((a, b) => b.ranAt - a.ranAt)
      .slice(0, limit)
      .reverse();  // oldest-first for prompt readability
  }

  async deleteLarkWatchObservationsBefore(cutoffMs: number): Promise<number> {
    const before = this.larkWatchObservations.length;
    this.larkWatchObservations = this.larkWatchObservations.filter(o => o.ranAt >= cutoffMs);
    return before - this.larkWatchObservations.length;
  }

  async recordLarkMessageReaction(r: Omit<LarkMessageReaction, 'id'>): Promise<void> {
    this.larkMessageReactions.push({ ...r, id: this.larkMessageReactionSeq++ });
  }

  async listLarkMessageReactionsByMessage(messageId: string): Promise<LarkMessageReaction[]> {
    return this.larkMessageReactions.filter(r => r.messageId === messageId);
  }

  async recordLarkEntryMessage(messageId: string, entryId: string, chatId: string, postedAt: number): Promise<void> {
    this.larkEntryMessages.set(messageId, { entryId, chatId, postedAt });
  }

  async getEntryReactionSummary(entryId: string): Promise<Array<{ emojiType: string; count: number }>> {
    const messageIds = new Set<string>();
    for (const [mid, m] of this.larkEntryMessages) {
      if (m.entryId === entryId) messageIds.add(mid);
    }
    if (messageIds.size === 0) return [];
    // For each (open_id, emoji_type) pair, find the latest action across all
    // related messages. If 'added', count it; if 'removed', drop it.
    const latest = new Map<string, { emojiType: string; action: 'added' | 'removed'; reactedAt: number }>();
    for (const r of this.larkMessageReactions) {
      if (!messageIds.has(r.messageId)) continue;
      const key = `${r.openId}:${r.emojiType}`;
      const prev = latest.get(key);
      if (!prev || r.reactedAt > prev.reactedAt) {
        latest.set(key, { emojiType: r.emojiType, action: r.action, reactedAt: r.reactedAt });
      }
    }
    const counts = new Map<string, number>();
    for (const v of latest.values()) {
      if (v.action !== 'added') continue;
      counts.set(v.emojiType, (counts.get(v.emojiType) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([emojiType, count]) => ({ emojiType, count }))
      .sort((a, b) => b.count - a.count);
  }

  async recordLarkCardAction(a: Omit<LarkCardAction, 'id'>): Promise<LarkCardAction> {
    const full: LarkCardAction = { ...a, id: this.larkCardActionSeq++ };
    this.larkCardActions.push(full);
    return full;
  }
  async listLarkCardActionsByEntry(entryId: string): Promise<LarkCardAction[]> {
    return this.larkCardActions.filter(a => a.entryId === entryId);
  }
}

// ─────────────────────────────────────────────────────────────
// File Storage (MemoryStorage + auto-persist to JSON file)
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from 'fs';

interface FileStorageData {
  entries: RouterEntry[];
  users: [string, RouterUser][];
  teams: [string, Team][];
  teamInvites: [string, TeamInvite][];
  teamMemories?: [string, TeamMemory][];
  sparkPairRooms?: [string, SparkPairRoom][];
  /** @deprecated Phase-1 transition: read for migration only, not written. */
  channels?: [string, Channel][];
  tagConfigs?: [string, TagConfig][];
  channelInvites: [string, ChannelInvite][];
  notifications: Notification[];
  nextId: number;
}

export class FileStorage extends MemoryStorage {
  private filePath: string;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath = 'data.json') {
    super();
    this.filePath = filePath;
    this.load();
  }

  private load() {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const data: FileStorageData = JSON.parse(raw);
      this.entries = data.entries || [];
      this.users = new Map(data.users || []);
      this.teams = new Map(data.teams || []);
      this.teamInvites = new Map(data.teamInvites || []);
      this.teamMemories = new Map(data.teamMemories || []);
      this.sparkPairRooms = new Map(data.sparkPairRooms || []);
      // Prefer the new tagConfigs field; fall back to migrating legacy
      // `channels` for snapshots written by older builds.
      if (data.tagConfigs && data.tagConfigs.length > 0) {
        this.tagConfigs = new Map(data.tagConfigs);
      } else if (data.channels && data.channels.length > 0) {
        this.tagConfigs = new Map(
          data.channels.map(([, ch]) => [`${ch.teamId}:${ch.id}`, channelToTagConfig(ch)]),
        );
      } else {
        this.tagConfigs = new Map();
      }
      this.channelInvites = new Map(data.channelInvites || []);
      this.notifications = data.notifications || [];
      this.nextId = data.nextId || 1;

      // Migrate legacy skills (webhook_url → effects + triggers + exposeAs)
      let migrated = false;
      for (const cfg of this.tagConfigs.values()) {
        for (const skill of cfg.skills as any[]) {
          const isLegacy = skill.webhook_url !== undefined
            || skill.handlerType !== undefined
            || skill.exposeAs === undefined;
          if (!isLegacy) continue;

          if (skill.webhook_url && !skill.effects) {
            skill.effects = [{
              type: 'lark_webhook',
              url: skill.webhook_url,
              template: 'card',
            }];
            skill.triggers = skill.triggers || [{ type: 'on_entry_write' }];
          }
          if (skill.exposeAs === undefined) {
            skill.exposeAs = (skill.effects && skill.effects.length > 0) ? 'context' : 'tool';
          }
          delete skill.webhook_url;
          delete skill.handlerType;
          delete skill.triggerCondition;
          delete skill.inputSchema;
          delete skill.to;
          migrated = true;
        }
      }
      if (migrated) {
        console.log('[FileStorage] Migrated legacy skill records to new schema');
        this.scheduleSave();
      }

      console.log(`[FileStorage] Loaded ${this.entries.length} entries, ${this.users.size} users, ${this.teams.size} teams from ${this.filePath}`);
    } catch (err) {
      console.error(`[FileStorage] Failed to load ${this.filePath}:`, err);
    }
  }

  private scheduleSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.saveToDisk(), 500);
  }

  private saveToDisk() {
    const data: FileStorageData = {
      entries: this.entries,
      users: Array.from(this.users.entries()),
      teams: Array.from(this.teams.entries()),
      teamInvites: Array.from(this.teamInvites.entries()),
      teamMemories: Array.from(this.teamMemories.entries()),
      sparkPairRooms: Array.from(this.sparkPairRooms.entries()),
      tagConfigs: Array.from(this.tagConfigs.entries()),
      channelInvites: Array.from(this.channelInvites.entries()),
      notifications: this.notifications,
      nextId: this.nextId,
    };
    try {
      writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`[FileStorage] Failed to save:`, err);
    }
  }

  // Override write methods to trigger save
  async addEntry(entry: Omit<RouterEntry, 'id'>): Promise<RouterEntry> {
    const result = await super.addEntry(entry);
    this.scheduleSave();
    return result;
  }
  async deleteEntry(id: string): Promise<void> { await super.deleteEntry(id); this.scheduleSave(); }
  async updateEntryTags(id: string, tags: string[]): Promise<RouterEntry | null> { const r = await super.updateEntryTags(id, tags); this.scheduleSave(); return r; }
  async updateEntry(id: string, updates: Partial<Pick<RouterEntry, 'summary' | 'content' | 'tags' | 'role' | 'hidden' | 'channel' | 'to' | 'translations' | 'webhookFired' | 'publishAt' | 'matrixMirrorRoomId' | 'matrixMirrorEventId' | 'matrixMirroredAt'>>): Promise<RouterEntry | null> { const r = await super.updateEntry(id, updates); this.scheduleSave(); return r; }
  async createUser(user: Omit<RouterUser, 'createdAt'>): Promise<RouterUser> { const r = await super.createUser(user); this.scheduleSave(); return r; }
  async updateUser(handle: string, updates: Partial<Omit<RouterUser, 'handle' | 'secretKeyHash' | 'createdAt'>>): Promise<RouterUser | null> { const r = await super.updateUser(handle, updates); this.scheduleSave(); return r; }
  async bindMatrixAccount(handle: string, matrixUserId: string, boundAt?: number): Promise<RouterUser | null> { const r = await super.bindMatrixAccount(handle, matrixUserId, boundAt); if (r) this.scheduleSave(); return r; }
  async setSparkPairRoom(teamId: string, handleA: string, handleB: string, roomId: string, now?: number): Promise<SparkPairRoom> { const r = await super.setSparkPairRoom(teamId, handleA, handleB, roomId, now); this.scheduleSave(); return r; }
  async createTeam(team: Team): Promise<Team> { const r = await super.createTeam(team); this.scheduleSave(); return r; }
  async upsertTeamMemory(teamId: string, content: string, byHandle: string): Promise<TeamMemory> { const r = await super.upsertTeamMemory(teamId, content, byHandle); this.scheduleSave(); return r; }
  async rollbackTeamMemory(teamId: string, byHandle: string): Promise<TeamMemory | null> { const r = await super.rollbackTeamMemory(teamId, byHandle); if (r) this.scheduleSave(); return r; }
  async createTeamInvite(invite: TeamInvite): Promise<TeamInvite> { const r = await super.createTeamInvite(invite); this.scheduleSave(); return r; }
  async useTeamInvite(code: string): Promise<TeamInvite> { const r = await super.useTeamInvite(code); this.scheduleSave(); return r; }
  async createChannel(channel: Channel): Promise<Channel> { const r = await super.createChannel(channel); this.scheduleSave(); return r; }
  async updateChannel(id: string, updates: Partial<Omit<Channel, 'id' | 'createdBy' | 'createdAt' | 'teamId'>>): Promise<Channel | null> { const r = await super.updateChannel(id, updates); this.scheduleSave(); return r; }
  async deleteChannel(id: string): Promise<void> { await super.deleteChannel(id); this.scheduleSave(); }
  async addSubscriber(channelId: string, handle: string, role: 'admin' | 'member'): Promise<void> { await super.addSubscriber(channelId, handle, role); this.scheduleSave(); }
  async removeSubscriber(channelId: string, handle: string): Promise<void> { await super.removeSubscriber(channelId, handle); this.scheduleSave(); }
  async createInvite(invite: ChannelInvite): Promise<ChannelInvite> { const r = await super.createInvite(invite); this.scheduleSave(); return r; }
  async useInvite(token: string): Promise<Channel> { const r = await super.useInvite(token); this.scheduleSave(); return r; }
  async upsertTagConfig(teamId: string, tag: string, fields: Partial<Omit<TagConfig, 'teamId' | 'tag' | 'createdAt'>>): Promise<TagConfig> { const r = await super.upsertTagConfig(teamId, tag, fields); this.scheduleSave(); return r; }
  async addTagSubscriber(teamId: string, tag: string, handle: string, role?: 'admin' | 'member'): Promise<TagConfig> { const r = await super.addTagSubscriber(teamId, tag, handle, role); this.scheduleSave(); return r; }
  async removeTagSubscriber(teamId: string, tag: string, handle: string): Promise<TagConfig | null> { const r = await super.removeTagSubscriber(teamId, tag, handle); this.scheduleSave(); return r; }
  async addComment(entryId: string, comment: Comment): Promise<RouterEntry | null> { const r = await super.addComment(entryId, comment); this.scheduleSave(); return r; }
  async deleteComment(entryId: string, commentId: string): Promise<RouterEntry | null> { const r = await super.deleteComment(entryId, commentId); this.scheduleSave(); return r; }
  async updateComment(entryId: string, commentId: string, updates: Partial<Pick<Comment, 'translations'>>): Promise<Comment | null> { const r = await super.updateComment(entryId, commentId, updates); this.scheduleSave(); return r; }
  async addNotification(notification: Notification): Promise<Notification> { const r = await super.addNotification(notification); this.scheduleSave(); return r; }
  async markNotificationRead(id: string): Promise<void> { await super.markNotificationRead(id); this.scheduleSave(); }
  async markAllNotificationsRead(handle: string): Promise<void> { await super.markAllNotificationsRead(handle); this.scheduleSave(); }
  async addPresetTag(tag: PresetTag): Promise<PresetTag> { const r = await super.addPresetTag(tag); this.scheduleSave(); return r; }
  async updatePresetTag(name: string, description: string): Promise<PresetTag | null> { const r = await super.updatePresetTag(name, description); this.scheduleSave(); return r; }
  async deletePresetTag(name: string): Promise<boolean> { const r = await super.deletePresetTag(name); this.scheduleSave(); return r; }
}

// ─────────────────────────────────────────────────────────────
// Staged Storage (wraps another storage with publish delay)
// ─────────────────────────────────────────────────────────────

const DEFAULT_STAGING_DELAY_MS = 15 * 60 * 1000; // 15 minutes

export class StagedStorage implements Storage {
  private published: Storage;
  // Tracks which entries are currently in the staging window. These entries
  // ARE persisted to `published` (with publishAt set in the future), so they
  // survive restarts. This set is just an in-memory index used by publishReady
  // and by queries that need to hide/show pending. It's rebuilt on startup
  // via rehydratePending().
  private pendingIds: Set<string> = new Set();
  private publishDelayMs: number;
  private publishInterval: ReturnType<typeof setInterval> | null = null;
  onPublish?: (entry: RouterEntry) => void;
  // Fires when addEntry publishes immediately (stagingDelayMs <= 0). Used for
  // side-effects that must run regardless of staging — currently English
  // auto-translation. Mentions and channel-trigger webhooks are NOT routed
  // here; the immediate-publish call sites already invoke those themselves.
  onImmediatePublish?: (entry: RouterEntry) => void;

  constructor(publishDelayMs = DEFAULT_STAGING_DELAY_MS, published?: Storage) {
    this.publishDelayMs = publishDelayMs;
    this.published = published || new MemoryStorage();

    // Check for ready-to-publish entries every 10 seconds
    this.publishInterval = setInterval(() => this.publishReady(), 10_000);
  }

  /** Load entries that still have a publishAt set into the in-memory index.
   * Covers both "still waiting to publish" and "was past-due when the server
   * died before publishing". The next publishReady tick handles the latter
   * immediately. Called once at server startup so staging survives restarts. */
  async rehydratePending(): Promise<number> {
    const all = await this.published.getPendingEntries();
    for (const e of all) this.pendingIds.add(e.id);
    return all.length;
  }

  private async publishReady() {
    const now = Date.now();
    for (const id of this.pendingIds) {
      const entry = await this.published.getEntry(id);
      if (!entry) {
        // Gone from storage (deleted) — drop from index.
        this.pendingIds.delete(id);
        continue;
      }
      if (entry.publishAt && entry.publishAt <= now) {
        const saved = await this.published.updateEntry(id, { publishAt: null });
        this.pendingIds.delete(id);
        if (saved) this.onPublish?.(saved);
      }
    }
  }

  /** Publish a pending entry immediately.
   *
   * NOTE: unlike publishReady(), this path deliberately does NOT call
   * this.onPublish — the REST handler POST /api/entries/:id/publish already
   * invokes evaluateChannelTriggers() itself after calling us. Firing the
   * onPublish hook here too would double-send the webhook.
   */
  async publishEntry(id: string): Promise<RouterEntry | null> {
    if (!this.pendingIds.has(id)) return null;
    const saved = await this.published.updateEntry(id, { publishAt: null });
    this.pendingIds.delete(id);
    return saved;
  }

  isPending(id: string): boolean {
    return this.pendingIds.has(id);
  }

  async getAllPendingEntries(): Promise<RouterEntry[]> {
    const entries = await this.published.getPendingEntries();
    return entries.sort((a, b) => (a.publishAt ?? 0) - (b.publishAt ?? 0));
  }

  async getPendingEntriesByHandle(handle: string): Promise<RouterEntry[]> {
    const entries = await this.published.getPendingEntries();
    return entries
      .filter(e => e.handle === handle)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  stop() {
    if (this.publishInterval) {
      clearInterval(this.publishInterval);
      this.publishInterval = null;
    }
  }

  // ── Entry methods (staging-aware) ──

  async addEntry(entry: Omit<RouterEntry, 'id'>, stagingDelayMs?: number): Promise<RouterEntry> {
    const delay = stagingDelayMs ?? this.publishDelayMs;

    if (delay <= 0) {
      // No staging, publish immediately
      const saved = await this.published.addEntry(entry);
      this.onImmediatePublish?.(saved);
      return saved;
    }

    // Store with publishAt set to the future so the entry survives restarts.
    // The index (pendingIds) mirrors this and drives the publishReady loop.
    const withPublishAt: Omit<RouterEntry, 'id'> = {
      ...entry,
      publishAt: Date.now() + delay,
    };
    const saved = await this.published.addEntry(withPublishAt);
    this.pendingIds.add(saved.id);
    return saved;
  }

  async getEntry(id: string): Promise<RouterEntry | null> {
    return this.published.getEntry(id);
  }

  async getEntries(teamId: string, limit = 50, offset = 0, cursor?: string, includePendingForHandle?: string): Promise<RouterEntry[]> {
    // Backing storage now contains both published AND pending rows. We must
    // filter pending rows out of general queries, except for the caller's
    // own pending (owner-visible preview).
    const raw = await this.published.getEntries(teamId, limit + this.pendingIds.size, offset, cursor);
    const filtered = raw.filter(e => !this.pendingIds.has(e.id) || e.handle === includePendingForHandle);
    return filtered.slice(0, limit);
  }

  async getEntriesByHandle(teamId: string, handle: string, limit = 50, since?: number): Promise<RouterEntry[]> {
    // Owner-scoped — pending is always visible here.
    const raw = await this.published.getEntriesByHandle(teamId, handle, limit, since);
    return raw.slice(0, limit);
  }

  async searchEntries(teamId: string, query: string, limit = 50, since?: number): Promise<RouterEntry[]> {
    const raw = await this.published.searchEntries(teamId, query, limit + this.pendingIds.size, since);
    const filtered = raw.filter(e => !this.pendingIds.has(e.id));
    return filtered.slice(0, limit);
  }

  async getEntriesByTags(teamId: string, tags: string[], limit?: number, offset = 0): Promise<RouterEntry[]> {
    const extra = limit != null ? limit + this.pendingIds.size : undefined;
    const raw = await this.published.getEntriesByTags(teamId, tags, extra, offset);
    const filtered = raw.filter(e => !this.pendingIds.has(e.id));
    return limit != null ? filtered.slice(0, limit) : filtered;
  }

  async getEntriesSince(teamId: string, since: number, limit = 50): Promise<RouterEntry[]> {
    const raw = await this.published.getEntriesSince(teamId, since, limit + this.pendingIds.size);
    const filtered = raw.filter(e => !this.pendingIds.has(e.id));
    return filtered.slice(0, limit);
  }

  async getEntryCount(teamId?: string): Promise<number> {
    // Count excludes pending — user-facing stats shouldn't include drafts.
    const all = await this.published.getEntryCount(teamId);
    // getEntryCount has no pending vs published distinction at the storage
    // layer; subtract the pending entries for this team (or all pending).
    const allPending = await this.published.getPendingEntries();
    const pendingCount = teamId
      ? allPending.filter(e => e.teamId === teamId).length
      : allPending.length;
    return all - pendingCount;
  }

  async deleteEntry(id: string): Promise<void> {
    this.pendingIds.delete(id);
    await this.published.deleteEntry(id);
  }

  async updateEntryTags(id: string, tags: string[]): Promise<RouterEntry | null> {
    return this.published.updateEntryTags(id, tags);
  }

  async updateEntry(id: string, updates: Partial<Pick<RouterEntry, 'summary' | 'content' | 'tags' | 'role' | 'hidden' | 'channel' | 'to' | 'translations' | 'webhookFired' | 'publishAt' | 'matrixMirrorRoomId' | 'matrixMirrorEventId' | 'matrixMirroredAt'>>): Promise<RouterEntry | null> {
    return this.published.updateEntry(id, updates);
  }

  async getTagStats(teamId: string): Promise<Array<{ tag: string; count: number }>> {
    return this.published.getTagStats(teamId);
  }

  async getEntriesAddressedTo(teamId: string, handle: string, limit = 50): Promise<RouterEntry[]> {
    const raw = await this.published.getEntriesAddressedTo(teamId, handle, limit + this.pendingIds.size);
    // Pending entries are only addressed-to visible once they publish — the
    // recipient's notification/read states rely on publication anyway.
    return raw.filter(e => !this.pendingIds.has(e.id)).slice(0, limit);
  }

  async getRepliesTo(entryId: string, limit = 50): Promise<RouterEntry[]> {
    const raw = await this.published.getRepliesTo(entryId, limit + this.pendingIds.size);
    return raw.filter(e => !this.pendingIds.has(e.id)).slice(0, limit);
  }

  async addComment(entryId: string, comment: Comment): Promise<RouterEntry | null> {
    return this.published.addComment(entryId, comment);
  }

  async deleteComment(entryId: string, commentId: string): Promise<RouterEntry | null> {
    return this.published.deleteComment(entryId, commentId);
  }

  async updateComment(entryId: string, commentId: string, updates: Partial<Pick<Comment, 'translations'>>): Promise<Comment | null> {
    return this.published.updateComment(entryId, commentId, updates);
  }

  async getChannelEntries(teamId: string, channelId: string, limit = 50): Promise<RouterEntry[]> {
    const raw = await this.published.getChannelEntries(teamId, channelId, limit + this.pendingIds.size);
    return raw.filter(e => !this.pendingIds.has(e.id)).slice(0, limit);
  }

  async getPendingEntries(): Promise<RouterEntry[]> {
    return this.published.getPendingEntries();
  }

  // ── Delegated methods ──

  async createUser(user: Omit<RouterUser, 'createdAt'>): Promise<RouterUser> { return this.published.createUser(user); }
  async getUser(handle: string): Promise<RouterUser | null> { return this.published.getUser(handle); }
  async getUserByKeyHash(keyHash: string): Promise<RouterUser | null> { return this.published.getUserByKeyHash(keyHash); }
  async updateUser(handle: string, updates: Partial<Omit<RouterUser, 'handle' | 'secretKeyHash' | 'createdAt'>>): Promise<RouterUser | null> { return this.published.updateUser(handle, updates); }
  async updateUserPreferences(handle: string, prefs: { syncMode?: 'active' | 'passive'; previewMode?: 'always' | 'never'; privacyStripCustom?: string[] }): Promise<void> { return this.published.updateUserPreferences(handle, prefs); }
  async isHandleAvailable(handle: string): Promise<boolean> { return this.published.isHandleAvailable(handle); }
  async searchUsers(prefix: string, limit?: number): Promise<RouterUser[]> { return this.published.searchUsers(prefix, limit); }
  async deleteUser(handle: string): Promise<void> { return this.published.deleteUser(handle); }
  async getUserCount(): Promise<number> { return this.published.getUserCount(); }
  async getAllUsers(teamId?: string): Promise<RouterUser[]> { return this.published.getAllUsers(teamId); }
  async getUserByLarkOpenId(openId: string): Promise<RouterUser | null> { return this.published.getUserByLarkOpenId(openId); }
  async bindLarkAccount(handle: string, fields: LarkBindingFields): Promise<RouterUser | null> { return this.published.bindLarkAccount(handle, fields); }
  async unbindLarkAccount(handle: string): Promise<RouterUser | null> { return this.published.unbindLarkAccount(handle); }
  async getUserByMatrixUserId(matrixUserId: string): Promise<RouterUser | null> { return this.published.getUserByMatrixUserId(matrixUserId); }
  async bindMatrixAccount(handle: string, matrixUserId: string, boundAt?: number): Promise<RouterUser | null> { return this.published.bindMatrixAccount(handle, matrixUserId, boundAt); }
  async getSparkPairRoom(teamId: string, handleA: string, handleB: string): Promise<SparkPairRoom | null> { return this.published.getSparkPairRoom(teamId, handleA, handleB); }
  async setSparkPairRoom(teamId: string, handleA: string, handleB: string, roomId: string, now?: number): Promise<SparkPairRoom> { return this.published.setSparkPairRoom(teamId, handleA, handleB, roomId, now); }
  async rotateSecretKey(handle: string, graceMs?: number): Promise<{ newKey: string; user: RouterUser } | null> { return this.published.rotateSecretKey(handle, graceMs); }
  async generateAdditionalKeyForUser(handle: string): Promise<string> { return this.published.generateAdditionalKeyForUser(handle); }

  async createTeam(team: Team): Promise<Team> { return this.published.createTeam(team); }
  async getTeam(id: string): Promise<Team | null> { return this.published.getTeam(id); }
  async isTeamIdAvailable(id: string): Promise<boolean> { return this.published.isTeamIdAvailable(id); }
  async getTeamMemory(teamId: string): Promise<TeamMemory | null> { return this.published.getTeamMemory(teamId); }
  async upsertTeamMemory(teamId: string, content: string, byHandle: string): Promise<TeamMemory> { return this.published.upsertTeamMemory(teamId, content, byHandle); }
  async rollbackTeamMemory(teamId: string, byHandle: string): Promise<TeamMemory | null> { return this.published.rollbackTeamMemory(teamId, byHandle); }

  async createTeamInvite(invite: TeamInvite): Promise<TeamInvite> { return this.published.createTeamInvite(invite); }
  async getTeamInvite(code: string): Promise<TeamInvite | null> { return this.published.getTeamInvite(code); }
  async useTeamInvite(code: string): Promise<TeamInvite> { return this.published.useTeamInvite(code); }
  async listTeamInvites(teamId: string): Promise<TeamInvite[]> { return this.published.listTeamInvites(teamId); }

  async createChannel(channel: Channel): Promise<Channel> { return this.published.createChannel(channel); }
  async getChannel(id: string): Promise<Channel | null> { return this.published.getChannel(id); }
  async updateChannel(id: string, updates: Partial<Omit<Channel, 'id' | 'createdBy' | 'createdAt' | 'teamId'>>): Promise<Channel | null> { return this.published.updateChannel(id, updates); }
  async deleteChannel(id: string): Promise<void> { return this.published.deleteChannel(id); }
  async listChannels(teamId: string, opts?: { handle?: string }): Promise<Channel[]> { return this.published.listChannels(teamId, opts); }
  async addSubscriber(channelId: string, handle: string, role: 'admin' | 'member'): Promise<void> { return this.published.addSubscriber(channelId, handle, role); }
  async removeSubscriber(channelId: string, handle: string): Promise<void> { return this.published.removeSubscriber(channelId, handle); }
  async getSubscribedChannels(handle: string): Promise<Channel[]> { return this.published.getSubscribedChannels(handle); }
  async createInvite(invite: ChannelInvite): Promise<ChannelInvite> { return this.published.createInvite(invite); }
  async getInvite(token: string): Promise<ChannelInvite | null> { return this.published.getInvite(token); }
  async useInvite(token: string): Promise<Channel> { return this.published.useInvite(token); }

  async getTagConfig(teamId: string, tag: string): Promise<TagConfig | null> { return this.published.getTagConfig(teamId, tag); }
  async listTagConfigs(teamId: string, opts?: { handle?: string }): Promise<TagConfig[]> { return this.published.listTagConfigs(teamId, opts); }
  async upsertTagConfig(teamId: string, tag: string, fields: Partial<Omit<TagConfig, 'teamId' | 'tag' | 'createdAt'>>): Promise<TagConfig> { return this.published.upsertTagConfig(teamId, tag, fields); }
  async addTagSubscriber(teamId: string, tag: string, handle: string, role?: 'admin' | 'member'): Promise<TagConfig> { return this.published.addTagSubscriber(teamId, tag, handle, role); }
  async removeTagSubscriber(teamId: string, tag: string, handle: string): Promise<TagConfig | null> { return this.published.removeTagSubscriber(teamId, tag, handle); }
  async getEntriesByTag(teamId: string, tag: string, limit = 50): Promise<RouterEntry[]> {
    const raw = await this.published.getEntriesByTag(teamId, tag, limit + this.pendingIds.size);
    return raw.filter(e => !this.pendingIds.has(e.id)).slice(0, limit);
  }
  async getSubscribedTags(handle: string): Promise<TagConfig[]> { return this.published.getSubscribedTags(handle); }

  async addNotification(notification: Notification): Promise<Notification> { return this.published.addNotification(notification); }
  async getNotifications(handle: string, limit?: number): Promise<Notification[]> { return this.published.getNotifications(handle, limit); }
  async getUnreadCount(handle: string): Promise<number> { return this.published.getUnreadCount(handle); }
  async markNotificationRead(id: string): Promise<void> { return this.published.markNotificationRead(id); }
  async markAllNotificationsRead(handle: string): Promise<void> { return this.published.markAllNotificationsRead(handle); }
  async getPresetTags(): Promise<PresetTag[]> { return this.published.getPresetTags(); }
  async addPresetTag(tag: PresetTag): Promise<PresetTag> { return this.published.addPresetTag(tag); }
  async updatePresetTag(name: string, description: string): Promise<PresetTag | null> { return this.published.updatePresetTag(name, description); }
  async deletePresetTag(name: string): Promise<boolean> { return this.published.deletePresetTag(name); }

  async createSession(handle: string, ttlMs?: number, userAgent?: string): Promise<{ token: string; expiresAt: number }> { return this.published.createSession(handle, ttlMs, userAgent); }
  async getSession(token: string): Promise<Session | null> { return this.published.getSession(token); }
  async touchSession(token: string, ttlMs?: number): Promise<void> { return this.published.touchSession(token, ttlMs); }
  async deleteSession(token: string): Promise<void> { return this.published.deleteSession(token); }

  // ── Lark Phase 1 (delegated to published storage) ──
  async createLarkChatBinding(b: Omit<LarkChatBinding, 'lastSummaryTs' | 'lastSummaryAt'>): Promise<LarkChatBinding> { return this.published.createLarkChatBinding(b); }
  async getLarkChatBinding(chatId: string): Promise<LarkChatBinding | null> { return this.published.getLarkChatBinding(chatId); }
  async listLarkChatBindingsByChannel(channelId: string): Promise<LarkChatBinding[]> { return this.published.listLarkChatBindingsByChannel(channelId); }
  async listLarkChatBindingsByTeam(teamId: string): Promise<LarkChatBinding[]> { return this.published.listLarkChatBindingsByTeam(teamId); }
  async deleteLarkChatBinding(chatId: string): Promise<void> { return this.published.deleteLarkChatBinding(chatId); }
  async updateLarkLastSummary(chatId: string, lastSummaryTs: number, lastSummaryAt: number): Promise<void> { return this.published.updateLarkLastSummary(chatId, lastSummaryTs, lastSummaryAt); }
  async updateLarkBindingArchive(chatId: string, archiveChannelId: string | null): Promise<void> { return this.published.updateLarkBindingArchive(chatId, archiveChannelId); }
  async updateLarkBindingPushEnabled(chatId: string, pushEnabled: boolean): Promise<void> { return this.published.updateLarkBindingPushEnabled(chatId, pushEnabled); }
  async updateLarkBindingSummaryStyle(chatId: string, style: 'person' | 'topic' | 'free'): Promise<void> { return this.published.updateLarkBindingSummaryStyle(chatId, style); }
  async getLarkChatStyle(chatId: string): Promise<'person' | 'topic' | 'free' | null> { return this.published.getLarkChatStyle(chatId); }
  async setLarkChatStyle(chatId: string, style: 'person' | 'topic' | 'free'): Promise<void> { return this.published.setLarkChatStyle(chatId, style); }
  async getLarkAutoSummary(chatId: string): Promise<LarkAutoSummaryPrefs | null> { return this.published.getLarkAutoSummary(chatId); }
  async setLarkAutoSummary(chatId: string, prefs: Omit<LarkAutoSummaryPrefs, 'chatId' | 'updatedAt' | 'lastRunAt'>): Promise<void> { return this.published.setLarkAutoSummary(chatId, prefs); }
  async recordLarkAutoSummaryRan(chatId: string, ranAt: number): Promise<void> { return this.published.recordLarkAutoSummaryRan(chatId, ranAt); }
  async listLarkAutoSummaryEnabled(): Promise<LarkAutoSummaryPrefs[]> { return this.published.listLarkAutoSummaryEnabled(); }
  async updateLarkBindingWatchEnabled(chatId: string, enabled: boolean): Promise<void> { return this.published.updateLarkBindingWatchEnabled(chatId, enabled); }
  async incrementLarkWatchMsgCount(chatId: string): Promise<void> { return this.published.incrementLarkWatchMsgCount(chatId); }
  async recordLarkWatchRan(chatId: string, ranAt: number): Promise<void> { return this.published.recordLarkWatchRan(chatId, ranAt); }
  async recordLarkWatchPosted(chatId: string, postedAt: number): Promise<void> { return this.published.recordLarkWatchPosted(chatId, postedAt); }
  async recordLarkWatchObservations(chatId: string, ranAt: number, observations: LarkWatchObservation['observations']): Promise<void> { return this.published.recordLarkWatchObservations(chatId, ranAt, observations); }
  async listLarkWatchObservationsRecent(chatId: string, limit: number): Promise<LarkWatchObservation[]> { return this.published.listLarkWatchObservationsRecent(chatId, limit); }
  async deleteLarkWatchObservationsBefore(cutoffMs: number): Promise<number> { return this.published.deleteLarkWatchObservationsBefore(cutoffMs); }
  async recordLarkMessageReaction(r: Omit<LarkMessageReaction, 'id'>): Promise<void> { return this.published.recordLarkMessageReaction(r); }
  async listLarkMessageReactionsByMessage(messageId: string): Promise<LarkMessageReaction[]> { return this.published.listLarkMessageReactionsByMessage(messageId); }
  async recordLarkEntryMessage(messageId: string, entryId: string, chatId: string, postedAt: number): Promise<void> { return this.published.recordLarkEntryMessage(messageId, entryId, chatId, postedAt); }
  async getEntryReactionSummary(entryId: string): Promise<Array<{ emojiType: string; count: number }>> { return this.published.getEntryReactionSummary(entryId); }
  async recordLarkCardAction(a: Omit<LarkCardAction, 'id'>): Promise<LarkCardAction> { return this.published.recordLarkCardAction(a); }
  async listLarkCardActionsByEntry(entryId: string): Promise<LarkCardAction[]> { return this.published.listLarkCardActionsByEntry(entryId); }
}
