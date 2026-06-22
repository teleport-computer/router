import { describe, expect, it, vi } from 'vitest';
import { parseCommand, createCommandRouter, type CommandHandlers } from './command-router.js';

function makeHandlers(overrides: Partial<CommandHandlers> = {}): CommandHandlers {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    archive: vi.fn(),
    push: vi.fn(),
    watch: vi.fn(),
    style: vi.fn(),
    settings: vi.fn(),
    help: vi.fn(),
    summarize: vi.fn(),
    ...overrides,
  };
}

describe('parseCommand', () => {
  it('strips Lark mention placeholders before matching', () => {
    expect(parseCommand('@_user_1 connect feedling')).toEqual({ command: 'connect', arg: 'feedling' });
    expect(parseCommand('  @_user_2 @_user_1 /summarize 1h')).toEqual({ command: 'summarize', arg: '1h' });
  });

  it('matches connect / 连接 with channel arg (with or without #)', () => {
    expect(parseCommand('connect feedling')).toEqual({ command: 'connect', arg: 'feedling' });
    expect(parseCommand('connect #feedling')).toEqual({ command: 'connect', arg: 'feedling' });
    expect(parseCommand('连接 feedling')).toEqual({ command: 'connect', arg: 'feedling' });
  });

  it('matches disconnect / 解绑', () => {
    expect(parseCommand('disconnect')).toEqual({ command: 'disconnect', arg: '' });
    expect(parseCommand('解绑')).toEqual({ command: 'disconnect', arg: '' });
  });

  it('matches archive / 归档', () => {
    expect(parseCommand('archive notes')).toEqual({ command: 'archive', arg: 'notes' });
    expect(parseCommand('归档 notes')).toEqual({ command: 'archive', arg: 'notes' });
  });

  it('matches help / 帮助', () => {
    expect(parseCommand('help')).toEqual({ command: 'help', arg: '' });
    expect(parseCommand('帮助')).toEqual({ command: 'help', arg: '' });
  });

  it('matches /summarize with arg', () => {
    expect(parseCommand('/summarize 1h')).toEqual({ command: 'summarize', arg: '1h' });
    expect(parseCommand('/summarize')).toEqual({ command: 'summarize', arg: '' });
    expect(parseCommand('/summarize 帮我看早上 10 点到现在')).toEqual({ command: 'summarize', arg: '帮我看早上 10 点到现在' });
  });

  it('accepts slash-prefixed forms for all commands', () => {
    expect(parseCommand('/connect feedling')).toEqual({ command: 'connect', arg: 'feedling' });
    expect(parseCommand('/disconnect')).toEqual({ command: 'disconnect', arg: '' });
    expect(parseCommand('/archive notes')).toEqual({ command: 'archive', arg: 'notes' });
    expect(parseCommand('/push on')).toEqual({ command: 'push', arg: 'on' });
    expect(parseCommand('/help')).toEqual({ command: 'help', arg: '' });
    expect(parseCommand('/watch')).toEqual({ command: 'watch', arg: '' });
    expect(parseCommand('/watch daily 11:00')).toEqual({ command: 'watch', arg: 'daily 11:00' });
    expect(parseCommand('/观察 off')).toEqual({ command: 'watch', arg: 'off' });
  });

  it('returns null for unmatched text', () => {
    expect(parseCommand('hello world')).toBeNull();
    expect(parseCommand('')).toBeNull();
  });
});

describe('createCommandRouter', () => {
  it('dispatches to the matching handler', async () => {
    const handlers = makeHandlers();
    const route = createCommandRouter(handlers);
    const fakePayload: any = { message: { content: '{"text":"@_user_1 connect feedling"}', chat_id: 'oc_x' }, sender: { sender_id: { open_id: 'ou_y' } } };
    await route(fakePayload);
    expect(handlers.connect).toHaveBeenCalledWith({ payload: fakePayload, arg: 'feedling' });
  });

  it('falls through to help when no match and message mentions bot', async () => {
    const help = vi.fn();
    const route = createCommandRouter(makeHandlers({ help }));
    const fakePayload: any = { message: { content: '{"text":"@_user_1 random words"}', chat_id: 'oc_x', mentions: [{ key: '@_user_1' }] }, sender: { sender_id: { open_id: 'ou_y' } } };
    await route(fakePayload);
    expect(help).toHaveBeenCalledWith({ payload: fakePayload, arg: '' });
  });

  it('drops non-mention messages silently', async () => {
    const handlers = makeHandlers();
    const route = createCommandRouter(handlers);
    const fakePayload: any = { message: { content: '{"text":"hello"}', chat_id: 'oc_x', mentions: [] }, sender: { sender_id: { open_id: 'ou_y' } } };
    await route(fakePayload);
    expect(handlers.help).not.toHaveBeenCalled();
  });

  it('with botOpenId set, ignores mentions of other users', async () => {
    const handlers = makeHandlers();
    const route = createCommandRouter(handlers, { botOpenId: 'ou_bot' });
    const fakePayload: any = {
      message: {
        content: '{"text":"@_user_1 大家好"}',
        chat_id: 'oc_x',
        mentions: [{ key: '@_user_1', id: 'ou_someone_else' }],
      },
      sender: { sender_id: { open_id: 'ou_y' } },
    };
    await route(fakePayload);
    expect(handlers.help).not.toHaveBeenCalled();
  });

  it('with botOpenId set, fires help when bot is mentioned (no command)', async () => {
    const help = vi.fn();
    const route = createCommandRouter(makeHandlers({ help }), { botOpenId: 'ou_bot' });
    const fakePayload: any = {
      message: {
        content: '{"text":"@_user_1 random words"}',
        chat_id: 'oc_x',
        mentions: [{ key: '@_user_1', id: 'ou_bot' }],
      },
      sender: { sender_id: { open_id: 'ou_y' } },
    };
    await route(fakePayload);
    expect(help).toHaveBeenCalled();
  });

  it('handles v2 events where mention.id is a nested {open_id, union_id, user_id} object', async () => {
    const help = vi.fn();
    const route = createCommandRouter(makeHandlers({ help }), { botOpenId: 'ou_bot' });
    const fakePayload: any = {
      message: {
        content: '{"text":"@_user_1 /help"}',
        chat_id: 'oc_x',
        mentions: [{
          key: '@_user_1',
          name: 'Bot',
          mentioned_type: 'bot',
          id: { open_id: 'ou_bot', union_id: 'on_xxx', user_id: '' },
        }],
      },
      sender: { sender_id: { open_id: 'ou_y' } },
    };
    await route(fakePayload);
    expect(help).toHaveBeenCalled();
  });

  it('handles v1 events where mentions array lacks id and text contains <at open_id> raw tag', async () => {
    const handlers = makeHandlers();
    const route = createCommandRouter(handlers, { botOpenId: 'ou_bot' });
    const fakePayload: any = {
      message: {
        content: '{"text":"<at open_id=\\"ou_bot\\">@Router Bot</at> push"}',
        chat_id: 'oc_x',
        // v1 events deliver only key+name on mentions, no id
        mentions: [{ key: '@_user_1', name: 'Bot' }],
      },
      sender: { sender_id: { open_id: 'ou_y' } },
    };
    await route(fakePayload);
    expect(handlers.push).toHaveBeenCalledWith({ payload: fakePayload, arg: '' });
  });

  it('with botOpenId set, dispatches command even when other users are also mentioned', async () => {
    const handlers = makeHandlers();
    const route = createCommandRouter(handlers, { botOpenId: 'ou_bot' });
    const fakePayload: any = {
      message: {
        content: '{"text":"@_user_1 @_user_2 /summarize 1h"}',
        chat_id: 'oc_x',
        mentions: [
          { key: '@_user_1', id: 'ou_bot' },
          { key: '@_user_2', id: 'ou_someone' },
        ],
      },
      sender: { sender_id: { open_id: 'ou_y' } },
    };
    await route(fakePayload);
    expect(handlers.summarize).toHaveBeenCalledWith({ payload: fakePayload, arg: '1h' });
  });
});
