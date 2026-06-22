import type { Storage, PresetTag } from './storage.js';

const INITIAL_PRESET_TAGS: Array<{ name: string; description: string }> = [
  // Content Type
  { name: 'update', description: 'Daily work progress' },
  { name: 'release', description: 'Version release / deployment record' },
  { name: 'feature', description: 'New feature / capability added' },
  { name: 'bugfix', description: 'Bug fix record' },
  { name: 'idea', description: 'Ideas / proposals' },
  { name: 'decision', description: 'Decision record' },
  { name: 'question', description: 'Question / needs discussion' },
  { name: 'feedback', description: 'Product feedback' },
  { name: 'incident', description: 'Production incident' },
  { name: 'meeting-note', description: 'Meeting notes' },
  { name: 'announcement', description: 'Announcements' },
  { name: 'spec', description: 'Requirements / design docs' },
  { name: 'research', description: 'Research (competitors, tech evaluation)' },
  { name: 'learning', description: 'Lessons learned / tech sharing' },
  { name: 'retro', description: 'Retrospective' },
  { name: 'debt', description: 'Tech debt / design debt' },
  { name: 'refactor', description: 'Refactoring record' },
  { name: 'metric', description: 'Data metrics / analytics' },
  { name: 'cost', description: 'Expenses / billing' },
  { name: 'security', description: 'Security related' },
  { name: 'dependency', description: 'Dependency changes / upgrades' },
  { name: 'milestone', description: 'Milestone events' },
  // Status / Signal
  { name: 'blocker', description: 'Blocking progress' },
  { name: 'urgent', description: 'Urgent' },
  { name: 'fyi', description: 'For your information, no action needed' },
  { name: 'needs-review', description: 'Needs review' },
  { name: 'wip', description: 'Work in progress' },
  { name: 'shipped', description: 'Shipped / live' },
  // Design
  { name: 'design', description: 'Design mockups / visual proposals' },
  { name: 'prototype', description: 'Prototypes / interaction drafts' },
  { name: 'design-review', description: 'Design review' },
  { name: 'asset', description: 'Asset delivery (icons, brand resources)' },
  { name: 'motion', description: 'Motion / animation' },
  { name: 'design-system', description: 'Design system / component library' },
  { name: 'ux-issue', description: 'UX problems' },
  { name: 'copy', description: 'Copywriting / UX writing' },
  // Platform / Stack
  { name: 'frontend', description: 'Web frontend' },
  { name: 'backend', description: 'Backend / server' },
  { name: 'ios', description: 'iOS client' },
  { name: 'android', description: 'Android client' },
  { name: 'mobile', description: 'Mobile (cross-platform)' },
  { name: 'api', description: 'API related' },
  { name: 'infra', description: 'Infrastructure / DevOps / CI/CD' },
  { name: 'database', description: 'Database related' },
  // Operations / Product
  { name: 'product', description: 'Product direction / strategy' },
  { name: 'experiment', description: 'A/B tests / growth experiments' },
  { name: 'marketing', description: 'Promotion / campaigns' },
  { name: 'user-voice', description: 'User feedback verbatim' },
  { name: 'onboarding', description: 'New user onboarding / team onboarding' },
  // System
  { name: 'auto:digest', description: 'System-generated digest' },
];

// Tags that were previously preset but have since been removed from the
// INITIAL_PRESET_TAGS list. We explicitly delete them on startup so the seed
// remains the source of truth. Only list tags here that are safe to remove
// (i.e. not in heavy use; entries using them will keep the tag as "custom").
const DEPRECATED_PRESET_TAGS: string[] = ['changelog'];

/** Seed preset tags — skips any that already exist. Safe to call on every startup. */
export async function seedPresetTags(storage: Storage): Promise<number> {
  const existing = await storage.getPresetTags();
  const existingNames = new Set(existing.map(t => t.name));
  let added = 0;
  for (const { name, description } of INITIAL_PRESET_TAGS) {
    if (existingNames.has(name)) continue;
    await storage.addPresetTag({ name, description, createdAt: Date.now() });
    added++;
  }
  // Remove deprecated preset tags
  for (const name of DEPRECATED_PRESET_TAGS) {
    if (existingNames.has(name)) {
      await storage.deletePresetTag(name);
    }
  }
  return added;
}
