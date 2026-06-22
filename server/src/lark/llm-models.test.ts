import { describe, it, expect } from 'vitest';
import { loadLlmModels, describeLlmModels } from './llm-models.js';

describe('loadLlmModels', () => {
  it('falls back to the safe baseline when no env vars are set', () => {
    const c = loadLlmModels({});
    expect(c.summarize).toBe('anthropic/claude-haiku-4.5');
    expect(c.timeParse).toBe('anthropic/claude-haiku-4.5');
    expect(c.agent).toBe('anthropic/claude-haiku-4.5');
    expect(c.generic).toBe('anthropic/claude-haiku-4.5');
  });

  it('OPENROUTER_MODEL is the generic and propagates to ALL slots', () => {
    // The "set one global env, get uniform behavior" promise. If you set
    // OPENROUTER_MODEL, every slot — agent included — follows. Per-slot
    // overrides exist for when you want a slot to differ.
    const c = loadLlmModels({ OPENROUTER_MODEL: 'openai/gpt-4o-mini' });
    expect(c.generic).toBe('openai/gpt-4o-mini');
    expect(c.summarize).toBe('openai/gpt-4o-mini');
    expect(c.timeParse).toBe('openai/gpt-4o-mini');
    expect(c.agent).toBe('openai/gpt-4o-mini');
  });

  it('per-slot env overrides win over the generic and the baseline', () => {
    const c = loadLlmModels({
      OPENROUTER_MODEL: 'openai/gpt-4o-mini',
      LARK_SUMMARIZE_MODEL: 'deepseek/deepseek-chat-v3.1',
      LARK_TIME_PARSE_MODEL: 'openai/gpt-4o-mini',
      LARK_AGENT_MODEL: 'anthropic/claude-sonnet-4.5',
    });
    expect(c.summarize).toBe('deepseek/deepseek-chat-v3.1');
    expect(c.timeParse).toBe('openai/gpt-4o-mini');
    expect(c.agent).toBe('anthropic/claude-sonnet-4.5');
    expect(c.generic).toBe('openai/gpt-4o-mini');
  });

  it('mixing one slot override + OPENROUTER_MODEL leaves other slots on generic', () => {
    const c = loadLlmModels({
      OPENROUTER_MODEL: 'openai/gpt-4o-mini',
      LARK_AGENT_MODEL: 'anthropic/claude-haiku-4.5',
    });
    expect(c.summarize).toBe('openai/gpt-4o-mini');
    expect(c.timeParse).toBe('openai/gpt-4o-mini');
    expect(c.agent).toBe('anthropic/claude-haiku-4.5');
    expect(c.generic).toBe('openai/gpt-4o-mini');
  });

  it('common ops scenario: cheap model globally, agent pinned to a stable one', () => {
    // Real deployment shape we expect: a single OPENROUTER_MODEL drives the
    // bulk + cost-sensitive features (summarize, watch eval, translate),
    // while LARK_AGENT_MODEL keeps multi-step tool-use on a known-reliable
    // SKU.
    const c = loadLlmModels({
      OPENROUTER_MODEL: 'deepseek/deepseek-v4-flash',
      LARK_AGENT_MODEL: 'anthropic/claude-haiku-4.5',
    });
    expect(c.summarize).toBe('deepseek/deepseek-v4-flash');
    expect(c.timeParse).toBe('deepseek/deepseek-v4-flash');
    expect(c.generic).toBe('deepseek/deepseek-v4-flash');
    expect(c.agent).toBe('anthropic/claude-haiku-4.5');
  });

  it('treats empty-string env vars as unset (Node sometimes preserves them)', () => {
    const c = loadLlmModels({
      OPENROUTER_MODEL: '',
      LARK_SUMMARIZE_MODEL: '',
    });
    // Empty string is falsy — cascade should fall through to baseline.
    expect(c.generic).toBe('anthropic/claude-haiku-4.5');
    expect(c.summarize).toBe('anthropic/claude-haiku-4.5');
  });

  it('describeLlmModels prints all four slots', () => {
    const c = loadLlmModels({ OPENROUTER_MODEL: 'openai/gpt-4o-mini' });
    const desc = describeLlmModels(c);
    expect(desc).toContain('summarize=openai/gpt-4o-mini');
    expect(desc).toContain('timeParse=openai/gpt-4o-mini');
    expect(desc).toContain('agent=openai/gpt-4o-mini');
    expect(desc).toContain('generic=openai/gpt-4o-mini');
  });
});
