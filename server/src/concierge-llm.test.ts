import { describe, it, expect, vi } from 'vitest';
import { synthesizeTeamOverview, synthesizePersonalCallout } from './concierge-llm.js';
import type { RouterEntry } from './storage.js';

function fakeEntry(over: Partial<RouterEntry>): RouterEntry {
  return {
    id: 'e' + Math.random().toString(36).slice(2, 8),
    handle: 'andrew',
    teamId: 't1',
    client: 'code',
    content: '',
    summary: 'shipped the design system v2 to design channel',
    tags: ['design', 'milestone'],
    timestamp: Date.now(),
    ...over,
  };
}

describe('synthesizeTeamOverview', () => {
  it('returns LLM output when content is substantive', async () => {
    const callLLM = vi.fn().mockResolvedValue('Andrew shipped design v2; Samantha started onboarding revamp.');
    const result = await synthesizeTeamOverview(callLLM, [fakeEntry({}), fakeEntry({ handle: 'samantha', summary: 'onboarding revamp kickoff' })]);
    expect(result).toBe('Andrew shipped design v2; Samantha started onboarding revamp.');
    expect(callLLM).toHaveBeenCalledOnce();
  });

  it('returns null when LLM signals NO_CONTENT marker', async () => {
    const callLLM = vi.fn().mockResolvedValue('[NO_CONTENT]');
    const result = await synthesizeTeamOverview(callLLM, [fakeEntry({})]);
    expect(result).toBeNull();
  });

  it('returns null when entries array is empty (no LLM call)', async () => {
    const callLLM = vi.fn();
    const result = await synthesizeTeamOverview(callLLM, []);
    expect(result).toBeNull();
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('returns null when LLM throws (graceful failure)', async () => {
    const callLLM = vi.fn().mockRejectedValue(new Error('OpenRouter timeout'));
    const result = await synthesizeTeamOverview(callLLM, [fakeEntry({})]);
    expect(result).toBeNull();
  });
});

describe('synthesizePersonalCallout', () => {
  const userEntries = [
    fakeEntry({ handle: 'hx', summary: 'refactoring timeline module to use new schema' }),
    fakeEntry({ handle: 'hx', summary: 'investigating timeline pagination perf' }),
  ];
  const teamEntries = [
    fakeEntry({ handle: 'claire', summary: 'backend data migration touches timeline tables' }),
    fakeEntry({ handle: 'andrew', summary: 'design tokens v2 ready for review' }),
  ];

  it('returns LLM output when there is a real connection', async () => {
    const callLLM = vi.fn().mockResolvedValue('Claire is doing a backend migration on the same tables you are refactoring — worth syncing on schema.');
    const result = await synthesizePersonalCallout(callLLM, 'hx', userEntries, teamEntries);
    expect(result).toContain('Claire');
    expect(callLLM).toHaveBeenCalledOnce();
  });

  it('returns null when LLM signals NO_CONNECTION', async () => {
    const callLLM = vi.fn().mockResolvedValue('[NO_CONNECTION]');
    const result = await synthesizePersonalCallout(callLLM, 'hx', userEntries, teamEntries);
    expect(result).toBeNull();
  });

  it('returns null when user has no recent entries (no LLM call)', async () => {
    const callLLM = vi.fn();
    const result = await synthesizePersonalCallout(callLLM, 'hx', [], teamEntries);
    expect(result).toBeNull();
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('returns null when team produced nothing today (no LLM call)', async () => {
    const callLLM = vi.fn();
    const result = await synthesizePersonalCallout(callLLM, 'hx', userEntries, []);
    expect(result).toBeNull();
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('returns null when LLM throws (graceful failure)', async () => {
    const callLLM = vi.fn().mockRejectedValue(new Error('rate limit'));
    const result = await synthesizePersonalCallout(callLLM, 'hx', userEntries, teamEntries);
    expect(result).toBeNull();
  });
});
