import { describe, it, expect, vi } from 'vitest';
import { pushNotificationToLark } from './notification-bridge.js';
import type { Notification, RouterUser, RouterEntry } from '../storage.js';

function makeNotification(p: Partial<Notification>): Notification {
  return {
    id: 'n1',
    recipientHandle: 'taco',
    teamId: 't1',
    type: 'mention',
    fromHandle: 'andrew',
    entryId: 'e1',
    preview: 'hi',
    read: false,
    timestamp: Date.now(),
    ...p,
  };
}

function makeUser(p: Partial<RouterUser> = {}): RouterUser {
  return {
    handle: 'taco',
    secretKeyHash: 'h',
    teamId: 't1',
    createdAt: 0,
    larkOpenId: 'ou_1',
    ...p,
  };
}

function makeEntry(p: Partial<RouterEntry> = {}): RouterEntry {
  return {
    id: 'e1',
    handle: 'andrew',
    teamId: 't1',
    client: 'code',
    content: '',
    summary: '',
    tags: [],
    timestamp: 0,
    ...p,
  };
}

function baseDeps() {
  const post = vi.fn().mockResolvedValue({});
  const log = vi.fn();
  return {
    storage: {
      getUser: vi.fn(async (h: string) => (h === 'taco' ? makeUser() : null)),
      getEntry: vi.fn(async (id: string) => (id === 'e1' ? makeEntry({ channel: 'frontend' }) : null)),
    } as any,
    apiClient: { post, get: vi.fn(), patch: vi.fn() } as any,
    publicUrl: 'https://r.test',
    log,
    _post: post,
  };
}

describe('pushNotificationToLark', () => {
  it('skips self-mention', async () => {
    const d = baseDeps();
    await pushNotificationToLark(makeNotification({ fromHandle: 'taco' }), d);
    expect(d._post).not.toHaveBeenCalled();
  });

  it('skips when recipient has no lark binding', async () => {
    const d = baseDeps();
    d.storage.getUser = vi.fn(async () => makeUser({ larkOpenId: undefined }));
    await pushNotificationToLark(makeNotification({}), d);
    expect(d._post).not.toHaveBeenCalled();
  });

  it('skips when prefs disable this type', async () => {
    const d = baseDeps();
    d.storage.getUser = vi.fn(async () => makeUser({ larkNotificationPrefs: { mention: false } }));
    await pushNotificationToLark(makeNotification({ type: 'mention' }), d);
    expect(d._post).not.toHaveBeenCalled();
  });

  it('treats empty prefs as all on', async () => {
    const d = baseDeps();
    d.storage.getUser = vi.fn(async () => makeUser({ larkNotificationPrefs: {} }));
    await pushNotificationToLark(makeNotification({ type: 'mention' }), d);
    expect(d._post).toHaveBeenCalledTimes(1);
  });

  it('posts a card to lark IM with channel subtitle', async () => {
    const d = baseDeps();
    await pushNotificationToLark(makeNotification({ type: 'mention' }), d);
    expect(d._post).toHaveBeenCalledTimes(1);
    const [path, body] = d._post.mock.calls[0];
    expect(path).toContain('/open-apis/im/v1/messages');
    expect(path).toContain('receive_id_type=open_id');
    expect((body as any).receive_id).toBe('ou_1');
    expect((body as any).msg_type).toBe('interactive');
    const content = JSON.parse((body as any).content);
    expect(JSON.stringify(content)).toContain('在 #frontend');
    expect(JSON.stringify(content)).toContain('https://r.test/entry?id=e1');
  });

  it('appends comment anchor for comment type', async () => {
    const d = baseDeps();
    await pushNotificationToLark(
      makeNotification({ type: 'comment', commentId: 'c5' }),
      d,
    );
    const [, body] = d._post.mock.calls[0];
    const content = JSON.parse((body as any).content);
    expect(JSON.stringify(content)).toContain('#comment-c5');
  });

  it('does NOT throw on apiClient failure', async () => {
    const d = baseDeps();
    d.apiClient.post = vi.fn().mockRejectedValue(new Error('boom'));
    d._post = d.apiClient.post;
    await expect(pushNotificationToLark(makeNotification({}), d)).resolves.toBeUndefined();
    expect(d.log).toHaveBeenCalled();
  });

  it('skips admin_granted / admin_revoked types', async () => {
    const d = baseDeps();
    await pushNotificationToLark(makeNotification({ type: 'admin_granted' }), d);
    expect(d._post).not.toHaveBeenCalled();
    await pushNotificationToLark(makeNotification({ type: 'admin_revoked' }), d);
    expect(d._post).not.toHaveBeenCalled();
  });
});
