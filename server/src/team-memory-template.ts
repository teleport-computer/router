/**
 * Team Memory — static markdown that admins maintain to give CC team-wide
 * context (people / tech stack / conventions / long-term goals).
 *
 * The EXAMPLE below is shown as reference (collapsible "show example" in
 * the web UI; placeholder hint in the textarea). The textarea itself
 * starts EMPTY — empty content unambiguously means "Memory not configured
 * yet". This is cleaner than the previous "pre-fill template + check
 * byte-equality" approach (which couldn't be properly internationalized
 * and had ambiguous "template-only" cases).
 */

export const TEAM_MEMORY_EXAMPLE = `# Team Memory

> A live snapshot of the team's current state. Loaded by CC at session start. Keep it concise (< 8000 chars).

## Company / Team
We are... (one-line description: what the team does, size)

## People
- @hx — role / area of responsibility
- @andrew — role / area of responsibility

## Tech Stack
- Frontend: Next.js / Tailwind / ...
- Backend: Node / Postgres / ...
- Deploy: ...

## Long-term Goals
2026 Q2: ...
2026 full year: ...

## Conventions
- Code style: ...
- Naming: ...
- PR / Review process: ...
`;

export const TEAM_MEMORY_CHAR_LIMIT = 8000;

/**
 * True when content is empty / whitespace only.
 * Used to gate MCP prompts/list — we do NOT want CC to be told the team
 * has Memory configured when there's nothing in it.
 */
export function isMemoryEmpty(content: string): boolean {
  return content.trim().length === 0;
}

// Back-compat alias — the previous name was misleading once we dropped the
// "pre-fill the template" behavior. Kept so internal callers don't all need
// updating in lockstep.
export const isTemplateOnly = isMemoryEmpty;

/**
 * Memory section — a markdown chunk between two `## ` headings.
 * Used by the web Memory editor (and was previously used by the
 * lazy-load `router_memory_sections / router_memory_section` MCP tools,
 * which were removed in 2026-05-12 when Memory switched to full-text
 * inject via MCP `instructions`).
 */
export interface MemorySection {
  name: string;       // text after `## `, trimmed
  body: string;       // everything between this heading and the next, trimmed
  summary: string;    // first non-empty body line (truncated to 120 chars), for the listing
}

/**
 * Split markdown into top-level sections by `## ` headings. Anything before
 * the first `## ` (typically the H1 title and intro blockquote) is dropped.
 * Headings deeper than H2 stay inside the parent section.
 */
export function parseMemorySections(content: string): MemorySection[] {
  const lines = content.split('\n');
  const sections: MemorySection[] = [];
  let currentName: string | null = null;
  let currentBody: string[] = [];

  const flush = (): void => {
    if (currentName === null) return;
    const body = currentBody.join('\n').trim();
    const firstLine = body.split('\n').find(l => l.trim().length > 0)?.trim() ?? '';
    const summary = firstLine.length > 120 ? firstLine.slice(0, 120) + '…' : firstLine;
    sections.push({ name: currentName, body, summary });
  };

  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      flush();
      currentName = m[1].trim();
      currentBody = [];
    } else if (currentName !== null) {
      currentBody.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * Find a section by name. Case-insensitive, also matches `## # <name>` or
 * `<name>` typed by user. Returns null if no match.
 */
export function findMemorySection(content: string, query: string): MemorySection | null {
  const target = query.replace(/^#+\s*/, '').trim().toLowerCase();
  const sections = parseMemorySections(content);
  return sections.find(s => s.name.toLowerCase() === target) ?? null;
}
