// Empty / unset → same-origin requests via relative path (production behind reverse proxy).
// Set NEXT_PUBLIC_API_URL=http://localhost:3001 for `npm run dev` against a separate server process.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export interface RouterEntry {
  id: string;
  handle: string;
  authorDisplayName?: string;
  authorRole?: string;
  teamId: string;
  client: string;
  content: string;
  summary: string;
  tags: string[];
  role?: string;
  timestamp: number;
  model?: string;
  to?: string[];
  inReplyTo?: string;
  channel?: string;
  publishAt?: number;
  comments?: CommentItem[];
  hidden?: boolean;
  oneliner?: string;
  translations?: Record<string, { summary: string; content?: string; oneliner?: string }>;
}

export interface CommentItem {
  id: string;
  handle: string;
  content: string;
  timestamp: number;
  translations?: Record<string, string>;
}

export interface TagStat {
  tag: string;
  count: number;
}

export interface PresetTag {
  name: string;
  description: string;
  createdAt: number;
}

export interface TeamInfo {
  team: { id: string; name: string; createdBy: string; createdAt: number };
  // larkName included so @ mention typeahead can match against Lark display
  // name in addition to canonical handle. See 2026-05-13-at-mention-llm spec.
  members: Array<{ handle: string; displayName?: string; larkName?: string; role?: string; isAdmin?: boolean }>;
}

function buildUrl(path: string, key: string, params?: Record<string, string>) {
  // Use a placeholder origin so URL parsing works for both absolute and relative cases.
  const base = API_URL || "http://_relative_";
  const url = new URL(`${base}${path}`);
  // M2a.5: empty key is allowed — server's authenticate() falls back to
  // the session cookie when ?key= is absent or empty.
  if (key) url.searchParams.set("key", key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  // When API_URL is empty, return only path + search so the request stays same-origin.
  return API_URL ? url.toString() : `${url.pathname}${url.search}`;
}

/**
 * Fetch helper that always includes credentials so the session cookie
 * (M2a.5) travels with the request. Use this everywhere instead of raw
 * fetch when calling server endpoints — backward compat with ?key= is
 * preserved by buildUrl.
 */
function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, { credentials: "include", ...init });
}

export async function getEntries(
  key: string,
  opts?: { tags?: string[]; author?: string; limit?: number; offset?: number; cursor?: string }
): Promise<{ entries: RouterEntry[]; total: number; nextCursor?: string }> {
  const params: Record<string, string> = {};
  if (opts?.tags?.length) params.tags = opts.tags.join(",");
  if (opts?.author) params.author = opts.author;
  if (opts?.limit) params.limit = String(opts.limit);
  if (opts?.offset) params.offset = String(opts.offset);
  if (opts?.cursor) params.cursor = opts.cursor;

  const res = await apiFetch(buildUrl("/api/entries", key, params));
  return res.json();
}

export async function searchEntries(
  key: string,
  query: string
): Promise<{ results: RouterEntry[]; count: number }> {
  const res = await apiFetch(buildUrl("/api/search", key, { q: query }));
  return res.json();
}

export async function getTagStats(key: string): Promise<TagStat[]> {
  const res = await apiFetch(buildUrl("/api/tags", key));
  const data = await res.json();
  return data.tags;
}

export async function getTeamInfo(key: string): Promise<TeamInfo> {
  const res = await apiFetch(buildUrl("/api/team", key));
  // Mark authentication failure explicitly so callers can distinguish between
  // "key is invalid" (403/401) and "server is unreachable" (network error /
  // 5xx). Without this, a restart's transient error would look like an auth
  // failure and wipe the user's localStorage.
  if (res.status === 401 || res.status === 403) {
    const err: any = new Error("Unauthorized");
    err.authFailed = true;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`Team info request failed: ${res.status}`);
  }
  return res.json();
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
  exposeAs: 'tool' | 'context' | 'both' | 'prewrite' | 'digest';
  digestConfig?: {
    schedule: 'weekly' | 'monthly';
    lookbackDays?: number;
    postToChannel?: boolean;
    webhookUrl?: string;
    lastRunAt?: number;
  };
  parameters?: Array<{ name: string; type: string; description: string; required?: boolean }>;
  triggers?: SkillTrigger[];
  effects?: SkillEffect[];
  createdAt: number;
  updatedAt?: number;
}

export interface Channel {
  id: string;
  teamId: string;
  name: string;
  description?: string;
  skills: Skill[];
  subscribers: Array<{ handle: string; role: string; joinedAt: number }>;
}

export async function getChannels(key: string): Promise<Channel[]> {
  const res = await apiFetch(buildUrl("/api/channels", key));
  const data = await res.json();
  return data.channels;
}

export async function getChannel(key: string, id: string): Promise<Channel> {
  const res = await apiFetch(buildUrl(`/api/channels/${id}`, key));
  const data = await res.json();
  return data.channel;
}

export async function createChannel(
  key: string,
  opts: { id: string; name: string; description?: string }
): Promise<Channel> {
  const res = await apiFetch(buildUrl("/api/channels", key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data.channel;
}

export async function deleteChannel(key: string, id: string): Promise<void> {
  const res = await apiFetch(buildUrl(`/api/channels/${id}`, key), { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to delete channel");
  }
}

export async function addChannelSkill(
  key: string,
  channelId: string,
  skill: {
    name: string;
    description?: string;
    instructions?: string;
    exposeAs: 'tool' | 'context' | 'both' | 'prewrite' | 'digest';
  digestConfig?: {
    schedule: 'weekly' | 'monthly';
    lookbackDays?: number;
    postToChannel?: boolean;
    webhookUrl?: string;
    lastRunAt?: number;
  };
    triggers?: SkillTrigger[];
    effects?: SkillEffect[];
  }
): Promise<Skill> {
  const res = await apiFetch(buildUrl(`/api/channels/${channelId}/skills`, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(skill),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data.skill;
}

export async function updateChannelSkill(
  key: string,
  channelId: string,
  skillName: string,
  patch: Partial<Pick<Skill, 'description' | 'instructions' | 'exposeAs' | 'triggers' | 'effects'>>,
): Promise<Skill> {
  const res = await apiFetch(buildUrl(`/api/channels/${channelId}/skills/${skillName}`, key), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data.skill;
}

export async function removeChannelSkill(
  key: string,
  channelId: string,
  skillName: string
): Promise<void> {
  await apiFetch(buildUrl(`/api/channels/${channelId}/skills/${skillName}`, key), {
    method: "DELETE",
  });
}

export async function getChannelEntries(
  key: string,
  channelId: string
): Promise<RouterEntry[]> {
  const res = await apiFetch(buildUrl(`/api/channels/${channelId}/entries`, key));
  const data = await res.json();
  return data.entries || [];
}

// ── Tag unification (B-plus) ──

export interface TagConfig {
  teamId: string;
  tag: string;
  name?: string;
  description?: string;
  createdBy?: string;
  createdAt?: number;
  subscribers: Array<{ handle: string; role: string; joinedAt: number }>;
  skills: Skill[];
}

export interface TagDetail {
  tag: string;
  config: TagConfig | null;
  entries: RouterEntry[];
  count: number;
}

export async function listTags(key: string): Promise<TagConfig[]> {
  const res = await apiFetch(buildUrl("/api/tag-configs", key));
  const data = await res.json();
  return data.tags || data.hashes || [];
}

export async function getTag(key: string, tag: string): Promise<TagDetail> {
  const res = await apiFetch(buildUrl(`/api/tag-configs/${encodeURIComponent(tag)}`, key));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to load #${tag}`);
  }
  return await res.json();
}

export async function subscribeTag(key: string, tag: string): Promise<TagConfig> {
  const res = await apiFetch(buildUrl(`/api/tag-configs/${encodeURIComponent(tag)}/subscribe`, key), { method: "POST" });
  const data = await res.json();
  return data.config;
}

export async function unsubscribeTag(key: string, tag: string): Promise<TagConfig | null> {
  const res = await apiFetch(buildUrl(`/api/tag-configs/${encodeURIComponent(tag)}/unsubscribe`, key), { method: "POST" });
  const data = await res.json();
  return data.config ?? null;
}

export async function addTagSkill(
  key: string,
  tag: string,
  skill: {
    name: string;
    description?: string;
    instructions?: string;
    exposeAs: 'tool' | 'context' | 'both' | 'prewrite' | 'digest';
    triggers?: SkillTrigger[];
    effects?: SkillEffect[];
    digestConfig?: {
      schedule: 'weekly' | 'monthly';
      lookbackDays?: number;
      postToChannel?: boolean;
      webhookUrl?: string;
      lastRunAt?: number;
    };
  },
): Promise<Skill> {
  const res = await apiFetch(buildUrl(`/api/tag-configs/${encodeURIComponent(tag)}/skills`, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(skill),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to add skill");
  return data.skill;
}

export async function updateTagSkill(
  key: string,
  tag: string,
  skillName: string,
  patch: Partial<Pick<Skill, 'description' | 'instructions' | 'exposeAs' | 'triggers' | 'effects' | 'digestConfig'>>,
): Promise<Skill> {
  const res = await apiFetch(
    buildUrl(`/api/tag-configs/${encodeURIComponent(tag)}/skills/${encodeURIComponent(skillName)}`, key),
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update skill");
  return data.skill;
}

export async function removeTagSkill(key: string, tag: string, skillName: string): Promise<void> {
  const res = await apiFetch(
    buildUrl(`/api/tag-configs/${encodeURIComponent(tag)}/skills/${encodeURIComponent(skillName)}`, key),
    { method: "DELETE" },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to remove skill");
  }
}

export type TimelineDays = 7 | 30 | 90;

export async function getChannelTimeline(
  key: string,
  channelId: string,
  days: TimelineDays = 30,
): Promise<RouterEntry[]> {
  const res = await apiFetch(buildUrl(`/api/channels/${channelId}/timeline`, key, { days: String(days) }));
  if (!res.ok) {
    return [];
  }
  const data = await res.json();
  return data.entries || [];
}

export async function publishEntry(key: string, entryId: string): Promise<RouterEntry> {
  const res = await apiFetch(buildUrl(`/api/entries/${entryId}/publish`, key), { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data.entry;
}

export async function deleteEntry(key: string, entryId: string): Promise<void> {
  const res = await apiFetch(buildUrl(`/api/entries/${entryId}`, key), { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error);
  }
}

export async function updateEntryTags(
  key: string,
  entryId: string,
  tags: string[]
): Promise<RouterEntry> {
  const res = await apiFetch(buildUrl(`/api/entries/${entryId}/tags`, key), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags }),
  });
  const data = await res.json();
  return data.entry;
}

export interface NotificationItem {
  id: string;
  recipientHandle: string;
  teamId: string;
  type: 'mention' | 'comment' | 'reply' | 'admin_granted' | 'admin_revoked';
  fromHandle: string;
  entryId?: string;
  commentId?: string;
  preview: string;
  read: boolean;
  timestamp: number;
}

export async function getNotifications(key: string): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
  const res = await apiFetch(buildUrl("/api/notifications", key));
  return res.json();
}

export async function getUnreadCount(key: string): Promise<number> {
  const res = await apiFetch(buildUrl("/api/notifications/unread-count", key));
  const data = await res.json();
  return data.count;
}

export async function markAllRead(key: string): Promise<void> {
  await apiFetch(buildUrl("/api/notifications/read-all", key), { method: "POST" });
}

export async function markNotificationRead(key: string, id: string): Promise<void> {
  await apiFetch(buildUrl(`/api/notifications/${id}/read`, key), { method: "POST" });
}

export async function toggleBookmark(key: string, entryId: string): Promise<boolean> {
  const res = await apiFetch(buildUrl(`/api/bookmarks/${entryId}`, key), { method: "POST" });
  const data = await res.json();
  return data.bookmarked;
}

export async function getBookmarks(key: string): Promise<RouterEntry[]> {
  const res = await apiFetch(buildUrl("/api/bookmarks", key));
  const data = await res.json();
  return data.entries || [];
}

export interface TagPreset {
  id: string;
  name: string;
  tags: string[];
  createdAt: number;
}

export async function getTagPresets(key: string): Promise<TagPreset[]> {
  const res = await apiFetch(buildUrl("/api/me/tag-presets", key));
  const data = await res.json();
  return data.presets || [];
}

export async function saveTagPreset(key: string, name: string, tags: string[]): Promise<TagPreset> {
  const res = await apiFetch(buildUrl("/api/me/tag-presets", key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, tags }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to save preset");
  return data.preset;
}

export async function deleteTagPreset(key: string, id: string): Promise<void> {
  const res = await apiFetch(buildUrl(`/api/me/tag-presets/${id}`, key), { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to delete preset");
  }
}

export async function mergeTags(key: string, from: string, to: string): Promise<number> {
  const res = await apiFetch(buildUrl("/api/tags/merge", key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to merge tags");
  return data.updated;
}

export async function deleteTag(key: string, name: string): Promise<number> {
  const res = await apiFetch(buildUrl(`/api/tags/${encodeURIComponent(name)}`, key), { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to delete tag");
  return data.updated;
}

// ── Preset tags ─────────────────────────────────────────

export async function getPresetTags(key: string): Promise<PresetTag[]> {
  const res = await apiFetch(buildUrl("/api/preset-tags", key));
  const data = await res.json();
  return data.presetTags || [];
}

export async function addPresetTag(key: string, name: string, description: string): Promise<PresetTag> {
  const res = await apiFetch(buildUrl("/api/preset-tags", key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to add preset tag");
  return data.tag;
}

export async function updatePresetTag(key: string, name: string, description: string): Promise<PresetTag> {
  const res = await apiFetch(buildUrl(`/api/preset-tags/${encodeURIComponent(name)}`, key), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update preset tag");
  return data.tag;
}

export async function deletePresetTag(key: string, name: string): Promise<void> {
  const res = await apiFetch(buildUrl(`/api/preset-tags/${encodeURIComponent(name)}`, key), { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to delete preset tag");
  }
}

export async function createCustomTag(key: string, name: string): Promise<void> {
  const res = await apiFetch(buildUrl("/api/tags", key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to create tag");
  }
}

// ── Team members ─────────────────────────────────────────

export interface MemberRecentEntry {
  id: string;
  summary: string;
  timestamp: number;
  tags: string[];
}

export interface MemberWithActivity {
  handle: string;
  displayName?: string;
  bio?: string;
  email?: string;
  role?: string;
  isAdmin?: boolean;
  joinedAt: number;
  larkBinding?: {
    name?: string;
    avatarUrl?: string;
  };
  recentEntries: MemberRecentEntry[];
}

export async function getTeamMembers(key: string): Promise<MemberWithActivity[]> {
  const res = await apiFetch(buildUrl("/api/team/members", key));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load team members");
  return data.members;
}

export async function deleteTeamMember(key: string, handle: string): Promise<void> {
  const res = await apiFetch(buildUrl(`/api/users/${handle}`, key), { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to remove member");
  }
}

export async function setMemberAdmin(key: string, handle: string, isAdmin: boolean): Promise<void> {
  const res = await apiFetch(buildUrl(`/api/users/${handle}/admin`, key), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isAdmin }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to update admin status");
  }
}

// ── Sessions (M2a.5 cookie auth) ──

/**
 * Exchange a secret_key for a session cookie. Called silently on app
 * mount when localStorage has router_key but no cookie has been
 * established yet (migration path for existing users), and after
 * secret_key login to enable cookie-based subsequent auth.
 */
export async function createSessionFromKey(secretKey: string): Promise<{ handle: string; expiresAt: number }> {
  const url = API_URL ? `${API_URL}/api/auth/session` : '/api/auth/session';
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ secret_key: secretKey }),
  });
  if (!res.ok) throw new Error(`session_create_failed_${res.status}`);
  return res.json();
}

/**
 * Check whether a candidate plaintext secret_key matches the currently
 * authenticated user. Used by /settings to let users restore the
 * localStorage plaintext cache by pasting back their saved key, without
 * having to rotate (which would invalidate other devices).
 */
export async function verifyMyKey(candidate: string, key?: string): Promise<{ matches: boolean; handle: string }> {
  const path = '/api/auth/verify-key';
  const url = key ? buildUrl(path, key) : (API_URL ? `${API_URL}${path}` : path);
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret_key: candidate }),
  });
  if (!res.ok) throw new Error(`verify_failed_${res.status}`);
  return res.json();
}

/**
 * Rotate the user's secret_key (MCP credential) on demand. Old key enters
 * 7-day grace; user copies the plaintext from response and updates their
 * CC / Codex / mobile MCP config. Auth via cookie or ?key=.
 */
export async function rotateMcpCredential(key?: string): Promise<{ secret_key: string; grace_until: number; warning: string }> {
  const path = '/api/auth/mcp-credential';
  const url = key
    ? buildUrl(path, key)
    : (API_URL ? `${API_URL}${path}` : path);
  const res = await apiFetch(url, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`mcp_credential_rotate_failed_${res.status}`);
  return res.json();
}

/** Revoke current session cookie + DB row. */
export async function deleteSession(): Promise<void> {
  const url = API_URL ? `${API_URL}/api/auth/session` : '/api/auth/session';
  await apiFetch(url, { method: 'DELETE', credentials: 'include' }).catch(() => {});
}

/**
 * Fetch /api/me using ONLY the session cookie (no ?key=). Used after
 * Lark login (cookie was set by callback) to bootstrap the dashboard.
 * Returns null on 401.
 */
export async function getMeViaCookie(): Promise<any | null> {
  const url = API_URL ? `${API_URL}/api/me` : '/api/me';
  const res = await apiFetch(url, { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

// ── Lark direct registration (M2a.5c) ──

export interface LarkPendingRegistration {
  openId: string;
  name?: string;
  avatarUrl?: string;
  expiresAt: number;
}

export async function getLarkRegisterPending(token: string): Promise<LarkPendingRegistration | null> {
  const url = API_URL ? `${API_URL}/api/lark/register-pending?token=${encodeURIComponent(token)}` : `/api/lark/register-pending?token=${encodeURIComponent(token)}`;
  const res = await apiFetch(url);
  if (!res.ok) return null;
  return res.json();
}

export async function completeLarkRegistration(opts: { pending: string; handle: string; invite_code: string }): Promise<{ handle: string; teamId: string; secret_key: string; warning: string }> {
  const url = API_URL ? `${API_URL}/api/lark/register-complete` : '/api/lark/register-complete';
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'register_failed');
  return data;
}

// ── Lark Phase 0 ──

export async function larkAuthorize(key: string): Promise<{ authorize_url: string }> {
  const res = await apiFetch(buildUrl('/api/lark/authorize', key), { method: 'POST' });
  if (!res.ok) throw new Error(`lark_authorize_failed_${res.status}`);
  return res.json();
}

export async function larkLogin(opts?: { callerKey?: string; inviteCode?: string }): Promise<{ authorize_url: string }> {
  const url = API_URL ? `${API_URL}/api/lark/login` : '/api/lark/login';
  const body: Record<string, string> = {};
  if (opts?.callerKey) body.caller_key = opts.callerKey;
  if (opts?.inviteCode) body.invite_code = opts.inviteCode;
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`lark_login_failed_${res.status}`);
  return res.json();
}

export async function larkUnbind(key: string): Promise<{ ok: true }> {
  const res = await apiFetch(buildUrl('/api/lark/binding', key), { method: 'DELETE' });
  if (!res.ok) throw new Error(`lark_unbind_failed_${res.status}`);
  return res.json();
}

// ── M2b: Lark chat ↔ channel bindings ──

export type SummaryStyle = 'person' | 'topic' | 'free';

export interface LarkChatBinding {
  chatId: string;
  channelId: string;
  teamId: string;
  boundBy: string | null;
  boundAt: number;
  chatName: string;
  archiveChannelId?: string;
  lastSummaryTs?: number;
  lastSummaryAt?: number;
  pushEnabled?: boolean;
  watchEnabled?: boolean;
  summaryStyle?: SummaryStyle;
}

export interface LarkJoinedChat {
  chat_id: string;
  name: string;
}

export class LarkBindingsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getLarkBindings(channelId: string): Promise<LarkChatBinding[]> {
  const res = await fetch(`/api/lark/bindings?channel_id=${encodeURIComponent(channelId)}`, { credentials: 'include' });
  if (!res.ok) throw new LarkBindingsError(res.status, `getLarkBindings failed: ${res.status}`);
  const data = await res.json();
  return data.bindings ?? [];
}

export async function listJoinedLarkChats(): Promise<LarkJoinedChat[]> {
  const res = await fetch('/api/lark/chats/joined', { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error(`listJoinedLarkChats failed: ${res.status}`);
  const data = await res.json();
  return data.chats ?? [];
}

export async function createLarkBinding(input: { chatId: string; channelId: string; chatName: string }): Promise<LarkChatBinding> {
  const res = await fetch('/api/lark/bindings', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: input.chatId, channel_id: input.channelId, chat_name: input.chatName }),
  });
  if (!res.ok) throw new Error(`createLarkBinding failed: ${res.status}`);
  const data = await res.json();
  return data.binding;
}

export async function deleteLarkBinding(chatId: string): Promise<void> {
  const res = await fetch(`/api/lark/bindings/${encodeURIComponent(chatId)}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok && res.status !== 204) throw new Error(`deleteLarkBinding failed: ${res.status}`);
}

async function patchLarkBinding(chatId: string, body: object): Promise<LarkChatBinding> {
  const res = await fetch(`/api/lark/bindings/${encodeURIComponent(chatId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`patchLarkBinding failed: ${res.status}`);
  const data = await res.json();
  return data.binding;
}

export async function setLarkBindingPushEnabled(chatId: string, pushEnabled: boolean): Promise<LarkChatBinding> {
  return patchLarkBinding(chatId, { pushEnabled });
}

export async function setLarkBindingWatchEnabled(chatId: string, watchEnabled: boolean): Promise<LarkChatBinding> {
  return patchLarkBinding(chatId, { watchEnabled });
}

export async function setLarkBindingArchive(chatId: string, archiveChannelId: string | null): Promise<LarkChatBinding> {
  return patchLarkBinding(chatId, { archiveChannelId });
}

export async function setLarkBindingSummaryStyle(chatId: string, summaryStyle: SummaryStyle): Promise<LarkChatBinding> {
  return patchLarkBinding(chatId, { summaryStyle });
}

// ── M3b: periodic auto-summary ────────────────────────────────
export type LarkAutoCadence = 'daily' | 'weekly' | 'hourly:6' | 'hourly:12';

export interface LarkAutoSummaryPrefs {
  chatId: string;
  enabled: boolean;
  cadence: LarkAutoCadence;
  fireHour: number;  // 0-23 Asia/Shanghai
  lastRunAt: number | null;
}

export async function getLarkAutoSummary(chatId: string): Promise<LarkAutoSummaryPrefs> {
  const res = await fetch(`/api/lark/bindings/${encodeURIComponent(chatId)}/auto-summary`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`getLarkAutoSummary failed: ${res.status}`);
  const data = await res.json();
  return data.prefs;
}

export async function setLarkAutoSummary(
  chatId: string,
  prefs: Partial<Omit<LarkAutoSummaryPrefs, 'chatId' | 'lastRunAt'>>,
): Promise<LarkAutoSummaryPrefs> {
  const res = await fetch(`/api/lark/bindings/${encodeURIComponent(chatId)}/auto-summary`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error(`setLarkAutoSummary failed: ${res.status}`);
  const data = await res.json();
  return data.prefs;
}

export interface LarkWatchObservation {
  id: number;
  chatId: string;
  ranAt: number;
  observations: { kind: string; content: string; suggested_action?: string }[];
}

export async function getLarkWatchObservations(chatId: string, limit = 20): Promise<LarkWatchObservation[]> {
  const res = await fetch(`/api/lark/watch-observations?chat_id=${encodeURIComponent(chatId)}&limit=${limit}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`getLarkWatchObservations failed: ${res.status}`);
  const data = await res.json();
  return data.observations ?? [];
}

export interface EntryReaction {
  emojiType: string;  // raw Lark emoji_type, e.g. 'THUMBSUP'
  count: number;
}

export async function getEntryReactions(entryId: string): Promise<EntryReaction[]> {
  const res = await fetch(`/api/entries/${encodeURIComponent(entryId)}/reactions`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`getEntryReactions failed: ${res.status}`);
  const data = await res.json();
  return data.reactions ?? [];
}

// ── User preferences (CLI v1: sync_mode + preview_mode) ──

export interface SyncPreferences {
  sync_mode: 'active' | 'passive';
  preview_mode: 'always' | 'never';
  privacy_strip_custom: string[];
}

export async function getUserPreferences(): Promise<SyncPreferences> {
  const r = await fetch('/api/users/me/preferences', { credentials: 'include' });
  if (!r.ok) throw new Error(`getUserPreferences failed: ${r.status}`);
  return r.json();
}

export async function updateUserPreferences(patch: Partial<SyncPreferences>): Promise<SyncPreferences> {
  const r = await fetch('/api/users/me/preferences', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updateUserPreferences failed: ${r.status}`);
  return r.json();
}

export interface NotificationPrefs {
  mention: boolean;
  comment: boolean;
  reply: boolean;
  digest: boolean;
  larkBound: boolean;
}

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const r = await fetch('/api/users/me/notification-prefs', { credentials: 'include' });
  if (!r.ok) throw new Error(`getNotificationPrefs failed: ${r.status}`);
  return r.json();
}

export async function updateNotificationPrefs(
  patch: Partial<Omit<NotificationPrefs, 'larkBound'>>,
): Promise<NotificationPrefs> {
  const r = await fetch('/api/users/me/notification-prefs', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updateNotificationPrefs failed: ${r.status}`);
  return r.json();
}
