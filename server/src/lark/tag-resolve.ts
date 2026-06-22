import type { Storage } from '../storage.js';

export interface TeamTag {
  id: string;
  name: string;
}

/** Narrowest storage surface listTeamTags needs — handy for handlers that pass a Pick<Storage>. */
export type TagListingStorage = Pick<Storage, 'listTagConfigs' | 'getTagStats'>;

/**
 * All tags a Lark UI may surface for a team — merge of explicit `tag_configs`
 * rows and tags discovered in the team's entries' `tags` arrays. The web tags
 * page (/api/tags) returns the entry-aggregated set, so this helper keeps the
 * bot's dropdowns aligned with what users see there.
 */
export async function listTeamTags(storage: TagListingStorage, teamId: string): Promise<TeamTag[]> {
  const [configs, stats] = await Promise.all([
    storage.listTagConfigs(teamId),
    storage.getTagStats(teamId),
  ]);
  const byId = new Map<string, TeamTag>();
  for (const c of configs) byId.set(c.tag, { id: c.tag, name: c.name || c.tag });
  for (const s of stats) if (!byId.has(s.tag)) byId.set(s.tag, { id: s.tag, name: s.tag });
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export interface ResolvedTeamTag {
  id: string;
  teamId: string;
  name: string;
}

/**
 * Resolve a user-picked or user-typed tag to a `tag_configs` row in `teamId`.
 *
 * If the tag has no config row yet but appears in at least one entry of the
 * team, upsert an empty config so downstream code (chat bindings, archive
 * targets, etc.) has a real channel record to point at. Returns null when the
 * tag is unknown in this team entirely.
 *
 * `createdByHandle` is recorded as `created_by` only when a new row is
 * inserted; existing rows keep their original creator.
 */
export async function resolveTeamTag(
  storage: Storage,
  teamId: string,
  createdByHandle: string,
  tag: string,
): Promise<ResolvedTeamTag | null> {
  const cfg = await storage.getTagConfig(teamId, tag);
  if (cfg) return { id: cfg.tag, teamId: cfg.teamId, name: cfg.name || cfg.tag };
  const stats = await storage.getTagStats(teamId);
  if (!stats.some(s => s.tag === tag)) return null;
  const created = await storage.upsertTagConfig(teamId, tag, {
    name: tag,
    createdBy: createdByHandle,
    skills: [],
    subscribers: [],
  });
  return { id: created.tag, teamId: created.teamId, name: created.name || created.tag };
}
