import { describe, it, expect, vi } from 'vitest';
import { createP2pMessageHandler } from './p2p-message.js';
import type { LarkApiClient } from '../api-client.js';
import type { Storage, RouterUser } from '../../storage.js';

function makeUser(p: Partial<RouterUser> = {}): RouterUser {
  return {
    handle: 'taco',
    secretKeyHash: 'h',
    teamId: 't1',
    createdAt: 0,
    larkOpenId: 'ou_taco',
    ...p,
  };
}

function makePayload(p: { senderOpenId?: string; text?: string; chatId?: string } = {}): any {
  return {
    sender: { sender_id: { open_id: p.senderOpenId ?? 'ou_taco' } },
    message: {
      chat_id: p.chatId ?? 'oc_p2p_1',
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text: p.text ?? 'hello' }),
    },
  };
}

function baseDeps() {
  const post = vi.fn().mockResolvedValue({});
  const runAgent = vi.fn().mockResolvedValue(undefined);
  const log = vi.fn();
  return {
    storage: {
      getUserByLarkOpenId: vi.fn(async (id: string) => id === 'ou_taco' ? makeUser() : null),
    } as any as Pick<Storage, 'getUserByLarkOpenId'>,
    apiClient: { post, patch: vi.fn(), get: vi.fn() } as any as LarkApiClient,
    publicUrl: 'https://r.test',
    runAgent: runAgent as any,
    agentDeps: {} as any,
    log,
    _post: post,
    _runAgent: runAgent,
  };
}

describe('p2p-message handler', () => {
  it('skips if not p2p chat_type (defensive)', async () => {
    const d = baseDeps();
    const handle = createP2pMessageHandler(d);
    const payload = makePayload();
    payload.message.chat_type = 'group';
    await handle(payload);
    expect(d._post).not.toHaveBeenCalled();
    expect(d._runAgent).not.toHaveBeenCalled();
  });

  it('skips if message_type !== text (no image/file handling)', async () => {
    const d = baseDeps();
    const handle = createP2pMessageHandler(d);
    const payload = makePayload();
    payload.message.message_type = 'image';
    await handle(payload);
    expect(d._runAgent).not.toHaveBeenCalled();
    expect(d._post).not.toHaveBeenCalled();
  });

  it('sends binding guide card when sender has no lark binding', async () => {
    const d = baseDeps();
    d.storage.getUserByLarkOpenId = vi.fn(async () => null);
    const handle = createP2pMessageHandler(d);
    await handle(makePayload());
    expect(d._post).toHaveBeenCalledTimes(1);
    const [path, body] = d._post.mock.calls[0];
    expect(path).toContain('/open-apis/im/v1/messages');
    expect((body as any).receive_id).toBe('oc_p2p_1');
    const content = JSON.parse((body as any).content);
    expect(JSON.stringify(content)).toContain('Router Bot');
    expect(JSON.stringify(content)).toContain('https://r.test/settings#lark-binding');
    expect(d._runAgent).not.toHaveBeenCalled();
  });

  it('calls runAgent with mode:p2p when bound', async () => {
    const d = baseDeps();
    const handle = createP2pMessageHandler(d);
    await handle(makePayload({ text: 'what did we decide last week' }));
    expect(d._runAgent).toHaveBeenCalledTimes(1);
    const [req, , opts] = d._runAgent.mock.calls[0];
    expect(req.chatId).toBe('oc_p2p_1');
    expect(req.senderOpenId).toBe('ou_taco');
    expect(req.text).toBe('what did we decide last week');
    expect(opts).toEqual(expect.objectContaining({ mode: 'p2p' }));
  });

  it('sends rate-limit guide card when runAgent returns {rateLimited:true}', async () => {
    const d = baseDeps();
    d._runAgent.mockResolvedValueOnce({ rateLimited: true });
    const handle = createP2pMessageHandler(d);
    await handle(makePayload());
    expect(d._runAgent).toHaveBeenCalledTimes(1);
    expect(d._post).toHaveBeenCalledTimes(1);
    const [, body] = d._post.mock.calls[0];
    const content = JSON.parse((body as any).content);
    expect(JSON.stringify(content)).toContain('喘口气');
    expect(JSON.stringify(content)).toContain('https://r.test/setup/cli');
  });

  it('does not throw when apiClient.post fails', async () => {
    const d = baseDeps();
    d.storage.getUserByLarkOpenId = vi.fn(async () => null);
    const failingPost = vi.fn().mockRejectedValue(new Error('boom'));
    d.apiClient.post = failingPost as any;
    d._post = failingPost;
    const handle = createP2pMessageHandler(d);
    await expect(handle(makePayload())).resolves.toBeUndefined();
    expect(d.log).toHaveBeenCalled();
  });

  it('intercepts /help and posts help card without calling agent', async () => {
    const d = baseDeps();
    const handle = createP2pMessageHandler(d);
    await handle(makePayload({ text: '/help' }));
    expect(d._runAgent).not.toHaveBeenCalled();
    expect(d._post).toHaveBeenCalledTimes(1);
    const [, body] = d._post.mock.calls[0];
    const content = JSON.parse((body as any).content);
    expect(JSON.stringify(content)).toContain('Router Bot 私聊帮助');
    expect(JSON.stringify(content)).toContain('https://r.test/settings');
    expect(JSON.stringify(content)).toContain('https://r.test/setup/cli');
  });

  it('intercepts Chinese alias /帮助 and posts help card', async () => {
    const d = baseDeps();
    const handle = createP2pMessageHandler(d);
    await handle(makePayload({ text: '/帮助' }));
    expect(d._runAgent).not.toHaveBeenCalled();
    expect(d._post).toHaveBeenCalledTimes(1);
    const [, body] = d._post.mock.calls[0];
    expect(JSON.stringify(JSON.parse((body as any).content))).toContain('Router Bot 私聊帮助');
  });

  it('rejects unknown slash command with group-only pointer card', async () => {
    const d = baseDeps();
    const handle = createP2pMessageHandler(d);
    await handle(makePayload({ text: '/summarize 30m' }));
    expect(d._runAgent).not.toHaveBeenCalled();
    expect(d._post).toHaveBeenCalledTimes(1);
    const [, body] = d._post.mock.calls[0];
    const content = JSON.parse((body as any).content);
    const s = JSON.stringify(content);
    expect(s).toContain('私聊里只支持 /help');
    expect(s).toContain('/summarize');
  });

  it('does not intercept text that merely contains a slash mid-string', async () => {
    const d = baseDeps();
    const handle = createP2pMessageHandler(d);
    await handle(makePayload({ text: 'show me the /help docs' }));
    expect(d._runAgent).toHaveBeenCalledTimes(1);
    expect(d._post).not.toHaveBeenCalled();
  });

  it('skips if sender_id.open_id missing (defensive)', async () => {
    const d = baseDeps();
    const handle = createP2pMessageHandler(d);
    const payload = makePayload();
    payload.sender = {};
    await handle(payload);
    expect(d._runAgent).not.toHaveBeenCalled();
    expect(d._post).not.toHaveBeenCalled();
  });
});
