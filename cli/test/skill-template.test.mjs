import { describe, it, expect } from 'vitest';
import { extractVersion, extractContentHash, computeContentHash, wrapForCodex, extractCodexBlock, MARKER_BEGIN, MARKER_END } from '../src/skill-template.mjs';

describe('extractVersion', () => {
  it('reads version comment', () => {
    const md = '<!-- skill-version: 1.2.3 -->\n---\nname: x\n---\n';
    expect(extractVersion(md)).toBe('1.2.3');
  });
  it('returns null when missing', () => {
    expect(extractVersion('---\nname: x\n---\n')).toBeNull();
  });
});

describe('extractContentHash', () => {
  it('reads hash comment', () => {
    const md = '<!-- skill-content-hash: sha256:abc -->\nbody';
    expect(extractContentHash(md)).toBe('sha256:abc');
  });
});

describe('computeContentHash', () => {
  it('strips hash line before hashing', () => {
    const a = '<!-- skill-version: 1.0.0 -->\n<!-- skill-content-hash: sha256:foo -->\nbody';
    const b = '<!-- skill-version: 1.0.0 -->\n<!-- skill-content-hash: sha256:bar -->\nbody';
    expect(computeContentHash(a)).toBe(computeContentHash(b));
  });
});

describe('Codex marker', () => {
  it('wraps and extracts', () => {
    const inner = '<!-- skill-version: 1.0.0 -->\nbody';
    const wrapped = wrapForCodex(inner, '1.0.0', 'sha256:abc');
    expect(wrapped).toContain(MARKER_BEGIN('1.0.0', 'sha256:abc'));
    expect(wrapped).toContain(MARKER_END);
    const file = `previous content\n${wrapped}\nlater content`;
    expect(extractCodexBlock(file)).toEqual({ before: 'previous content\n', inner: wrapped, after: '\nlater content' });
  });
  it('extractCodexBlock returns null when markers missing', () => {
    expect(extractCodexBlock('no markers here')).toBeNull();
  });
});
