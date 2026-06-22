import { describe, expect, it, vi } from 'vitest';
import { createEventRouter } from './event-router.js';

describe('createEventRouter', () => {
  it('routes im.message.receive_v1 to messageHandler', async () => {
    const message = vi.fn();
    const member = vi.fn();
    const route = createEventRouter({ message, member });
    await route({
      header: { event_type: 'im.message.receive_v1' },
      event: { content: 'hi' },
    });
    expect(message).toHaveBeenCalledWith({ content: 'hi' });
    expect(member).not.toHaveBeenCalled();
  });

  it('routes im.chat.member.bot.added_v1 to memberHandler', async () => {
    const message = vi.fn();
    const member = vi.fn();
    const route = createEventRouter({ message, member });
    await route({
      header: { event_type: 'im.chat.member.bot.added_v1' },
      event: { chat_id: 'oc_x' },
    });
    expect(member).toHaveBeenCalledWith({ chat_id: 'oc_x' });
  });

  it('logs and drops unknown events', async () => {
    const message = vi.fn();
    const member = vi.fn();
    const log = vi.fn();
    const route = createEventRouter({ message, member, log });
    await route({ header: { event_type: 'something.unknown' }, event: {} });
    expect(message).not.toHaveBeenCalled();
    expect(member).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('info', 'unhandled event: something.unknown');
  });
});
