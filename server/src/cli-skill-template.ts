import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SHARED_TRIGGERS, SHARED_TAG_RULES, SHARED_LANGUAGE_RULE } from './lib/router-sync-shared.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface SkillTemplateResponse {
  version: string;
  hash: string;
  content: string;
}

// Cache is keyed by publicUrl: each Router instance serves a different URL
// (Lark = router.feedling.app, Shape = https://shaperotator.teleport.computer / future
// shape.feedling.app), and the skill content references it for the "Link:"
// hint Claude posts back to the user. Per-process there's typically one
// publicUrl, but keying explicitly keeps tests + multi-instance servers
// honest.
const cache = new Map<string, SkillTemplateResponse>();

function readTemplateFile(): string {
  const candidates = [
    join(__dirname, '..', '..', 'cli-skill-template', 'router-sync.md'),
    join(__dirname, '..', '..', '..', 'cli-skill-template', 'router-sync.md'),
  ];
  for (const p of candidates) {
    try { return readFileSync(p, 'utf-8'); } catch {}
  }
  throw new Error('skill template file not found');
}

export function buildSkillTemplate(opts: { publicUrl: string }): SkillTemplateResponse {
  const publicUrl = opts.publicUrl.replace(/\/$/, '');
  const hit = cache.get(publicUrl);
  if (hit) return hit;
  // Substitute placeholders before hashing — the hash therefore captures
  // both the per-instance baseurl and the current shared instruction blocks.
  // Two instances return different (version, hash, content) triples for the
  // same skill-version string, which is fine: the CLI version-check uses the
  // version field, and clients only ever talk to one server at a time. When
  // the shared blocks change in router-sync-shared.ts, bump the skill-version
  // in the .md file too so existing CLI users re-pull the new content.
  const raw = readTemplateFile()
    .replace(/\{\{ROUTER_BASE_URL\}\}/g, publicUrl)
    .replace(/\{\{SHARED_TRIGGERS\}\}/g, SHARED_TRIGGERS)
    .replace(/\{\{SHARED_TAG_RULES\}\}/g, SHARED_TAG_RULES)
    .replace(/\{\{SHARED_LANGUAGE_RULE\}\}/g, SHARED_LANGUAGE_RULE);
  const versionMatch = raw.match(/<!--\s*skill-version:\s*([^\s]+)\s*-->/);
  const version = versionMatch?.[1] ?? '0.0.0';
  // Hash everything EXCEPT the hash comment line itself (so the file with hash and without are identical-hash).
  const stripped = raw.replace(/<!--\s*skill-content-hash:\s*[^\s]+\s*-->\n?/, '');
  const hash = 'sha256:' + createHash('sha256').update(stripped).digest('hex');
  // Replace AUTO placeholder with computed hash for the served content.
  const content = raw.replace(/<!--\s*skill-content-hash:\s*AUTO\s*-->/, `<!-- skill-content-hash: ${hash} -->`);
  const response: SkillTemplateResponse = { version, hash, content };
  cache.set(publicUrl, response);
  return response;
}

export function clearSkillTemplateCache(): void { cache.clear(); }
