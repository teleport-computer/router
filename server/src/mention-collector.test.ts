import { describe, it, expect } from 'vitest';
import { collectMentionedHandles } from './mention-collector.js';

describe('collectMentionedHandles', () => {
  it('extracts @handle tokens from text', () => {
    const out = collectMentionedHandles({
      text: 'hey @amiller can you check this',
      to: undefined,
      selfHandle: 'haoxuan',
    });
    expect([...out]).toEqual(['amiller']);
  });

  it('lowercases handles', () => {
    const out = collectMentionedHandles({
      text: 'cc @AMiller and @Liko',
      to: undefined,
      selfHandle: 'haoxuan',
    });
    expect([...out].sort()).toEqual(['amiller', 'liko']);
  });

  it('extracts @handle tokens from to[]', () => {
    const out = collectMentionedHandles({
      text: 'no inline mentions',
      to: ['@amiller'],
      selfHandle: 'haoxuan',
    });
    expect([...out]).toEqual(['amiller']);
  });

  it('dedupes when same handle appears in text and to[]', () => {
    const out = collectMentionedHandles({
      text: '@amiller please',
      to: ['@amiller'],
      selfHandle: 'haoxuan',
    });
    expect([...out]).toEqual(['amiller']);
  });

  it('ignores #channel tokens in to[]', () => {
    const out = collectMentionedHandles({
      text: '',
      to: ['#router', '@amiller'],
      selfHandle: 'haoxuan',
    });
    expect([...out]).toEqual(['amiller']);
  });

  it('excludes self-handle even if text/to[] mention it', () => {
    const out = collectMentionedHandles({
      text: '@haoxuan note to self',
      to: ['@haoxuan'],
      selfHandle: 'haoxuan',
    });
    expect([...out]).toEqual([]);
  });

  it('excludes self-handle case-insensitively', () => {
    const out = collectMentionedHandles({
      text: '@HaoXuan note to self',
      to: undefined,
      selfHandle: 'HAOXUAN',
    });
    expect([...out]).toEqual([]);
  });

  it('returns empty set when no mentions', () => {
    const out = collectMentionedHandles({
      text: 'no mentions here',
      to: ['#channel-only'],
      selfHandle: 'haoxuan',
    });
    expect([...out]).toEqual([]);
  });

  it('handles mixed text + to[] across multiple recipients', () => {
    const out = collectMentionedHandles({
      text: 'cc @liko on this @amiller',
      to: ['#feedling', '@zhihao', '@liko'],
      selfHandle: 'haoxuan',
    });
    expect([...out].sort()).toEqual(['amiller', 'liko', 'zhihao']);
  });

  it('treats empty @ token (just "@") as no-op', () => {
    const out = collectMentionedHandles({
      text: 'price is @ $5',
      to: ['@'],
      selfHandle: 'haoxuan',
    });
    expect([...out]).toEqual([]);
  });
});
