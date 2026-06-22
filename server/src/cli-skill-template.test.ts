import { describe, it, expect, beforeEach } from 'vitest';
import { buildSkillTemplate, clearSkillTemplateCache } from './cli-skill-template.js';

const LARK_URL = 'https://router.feedling.app';
const SHAPE_URL = 'https://shaperotator.teleport.computer';

describe('buildSkillTemplate', () => {
  beforeEach(() => clearSkillTemplateCache());

  it('returns version, hash, content', () => {
    const t = buildSkillTemplate({ publicUrl: LARK_URL });
    expect(t.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(t.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(t.content).toContain('name: router-sync');
    expect(t.content).toContain(t.hash);
  });

  it('hash is stable across calls for the same publicUrl', () => {
    const t1 = buildSkillTemplate({ publicUrl: LARK_URL });
    clearSkillTemplateCache();
    const t2 = buildSkillTemplate({ publicUrl: LARK_URL });
    expect(t1.hash).toBe(t2.hash);
  });

  it('substitutes {{ROUTER_BASE_URL}} into the served content', () => {
    const t = buildSkillTemplate({ publicUrl: SHAPE_URL });
    expect(t.content).toContain(`${SHAPE_URL}/entry?id=<id>`);
    expect(t.content).not.toContain('{{ROUTER_BASE_URL}}');
    expect(t.content).not.toContain('router.feedling.app');
  });

  it('different publicUrls produce different hashes (per-instance)', () => {
    const lark = buildSkillTemplate({ publicUrl: LARK_URL });
    const shape = buildSkillTemplate({ publicUrl: SHAPE_URL });
    expect(lark.hash).not.toBe(shape.hash);
  });

  it('strips trailing slash from publicUrl', () => {
    const t = buildSkillTemplate({ publicUrl: `${SHAPE_URL}/` });
    expect(t.content).toContain(`${SHAPE_URL}/entry?id=<id>`);
    expect(t.content).not.toContain(`${SHAPE_URL}//entry`);
  });

  it('substitutes shared instruction blocks (no placeholder leak)', () => {
    const t = buildSkillTemplate({ publicUrl: LARK_URL });
    // None of the {{SHARED_*}} placeholders should remain in the served content.
    expect(t.content).not.toContain('{{SHARED_TRIGGERS}}');
    expect(t.content).not.toContain('{{SHARED_TAG_RULES}}');
    expect(t.content).not.toContain('{{SHARED_LANGUAGE_RULE}}');
    // And the actual shared content should be present.
    expect(t.content).toContain('MANDATORY SELF-CHECK');
    expect(t.content).toContain('STRONG TRIGGER PHRASES');
    expect(t.content).toContain('REUSE over invent');
  });
});
