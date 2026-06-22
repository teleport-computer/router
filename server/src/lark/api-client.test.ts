import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createLarkApiClient } from './api-client.js';

const mockTokenManager = { getTenantAccessToken: vi.fn(), getValidUserAccessToken: vi.fn() };

describe('LarkApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockTokenManager.getTenantAccessToken.mockResolvedValue('t_token_123');
  });

  it('post() sends Authorization header with tenant token', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: 'ok', data: {} }), { status: 200 }),
    );
    const client = createLarkApiClient({ domain: 'https://open.feishu.cn', tokens: mockTokenManager as any });
    await client.post('/open-apis/im/v1/messages', { foo: 'bar' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as any)['Authorization']).toBe('Bearer t_token_123');
    expect((init as any).method).toBe('POST');
    expect((init as any).body).toBe(JSON.stringify({ foo: 'bar' }));
  });

  it('throws when Lark returns code != 0', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 99991663, msg: 'invalid token' }), { status: 200 }),
    );
    const client = createLarkApiClient({ domain: 'https://open.feishu.cn', tokens: mockTokenManager as any });
    await expect(client.post('/x', {})).rejects.toThrow(/99991663/);
  });

  it('get() supports query params', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: 'ok', data: { items: [] } }), { status: 200 }),
    );
    const client = createLarkApiClient({ domain: 'https://open.feishu.cn', tokens: mockTokenManager as any });
    await client.get('/open-apis/im/v1/chats', { page_size: '20' });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('page_size=20');
  });

  it('post() with asUser uses user access token in Authorization header', async () => {
    mockTokenManager.getValidUserAccessToken.mockResolvedValueOnce('u_token_456');
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: 'ok', data: {} }), { status: 200 }),
    );
    const client = createLarkApiClient({ domain: 'https://open.feishu.cn', tokens: mockTokenManager as any });
    await client.post('/open-apis/im/v1/messages', { foo: 'bar' }, { asUser: 'alice' });
    expect(mockTokenManager.getValidUserAccessToken).toHaveBeenCalledWith('alice');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as any)['Authorization']).toBe('Bearer u_token_456');
  });

  it('throws when asUser has no valid user access token', async () => {
    mockTokenManager.getValidUserAccessToken.mockResolvedValueOnce(null);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: 'ok', data: {} }), { status: 200 }),
    );
    const client = createLarkApiClient({ domain: 'https://open.feishu.cn', tokens: mockTokenManager as any });
    await expect(client.post('/open-apis/im/v1/messages', { foo: 'bar' }, { asUser: 'alice' })).rejects.toThrow(/alice/);
  });
});

import { fetchChatHistory } from './api-client.js';

describe('fetchChatHistory', () => {
  it('aggregates pages until has_more=false', async () => {
    const calls: any[] = [];
    const apiClient = {
      get: async (path: string, query?: any) => {
        calls.push({ path, query });
        if (calls.length === 1) {
          return { items: [{ message_id: 'm1', sender: { id: 'ou_a' }, body: { content: '{"text":"hi"}' }, create_time: '1745000000000' }], has_more: true, page_token: 'p2' };
        }
        return { items: [{ message_id: 'm2', sender: { id: 'ou_b' }, body: { content: '{"text":"yo"}' }, create_time: '1745000010000' }], has_more: false };
      },
      post: async () => ({}),
    };
    const out = await fetchChatHistory(apiClient as any, { chatId: 'oc_x', startTs: 1740000000, endTs: 1750000000, cap: 1000 });
    expect(out.messages).toHaveLength(2);
    expect(out.truncated).toBe(false);
    expect(calls[0].query).toMatchObject({ container_id: 'oc_x', container_id_type: 'chat' });
  });

  it('truncates when cap reached', async () => {
    let i = 0;
    const apiClient = {
      get: async () => {
        i++;
        return { items: Array.from({ length: 50 }, (_, j) => ({ message_id: `m_${i}_${j}`, sender: { id: 'ou' }, body: { content: '{"text":"x"}' }, create_time: '1745000000000' })), has_more: true, page_token: 'next' };
      },
      post: async () => ({}),
    };
    const out = await fetchChatHistory(apiClient as any, { chatId: 'oc_x', startTs: 0, endTs: 9999999999, cap: 100 });
    expect(out.truncated).toBe(true);
    expect(out.messages).toHaveLength(100);
  });

  it('substitutes @_user_N placeholders with mention names', async () => {
    const apiClient = {
      get: async () => ({
        items: [{
          message_id: 'm1',
          sender: { id: 'ou_a' },
          body: { content: '{"text":"@_user_1 hello and @_user_2 fyi"}' },
          create_time: '1745000000000',
          mentions: [
            { key: '@_user_1', name: 'Bot' },
            { key: '@_user_2', name: '张三' },
          ],
        }],
        has_more: false,
      }),
      post: async () => ({}),
    };
    const out = await fetchChatHistory(apiClient as any, { chatId: 'oc_x', startTs: 0, endTs: 9999999999 });
    expect(out.messages[0].text).toBe('@Bot hello and @张三 fyi');
  });
});
