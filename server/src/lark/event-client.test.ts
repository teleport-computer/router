import { describe, expect, it, vi, beforeEach } from 'vitest';

// Capture WSClient + EventDispatcher constructor args via module mock.
const wsClientCtor = vi.fn();
const dispatcherRegister = vi.fn();

vi.mock('@larksuiteoapi/node-sdk', () => ({
  WSClient: vi.fn().mockImplementation(function (this: any, params: any) {
    wsClientCtor(params);
    this.start = vi.fn().mockResolvedValue(undefined);
  }),
  EventDispatcher: vi.fn().mockImplementation(function (this: any) {
    this.register = dispatcherRegister;
  }),
  Domain: { Feishu: 0, Lark: 1 },
}));

import { LarkEventClient } from './event-client.js';

describe('LarkEventClient (SDK-backed)', () => {
  beforeEach(() => {
    wsClientCtor.mockClear();
    dispatcherRegister.mockClear();
  });

  it('start() short-circuits when botEnabled=false', async () => {
    const onEvent = vi.fn();
    const c = new LarkEventClient({
      appId: 'a', appSecret: 's', domain: 'https://open.feishu.cn',
      botEnabled: false, onEvent,
    });
    await c.start();
    expect(wsClientCtor).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    expect(c.state.connected).toBe(false);
  });

  it('start() instantiates WSClient with Feishu domain', async () => {
    const onEvent = vi.fn();
    const c = new LarkEventClient({
      appId: 'a', appSecret: 's', domain: 'https://open.feishu.cn',
      botEnabled: true, onEvent,
    });
    await c.start();
    expect(wsClientCtor).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'a', appSecret: 's', domain: 0,  // Domain.Feishu
      autoReconnect: true,
    }));
  });

  it('start() picks Lark domain for larksuite URL', async () => {
    const c = new LarkEventClient({
      appId: 'a', appSecret: 's', domain: 'https://open.larksuite.com',
      botEnabled: true, onEvent: vi.fn(),
    });
    await c.start();
    expect(wsClientCtor).toHaveBeenCalledWith(expect.objectContaining({ domain: 1 }));
  });

  it('registers handlers for both v2 (5) and v1 (3) event keys', async () => {
    const c = new LarkEventClient({
      appId: 'a', appSecret: 's', domain: 'https://open.feishu.cn',
      botEnabled: true, onEvent: vi.fn(),
    });
    await c.start();
    expect(dispatcherRegister).toHaveBeenCalledOnce();
    const handlers = dispatcherRegister.mock.calls[0][0];
    expect(Object.keys(handlers).sort()).toEqual([
      'add_bot',
      'im.chat.member.bot.added_v1',
      'im.chat.member.bot.deleted_v1',
      'im.message.reaction.created_v1',
      'im.message.reaction.deleted_v1',
      'im.message.receive_v1',
      'message',
      'remove_bot',
    ]);
  });

  it('v1 message event is adapted to v2 shape before forwarding', async () => {
    const onEvent = vi.fn();
    const c = new LarkEventClient({
      appId: 'a', appSecret: 's', domain: 'https://open.feishu.cn',
      botEnabled: true, onEvent,
    });
    await c.start();
    const handlers = dispatcherRegister.mock.calls[0][0];
    await handlers['message']({
      open_chat_id: 'oc_v1',
      open_id: 'ou_v1',
      text: '@_user_1 /summarize',
      is_mention: true,
      msg_type: 'text',
      chat_type: 'group',
    });
    expect(onEvent).toHaveBeenCalledWith({
      header: { event_type: 'im.message.receive_v1' },
      event: expect.objectContaining({
        message: expect.objectContaining({
          chat_id: 'oc_v1',
          content: JSON.stringify({ text: '@_user_1 /summarize' }),
        }),
        sender: { sender_id: { open_id: 'ou_v1' } },
      }),
    });
  });

  it('forwards events through registered handler with correct LarkEvent shape', async () => {
    const onEvent = vi.fn();
    const c = new LarkEventClient({
      appId: 'a', appSecret: 's', domain: 'https://open.feishu.cn',
      botEnabled: true, onEvent,
    });
    await c.start();
    const handlers = dispatcherRegister.mock.calls[0][0];
    await handlers['im.message.receive_v1']({ chat_id: 'oc_x', content: '{}' });
    expect(onEvent).toHaveBeenCalledWith({
      header: { event_type: 'im.message.receive_v1' },
      event: { chat_id: 'oc_x', content: '{}' },
    });
    expect(c.state.lastEventAt).toBeGreaterThan(0);
  });

  it('onReady/onReconnecting/onReconnected/onError callbacks update state.connected', async () => {
    const c = new LarkEventClient({
      appId: 'a', appSecret: 's', domain: 'https://open.feishu.cn',
      botEnabled: true, onEvent: vi.fn(),
    });
    await c.start();
    expect(c.state.connected).toBe(false);
    const ctorParams = wsClientCtor.mock.calls[0][0];
    ctorParams.onReady();
    expect(c.state.connected).toBe(true);
    ctorParams.onReconnecting();
    expect(c.state.connected).toBe(false);
    ctorParams.onReconnected();
    expect(c.state.connected).toBe(true);
    ctorParams.onError(new Error('x'));
    expect(c.state.connected).toBe(false);
  });

  it('onEvent throw is logged but does not crash', async () => {
    const log = vi.fn();
    const onEvent = vi.fn().mockRejectedValue(new Error('handler boom'));
    const c = new LarkEventClient({
      appId: 'a', appSecret: 's', domain: 'https://open.feishu.cn',
      botEnabled: true, onEvent, log,
    });
    await c.start();
    const handlers = dispatcherRegister.mock.calls[0][0];
    await handlers['im.message.receive_v1']({});
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('handler boom'));
  });

  it('card.action.trigger handler is registered when onCardAction provided', async () => {
    const onCardAction = vi.fn().mockResolvedValue({ toast: { type: 'info', content: '✅ saved' } });
    const c = new LarkEventClient({
      appId: 'a', appSecret: 's', domain: 'https://open.feishu.cn',
      botEnabled: true, onEvent: vi.fn(), onCardAction,
    });
    await c.start();
    const handlers = dispatcherRegister.mock.calls[0][0];
    expect(typeof handlers['card.action.trigger']).toBe('function');
    const result = await handlers['card.action.trigger']({ context: { open_chat_id: 'oc_x' }, action: { value: { action: 'save_summary' } } });
    expect(onCardAction).toHaveBeenCalled();
    expect(result).toEqual({ toast: { type: 'info', content: '✅ saved' } });
  });

  it('card.action.trigger handler not registered when onCardAction omitted', async () => {
    const c = new LarkEventClient({
      appId: 'a', appSecret: 's', domain: 'https://open.feishu.cn',
      botEnabled: true, onEvent: vi.fn(),
    });
    await c.start();
    const handlers = dispatcherRegister.mock.calls[0][0];
    expect(handlers['card.action.trigger']).toBeUndefined();
  });
});
