import { createHash } from 'crypto';

export const MARKER_BEGIN_RE = /<!--\s*BEGIN router-sync\s+v[^\s]+\s+hash:[^\s]+\s+\(managed by teleport-router CLI\)\s*-->/;
export const MARKER_END_RE = /<!--\s*END router-sync\s*-->/;
export const MARKER_BEGIN = (v, h) => `<!-- BEGIN router-sync v${v} hash:${h} (managed by teleport-router CLI) -->`;
export const MARKER_END = `<!-- END router-sync -->`;

export function extractVersion(md) {
  const m = md.match(/<!--\s*skill-version:\s*([^\s]+)\s*-->/);
  return m ? m[1] : null;
}

export function extractContentHash(md) {
  const m = md.match(/<!--\s*skill-content-hash:\s*([^\s]+)\s*-->/);
  return m ? m[1] : null;
}

export function computeContentHash(md) {
  const stripped = md.replace(/<!--\s*skill-content-hash:\s*[^\s]+\s*-->\n?/, '');
  return 'sha256:' + createHash('sha256').update(stripped).digest('hex');
}

export function wrapForCodex(content, version, hash) {
  return `${MARKER_BEGIN(version, hash)}\n${content}\n${MARKER_END}`;
}

export function extractCodexBlock(fileContent) {
  const beginMatch = fileContent.match(MARKER_BEGIN_RE);
  const endMatch = fileContent.match(MARKER_END_RE);
  if (!beginMatch || !endMatch) return null;
  const beginIdx = beginMatch.index;
  const endIdx = endMatch.index + endMatch[0].length;
  return {
    before: fileContent.slice(0, beginIdx),
    inner: fileContent.slice(beginIdx, endIdx),
    after: fileContent.slice(endIdx),
  };
}
