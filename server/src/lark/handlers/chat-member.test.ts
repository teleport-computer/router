import { describe, expect, it, vi } from 'vitest';
import { handleChatMember } from './chat-member.js';

describe('handleChatMember', () => {
  it('logs bot.added events with chat_id', async () => {
    const log = vi.fn();
    await handleChatMember({ chat_id: 'oc_42', operator: { open_id: 'ou_x' } }, { log });
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('oc_42'));
  });

  it('does not throw on unknown shape', async () => {
    const log = vi.fn();
    await expect(handleChatMember({}, { log })).resolves.not.toThrow();
  });
});
