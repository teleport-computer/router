import type { Storage, RouterUser, Channel } from './storage.js';
import { userToPreferences } from './cli-preferences.js';

export interface ContextResponse {
  version: '1.0';
  sync_mode: 'active' | 'passive';
  preview_mode: 'always' | 'never';
  sync_triggers: string[];
  tag_rules: string;
  preset_tags: Array<{ name: string; description: string }>;
  channels: Array<{ id: string; name: string; skill: string; needs_second_call: boolean }>;
  privacy_strip_patterns: string[];
  skill_template_version: string;
  last_updated: number;
}

const SYNC_TRIGGERS = [
  'sync', 'save to router', 'push to router', 'log this', 'record this',
  '同步', '记一下', '记录一下', '保存到 router', '推到 router', '发到 router', '存到 router',
];

const TAG_RULES = `Reuse over invent. 1-5 tags. Prefer preset tags from the list. When unsure, pick semantically close existing tags rather than creating new ones.`;

const DEFAULT_PRIVACY_PATTERNS = [
  'sk-[A-Za-z0-9_-]{16,}',
  '(?i)password\\s*[:=]\\s*\\S+',
  '(?i)token\\s*[:=]\\s*\\S+',
  '/Users/[A-Za-z0-9_.-]+',
];

interface CacheEntry { value: ContextResponse; expiresAt: number; }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

const SKILL_TEMPLATE_VERSION = '1.0.14';
const RECENT_DAYS = 30;

export function clearContextCache(): void { cache.clear(); }

export async function buildContext(storage: Storage, user: RouterUser, now: number = Date.now()): Promise<ContextResponse> {
  const cached = cache.get(user.handle);
  if (cached && cached.expiresAt > now) return cached.value;

  const subscribed = await storage.getSubscribedChannels(user.handle);
  const all = await storage.listChannels(user.teamId);
  const recentCutoff = now - RECENT_DAYS * 86400_000;
  const recentEntries = await storage.getEntriesSince(user.teamId, recentCutoff);
  const activeChannelIds = new Set<string>();
  for (const e of recentEntries) {
    if (e.channel) activeChannelIds.add(e.channel);
    for (const t of e.to ?? []) if (t.startsWith('#')) activeChannelIds.add(t.slice(1));
  }
  const visible = new Map<string, Channel>();
  for (const c of subscribed) visible.set(c.id, c);
  for (const c of all) if (activeChannelIds.has(c.id)) visible.set(c.id, c);

  const presetTags = await storage.getPresetTags();

  const value: ContextResponse = {
    version: '1.0',
    sync_mode: userToPreferences(user).sync_mode,
    preview_mode: userToPreferences(user).preview_mode,
    sync_triggers: SYNC_TRIGGERS,
    tag_rules: TAG_RULES,
    preset_tags: presetTags.map(t => ({ name: t.name, description: t.description ?? '' })),
    channels: Array.from(visible.values()).map(c => ({
      id: c.id,
      name: c.name,
      skill: summarizeChannelSkills(c),
      needs_second_call: c.skills.some(s => s.exposeAs === 'prewrite'),
    })),
    privacy_strip_patterns: [...DEFAULT_PRIVACY_PATTERNS, ...(user.privacyStripCustom ?? [])],
    skill_template_version: SKILL_TEMPLATE_VERSION,
    last_updated: Math.floor(now / 1000),
  };
  cache.set(user.handle, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

function summarizeChannelSkills(c: Channel): string {
  const lines = c.skills
    .filter(s => s.exposeAs === 'context' || s.exposeAs === 'prewrite' || s.exposeAs === 'both')
    .map(s => `- ${s.name}: ${s.description ?? ''}${s.instructions ? '\n  ' + s.instructions.split('\n').join('\n  ') : ''}`);
  return lines.join('\n');
}
