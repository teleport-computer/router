import { describe, it, expect } from 'vitest';
import { excludeAutoDigest, extractDigestSummary } from './digest-filter.js';

describe('excludeAutoDigest', () => {
  it('removes entries tagged auto:digest', () => {
    const entries = [
      { id: 'a', tags: ['wip'] },
      { id: 'b', tags: ['auto:digest', 'channel:foo', 'weekly'] },
      { id: 'c', tags: [] },
      { id: 'd', tags: ['auto:digest'] },
    ] as any[];
    const out = excludeAutoDigest(entries);
    expect(out.map(e => e.id)).toEqual(['a', 'c']);
  });

  it('treats missing tags array as no tags (keeps entry)', () => {
    const entries = [{ id: 'a' }] as any[];
    expect(excludeAutoDigest(entries)).toHaveLength(1);
  });

  it('does not remove entries that only have the legacy "digest" tag', () => {
    // Legacy entries are out-of-scope per spec; they age out naturally.
    const entries = [{ id: 'legacy', tags: ['digest'] }] as any[];
    expect(excludeAutoDigest(entries)).toHaveLength(1);
  });

  it('handles empty input', () => {
    expect(excludeAutoDigest([])).toEqual([]);
  });

  it('matches auto:digest regardless of tag position', () => {
    const entries = [
      { id: 'first', tags: ['auto:digest', 'x'] },
      { id: 'middle', tags: ['x', 'auto:digest', 'y'] },
      { id: 'last', tags: ['x', 'auto:digest'] },
      { id: 'kept', tags: ['x', 'y'] },
    ] as any[];
    expect(excludeAutoDigest(entries).map(e => e.id)).toEqual(['kept']);
  });
});

describe('extractDigestSummary', () => {
  const FALLBACK = 'Weekly digest for #x — 4 entries over 7 days.';

  it('extracts the ### Summary paragraph from an English digest', () => {
    const content = [
      '## Weekly Digest — #feedling',
      '',
      '### Key Decisions',
      '- shipped X',
      '',
      '### Summary',
      'The team focused on iOS app simplification and backend MCP refactors. Pushes scheduled to land next week.',
    ].join('\n');
    expect(extractDigestSummary(content, FALLBACK)).toMatch(/^The team focused/);
  });

  it('extracts Chinese 总结 paragraph', () => {
    const content = [
      '## 每周摘要 — #feedling',
      '',
      '### 关键决策',
      '- 决定 X',
      '',
      '### 总结',
      '本周团队专注于 iOS 应用的简化与核心体验的重新设计，同时推进了后端 MCP 服务的大规模架构迭代。下周关注推送 bug 修复。',
    ].join('\n');
    expect(extractDigestSummary(content, FALLBACK)).toMatch(/^本周团队专注于/);
  });

  it('extracts Chinese 摘要 paragraph', () => {
    const content = '## 周报\n\n### 摘要\n本周完成了 X、Y、Z 三项工作，下周计划推进 A。' + 'A'.repeat(30);
    expect(extractDigestSummary(content, FALLBACK)).toMatch(/^本周完成了/);
  });

  it('stops at the next heading when ### Summary is mid-document', () => {
    const content = [
      '## Header',
      '',
      '### Summary',
      'First paragraph that is the actual TL;DR of this digest doc.',
      '',
      '### Next Section',
      'This should NOT be part of the captured summary.',
    ].join('\n');
    const result = extractDigestSummary(content, FALLBACK);
    expect(result).toContain('First paragraph');
    expect(result).not.toContain('Next Section');
    expect(result).not.toContain('NOT be part');
  });

  it('falls back when no Summary section is present', () => {
    const content = '## Just a header\n\nNo summary section here at all, just freeform text.';
    expect(extractDigestSummary(content, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back when summary section is too short to be meaningful', () => {
    const content = '## Header\n\n### Summary\nShort.';
    expect(extractDigestSummary(content, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back when extracted summary would exceed 800 chars (regex overshoot)', () => {
    const big = 'x'.repeat(900);
    const content = `## Header\n\n### Summary\n${big}`;
    expect(extractDigestSummary(content, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back on empty content', () => {
    expect(extractDigestSummary('', FALLBACK)).toBe(FALLBACK);
  });
});
