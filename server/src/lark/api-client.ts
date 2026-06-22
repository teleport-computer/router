/**
 * Lark Open Platform API client. All Lark HTTP calls funnel through here.
 *
 * Auth: tenant_access_token (server-side, app-level) by default.
 *       Pass {asUser: handle} to use the user's own access token instead.
 */

import type { TokenManager } from '../lark-tokens.js';

export interface LarkApiClient {
  get<T = any>(path: string, query?: Record<string, string>, opts?: { asUser?: string }): Promise<T>;
  post<T = any>(path: string, body: unknown, opts?: { asUser?: string }): Promise<T>;
  patch<T = any>(path: string, body: unknown, opts?: { asUser?: string }): Promise<T>;
}

interface LarkResp<T> {
  code: number;
  msg: string;
  data?: T;
}

export function createLarkApiClient(deps: {
  domain: string;
  tokens: Pick<TokenManager, 'getTenantAccessToken' | 'getValidUserAccessToken'>;
}): LarkApiClient {
  const base = deps.domain.replace(/\/$/, '');

  async function buildAuth(asUser?: string): Promise<string> {
    if (asUser) {
      const t = await deps.tokens.getValidUserAccessToken(asUser);
      if (!t) throw new Error(`No valid user access token for ${asUser}`);
      return `Bearer ${t}`;
    }
    return `Bearer ${await deps.tokens.getTenantAccessToken()}`;
  }

  async function call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, opts: { query?: Record<string, string>; body?: unknown; asUser?: string }): Promise<T> {
    const url = new URL(base + path);
    if (opts.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
    const auth = await buildAuth(opts.asUser);
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: auth } };
    if ((method === 'POST' || method === 'PATCH') && opts.body !== undefined) init.body = JSON.stringify(opts.body);
    const res = await fetch(url, init);
    const json = (await res.json()) as LarkResp<T>;
    if (method === 'PATCH') {
      console.log(`[lark-api] PATCH ${path} → code=${json.code} msg=${json.msg ?? '-'} data=${JSON.stringify(json.data ?? {}).slice(0, 200)}`);
    }
    if (json.code !== 0) throw new Error(`[lark] ${path} code=${json.code} msg=${json.msg}`);
    return (json.data ?? ({} as T));
  }

  return {
    get: (path, query, opts) => call('GET', path, { query, asUser: opts?.asUser }),
    post: (path, body, opts) => call('POST', path, { body, asUser: opts?.asUser }),
    patch: (path, body, opts) => call('PATCH', path, { body, asUser: opts?.asUser }),
  };
}

export interface ChatMessage {
  messageId: string;
  senderId: string;
  text: string;
  createTime: number;   // unix ms
}

export interface FetchHistoryOpts {
  chatId: string;
  startTs: number;     // unix seconds
  endTs: number;
  cap?: number;        // max messages; default 1000
}

export interface FetchHistoryResult {
  messages: ChatMessage[];
  truncated: boolean;
  /**
   * open_id → display name harvested from @-mentions in the fetched messages.
   *
   * This is the *ground-truth* display name for each user as the Lark client
   * shows it in this specific chat — it includes any per-chat alias (群昵称)
   * the user has set, which the chat-members and contact APIs do NOT expose.
   * Callers should prefer this map over fetchChatMemberNames / fetchUserNames.
   *
   * Limitation: only contains users who got @-mentioned at least once in the
   * fetched window. Senders who only spoke without being @ed need a fallback.
   */
  mentionedNames: Map<string, string>;
}

export async function fetchChatHistory(client: LarkApiClient, opts: FetchHistoryOpts): Promise<FetchHistoryResult> {
  const cap = opts.cap ?? 1000;
  const out: ChatMessage[] = [];
  const mentionedNames = new Map<string, string>();
  let pageToken: string | undefined;
  while (true) {
    const q: Record<string, string> = {
      container_id_type: 'chat',
      container_id: opts.chatId,
      start_time: String(opts.startTs),
      end_time: String(opts.endTs),
      page_size: '50',
    };
    if (pageToken) q.page_token = pageToken;
    const data = await client.get<{ items: any[]; has_more: boolean; page_token?: string }>(
      '/open-apis/im/v1/messages',
      q,
    );
    for (const it of data.items ?? []) {
      let text = '';
      try {
        const body = JSON.parse(it.body?.content ?? '{}');
        text = body.text ?? body.content ?? '';
        const mentions = it.mentions ?? [];
        for (const m of mentions) {
          // Substitute @_user_N placeholders in text with the rendered name.
          if (m.key && m.name) {
            text = text.split(m.key).join(`@${m.name}`);
          }
          // Harvest (open_id → name) into the chat-display-name cache. Two
          // shapes seen in the wild: m.id can be a plain string (v1 events,
          // older messages) or a nested object {open_id, union_id, user_id}
          // (v2 events, newer messages).
          const oid = typeof m.id === 'string'
            ? m.id
            : (m.id && typeof m.id === 'object' ? m.id.open_id : undefined);
          if (typeof oid === 'string' && oid && m.name) {
            mentionedNames.set(oid, m.name);
          }
        }
      } catch { text = ''; }
      out.push({
        messageId: it.message_id,
        senderId: it.sender?.id ?? 'unknown',
        text,
        createTime: Number(it.create_time),
      });
      if (out.length >= cap) return { messages: out, truncated: true, mentionedNames };
    }
    if (!data.has_more) return { messages: out, truncated: false, mentionedNames };
    pageToken = data.page_token;
    if (!pageToken) return { messages: out, truncated: false, mentionedNames };
  }
}

/**
 * Resolve a list of Lark open_ids to display names. Uses
 * GET /open-apis/contact/v3/users/{user_id}?user_id_type=open_id per id
 * (Lark batch endpoint requires email/phone reverse lookup, not open_id forward).
 *
 * Returns a map of open_id → name. open_ids that fail resolution are omitted
 * from the map (caller falls back to id).
 */
export async function fetchUserNames(client: LarkApiClient, openIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  // Dedupe + cap to avoid blowing up the API
  const unique = Array.from(new Set(openIds)).slice(0, 100);
  await Promise.all(unique.map(async openId => {
    try {
      const data = await client.get<{ user?: { name?: string } }>(
        `/open-apis/contact/v3/users/${encodeURIComponent(openId)}`,
        { user_id_type: 'open_id' },
      );
      const name = data?.user?.name;
      if (name) map.set(openId, name);
    } catch {
      // ignore single-user lookup failures
    }
  }));
  return map;
}

/**
 * Resolve names of all current members of a Lark chat. Uses
 * GET /open-apis/im/v1/chats/{chat_id}/members which works WITHOUT requiring
 * cross-tenant contact permission — the bot just needs to be in the chat.
 *
 * Returns map of open_id → name. Pages internally up to 5 pages × 100.
 */
export async function fetchChatMemberNames(client: LarkApiClient, chatId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let pageToken: string | undefined;
  for (let i = 0; i < 5; i++) {
    const q: Record<string, string> = { member_id_type: 'open_id', page_size: '100' };
    if (pageToken) q.page_token = pageToken;
    try {
      const data = await client.get<{ items?: Array<{ member_id: string; name?: string }>; has_more?: boolean; page_token?: string }>(
        `/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members`,
        q,
      );
      for (const it of data.items ?? []) {
        if (it.member_id && it.name) map.set(it.member_id, it.name);
      }
      if (!data.has_more || !data.page_token) break;
      pageToken = data.page_token;
    } catch {
      break;
    }
  }
  return map;
}
