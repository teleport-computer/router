import { describe, it, expect } from 'vitest';
import { TEAM_MEMORY_EXAMPLE, TEAM_MEMORY_CHAR_LIMIT, isMemoryEmpty, isTemplateOnly, parseMemorySections, findMemorySection } from './team-memory-template.js';

describe('isMemoryEmpty', () => {
  it('returns true for empty / whitespace-only content', () => {
    expect(isMemoryEmpty('')).toBe(true);
    expect(isMemoryEmpty('   ')).toBe(true);
    expect(isMemoryEmpty('\n\n\t')).toBe(true);
  });

  it('returns false for any non-whitespace content (even one char)', () => {
    expect(isMemoryEmpty('x')).toBe(false);
    expect(isMemoryEmpty('hi')).toBe(false);
    expect(isMemoryEmpty(TEAM_MEMORY_EXAMPLE)).toBe(false);
    expect(isMemoryEmpty('Our team builds X.')).toBe(false);
  });

  it('isTemplateOnly is a back-compat alias for isMemoryEmpty', () => {
    expect(isTemplateOnly).toBe(isMemoryEmpty);
  });
});

describe('TEAM_MEMORY_CHAR_LIMIT', () => {
  it('is 8000', () => {
    expect(TEAM_MEMORY_CHAR_LIMIT).toBe(8000);
  });

  it('example fits comfortably under the limit', () => {
    expect(TEAM_MEMORY_EXAMPLE.length).toBeLessThan(TEAM_MEMORY_CHAR_LIMIT);
  });
});

describe('parseMemorySections', () => {
  const sample = `# Team Memory

> some intro text — gets dropped (before first ## )

## Company / Team
We are Acme. 3 people.

## People
- @hx — full-stack
- @andrew — frontend lead

## Tech Stack
- Frontend: Next.js + Zustand
- Backend: Node + Postgres

### Sub-heading inside Tech Stack
extra detail

## Empty Section
`;

  it('splits by ## and drops content before first heading', () => {
    const sections = parseMemorySections(sample);
    expect(sections.map(s => s.name)).toEqual([
      'Company / Team', 'People', 'Tech Stack', 'Empty Section',
    ]);
  });

  it('captures full body up to next ## (sub-headings stay inside parent)', () => {
    const sections = parseMemorySections(sample);
    const stack = sections.find(s => s.name === 'Tech Stack')!;
    expect(stack.body).toContain('Frontend: Next.js + Zustand');
    expect(stack.body).toContain('### Sub-heading inside Tech Stack');
    expect(stack.body).toContain('extra detail');
  });

  it('extracts first non-empty line as summary', () => {
    const sections = parseMemorySections(sample);
    expect(sections.find(s => s.name === 'Company / Team')!.summary).toBe('We are Acme. 3 people.');
    expect(sections.find(s => s.name === 'People')!.summary).toBe('- @hx — full-stack');
  });

  it('truncates long summary to 120 chars', () => {
    const long = 'x'.repeat(200);
    const sections = parseMemorySections(`## S\n${long}`);
    expect(sections[0].summary).toMatch(/^x{120}…$/);
  });

  it('returns empty for content with no ## headings', () => {
    expect(parseMemorySections('just plain text')).toEqual([]);
    expect(parseMemorySections('# Only an H1\nbody')).toEqual([]);
  });

  it('handles empty body gracefully', () => {
    const sections = parseMemorySections(sample);
    const empty = sections.find(s => s.name === 'Empty Section')!;
    expect(empty.body).toBe('');
    expect(empty.summary).toBe('');
  });
});

describe('findMemorySection', () => {
  const sample = `## People\n- @hx\n\n## Tech Stack\n- Zustand`;

  it('finds by exact name (case-insensitive)', () => {
    expect(findMemorySection(sample, 'People')!.name).toBe('People');
    expect(findMemorySection(sample, 'people')!.name).toBe('People');
    expect(findMemorySection(sample, 'PEOPLE')!.name).toBe('People');
  });

  it('strips leading # and whitespace from query', () => {
    expect(findMemorySection(sample, '## People')!.name).toBe('People');
    expect(findMemorySection(sample, '# people')!.name).toBe('People');
    expect(findMemorySection(sample, '  Tech Stack  ')!.name).toBe('Tech Stack');
  });

  it('returns null for missing section', () => {
    expect(findMemorySection(sample, 'Nonexistent')).toBeNull();
  });
});
