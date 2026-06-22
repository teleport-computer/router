import { createHmac } from 'node:crypto';
import { ROUTER_SPARK_EVENT, type MatrixSparkGateway, type MatrixSparkMessage, type SparkEvidence } from './sparks.js';

interface ServiceResponse {
  room_id?: string;
  roomId?: string;
  event_id?: string;
  eventId?: string;
  source_handle?: string;
  target_handle?: string;
  sourceHandle?: string;
  targetHandle?: string;
  messages?: MatrixSparkMessage[];
}

export interface MatrixRoomSendResult {
  eventId?: string;
}

export interface MatrixRoomMessageOptions {
  env?: NodeJS.ProcessEnv;
  txnId?: string;
  content?: Record<string, unknown>;
}

export interface MatrixClientServerAuth {
  accessToken?: string;
  botSecretKey?: string;
  botHandle?: string;
  serverName?: string;
}

export function createMatrixSparkGatewayFromEnv(env: NodeJS.ProcessEnv = process.env): MatrixSparkGateway | null {
  const serviceUrl = env.MATRIX_SPARK_SERVICE_URL?.trim();
  const serviceKey = env.MATRIX_SPARK_SERVICE_KEY?.trim();
  if (serviceUrl) return new MatrixSparkServiceGateway(serviceUrl, serviceKey);

  const homeserver = (env.MATRIX_HOMESERVER || env.MATRIX_SERVER_URL || '').trim();
  const accessToken = env.MATRIX_ACCESS_TOKEN?.trim();
  const botSecretKey = env.MATRIX_BOT_SECRET_KEY?.trim();
  if (!homeserver || (!accessToken && !botSecretKey)) return null;
  return new MatrixClientServerSparkGateway(homeserver, {
    accessToken,
    botSecretKey,
    botHandle: env.MATRIX_BOT_HANDLE?.trim() || 'router',
    serverName: env.MATRIX_SERVER_NAME?.trim(),
  });
}

export async function sendMatrixRoomMessageFromEnv(
  roomId: string,
  text: string,
  options: MatrixRoomMessageOptions = {},
): Promise<MatrixRoomSendResult | null> {
  const env = options.env || process.env;
  const serviceUrl = env.MATRIX_SPARK_SERVICE_URL?.trim();
  const serviceKey = env.MATRIX_SPARK_SERVICE_KEY?.trim();
  if (serviceUrl) {
    const gateway = new MatrixSparkServiceGateway(serviceUrl, serviceKey);
    return gateway.sendRoomMessageWithResult(roomId, text, options.content);
  }

  const homeserver = (env.MATRIX_HOMESERVER || env.MATRIX_SERVER_URL || '').trim();
  const accessToken = env.MATRIX_ACCESS_TOKEN?.trim();
  const botSecretKey = env.MATRIX_BOT_SECRET_KEY?.trim();
  if (!homeserver || (!accessToken && !botSecretKey)) return null;
  const gateway = new MatrixClientServerSparkGateway(homeserver, {
    accessToken,
    botSecretKey,
    botHandle: env.MATRIX_BOT_HANDLE?.trim() || 'router',
    serverName: env.MATRIX_SERVER_NAME?.trim(),
  });
  return gateway.sendRoomMessageWithResult(roomId, text, {
    txnId: options.txnId,
    content: options.content,
  });
}

export function resolveMatrixServerName(homeserverUrl: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  try {
    return new URL(homeserverUrl).hostname;
  } catch {
    return homeserverUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
}

export function deriveMatrixBotPassword(input: {
  accessToken?: string;
  botSecretKey?: string;
  serverName: string;
}): string | null {
  if (input.accessToken?.trim()) return null;
  return input.botSecretKey
    ? createHmac('sha256', input.botSecretKey)
      .update(`matrix:${input.serverName}`)
      .digest('base64url')
    : null;
}

export class MatrixSparkServiceGateway implements MatrixSparkGateway {
  private baseUrl: string;
  private key?: string;

  constructor(baseUrl: string, key?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.key = key;
  }

  async createEncryptedSparkRoom(input: {
    name: string;
    topic: string;
    inviteUserIds: string[];
    sourceHandle: string;
    targetHandle: string;
  }): Promise<{ roomId: string }> {
    const body = await this.request('/spark-room', {
      method: 'POST',
      body: {
        name: input.name,
        topic: input.topic,
        invite_user_ids: input.inviteUserIds,
        source_handle: input.sourceHandle,
        target_handle: input.targetHandle,
      },
    });
    const roomId = body.room_id || body.roomId;
    if (!roomId) throw new Error('Matrix spark service did not return room_id');
    return { roomId };
  }

  async sendRoomMessage(roomId: string, text: string): Promise<void> {
    await this.sendRoomMessageWithResult(roomId, text);
  }

  async sendRoomMessageWithResult(
    roomId: string,
    text: string,
    content?: Record<string, unknown>,
  ): Promise<MatrixRoomSendResult> {
    const body = await this.request('/rooms/message', { method: 'POST', body: { room_id: roomId, text, content } });
    return { eventId: body.event_id || body.eventId };
  }

  async sendEncryptedDM(userId: string, text: string): Promise<{ roomId?: string }> {
    const body = await this.request('/dm', { method: 'POST', body: { user_id: userId, text, encrypted: true } });
    return { roomId: body.room_id || body.roomId };
  }

  async postSparkContext(roomId: string, spark: {
    sourceHandle: string;
    targetHandle: string;
    reason: string;
    evidence: SparkEvidence[];
  }): Promise<void> {
    await this.request('/spark-context', {
      method: 'POST',
      body: {
        room_id: roomId,
        source_handle: spark.sourceHandle,
        target_handle: spark.targetHandle,
        reason: spark.reason,
        evidence: spark.evidence,
      },
    });
  }

  async getSparkRoomPair(roomId: string): Promise<{ sourceHandle: string; targetHandle: string } | null> {
    const body = await this.request(`/spark-room/${encodeURIComponent(roomId)}`, { method: 'GET' }).catch(() => null);
    if (!body) return null;
    const sourceHandle = body.source_handle || body.sourceHandle;
    const targetHandle = body.target_handle || body.targetHandle;
    return sourceHandle && targetHandle ? { sourceHandle, targetHandle } : null;
  }

  async queryRecentMessages(input: { since: number; limit: number; perRoomLimit: number }): Promise<MatrixSparkMessage[]> {
    const url = `/recent-messages?since=${input.since}&limit=${input.limit}&per_room_limit=${input.perRoomLimit}`;
    const body = await this.request(url, { method: 'GET' });
    return Array.isArray(body.messages) ? body.messages : [];
  }

  private async request(path: string, init: { method: string; body?: Record<string, unknown> }): Promise<ServiceResponse> {
    const url = new URL(path, `${this.baseUrl}/`);
    if (this.key) url.searchParams.set('key', this.key);
    const response = await fetch(url, {
      method: init.method,
      headers: { 'Content-Type': 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) {
      throw new Error(`${init.method} ${url.pathname} failed ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    }
    return body || {};
  }
}

export class MatrixClientServerSparkGateway implements MatrixSparkGateway {
  private baseUrl: string;
  private accessToken?: string;
  private auth: MatrixClientServerAuth;
  private serverName: string;

  constructor(homeserverUrl: string, auth: string | MatrixClientServerAuth) {
    this.baseUrl = homeserverUrl.replace(/\/$/, '');
    this.auth = typeof auth === 'string' ? { accessToken: auth } : auth;
    this.accessToken = this.auth.accessToken?.trim() || undefined;
    this.serverName = resolveMatrixServerName(this.baseUrl, this.auth.serverName);
  }

  async createEncryptedSparkRoom(input: {
    name: string;
    topic: string;
    inviteUserIds: string[];
    sourceHandle: string;
    targetHandle: string;
  }): Promise<{ roomId: string }> {
    const created = await this.matrixRequest('POST', '/_matrix/client/v3/createRoom', {
      preset: 'private_chat',
      visibility: 'private',
      invite: input.inviteUserIds,
      name: input.name,
      topic: input.topic,
      initial_state: [
        {
          type: 'm.room.encryption',
          state_key: '',
          content: { algorithm: 'm.megolm.v1.aes-sha2' },
        },
      ],
    });
    const roomId = created.room_id;
    if (!roomId) throw new Error('Matrix createRoom did not return room_id');
    return { roomId };
  }

  async sendRoomMessage(roomId: string, text: string): Promise<void> {
    await this.sendRoomText(roomId, text);
  }

  async sendRoomMessageWithResult(
    roomId: string,
    text: string,
    options: { txnId?: string; content?: Record<string, unknown> } = {},
  ): Promise<MatrixRoomSendResult> {
    return this.sendRoomText(roomId, text, options.txnId, options.content);
  }

  async sendEncryptedDM(userId: string, text: string): Promise<{ roomId?: string }> {
    const created = await this.matrixRequest('POST', '/_matrix/client/v3/createRoom', {
      preset: 'private_chat',
      visibility: 'private',
      is_direct: true,
      invite: [userId],
      initial_state: [
        {
          type: 'm.room.encryption',
          state_key: '',
          content: { algorithm: 'm.megolm.v1.aes-sha2' },
        },
      ],
    });
    const roomId = created.room_id;
    if (roomId) await this.sendRoomText(roomId, text);
    return { roomId };
  }

  async postSparkContext(roomId: string, spark: {
    sourceHandle: string;
    targetHandle: string;
    reason: string;
    evidence: SparkEvidence[];
  }): Promise<void> {
    await this.matrixRequest('PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(ROUTER_SPARK_EVENT)}/`, {
      source_handle: spark.sourceHandle,
      target_handle: spark.targetHandle,
      reason: spark.reason,
      evidence: spark.evidence,
      created_at: Date.now(),
    });
    await this.sendRoomText(roomId, `Connected: ${spark.reason}`);
  }

  async getSparkRoomPair(roomId: string): Promise<{ sourceHandle: string; targetHandle: string } | null> {
    const body = await this.matrixRequest('GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(ROUTER_SPARK_EVENT)}/`)
      .catch(() => null);
    if (!body) return null;
    return body.source_handle && body.target_handle
      ? { sourceHandle: body.source_handle, targetHandle: body.target_handle }
      : null;
  }

  async queryRecentMessages(input: { since: number; limit: number; perRoomLimit: number }): Promise<MatrixSparkMessage[]> {
    const joined = await this.matrixRequest('GET', '/_matrix/client/v3/joined_rooms').catch(() => ({ joined_rooms: [] }));
    const roomIds = Array.isArray(joined.joined_rooms) ? joined.joined_rooms.slice(0, Math.max(1, input.limit)) : [];
    const messages: MatrixSparkMessage[] = [];
    for (const roomId of roomIds) {
      const body = await this.matrixRequest('GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=${input.perRoomLimit}`)
        .catch(() => null);
      for (const event of body?.chunk || []) {
        if (messages.length >= input.limit) break;
        if (event.type !== 'm.room.message') continue;
        const text = typeof event.content?.body === 'string' ? event.content.body : '';
        const timestamp = Number(event.origin_server_ts || 0);
        if (!text || timestamp < input.since) continue;
        messages.push({
          roomId,
          senderHandle: matrixLocalpart(event.sender),
          text,
          timestamp,
          isDM: false,
        });
      }
    }
    return messages;
  }

  private async sendRoomText(
    roomId: string,
    text: string,
    txnId?: string,
    extraContent: Record<string, unknown> = {},
  ): Promise<MatrixRoomSendResult> {
    const txn = txnId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const body = await this.matrixRequest('PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txn)}`, {
      msgtype: 'm.text',
      body: text,
      format: 'org.matrix.custom.html',
      formatted_body: escapeHtml(text).replace(/\n/g, '<br>'),
      ...extraContent,
    });
    return { eventId: body.event_id };
  }

  private async matrixRequest(method: string, path: string, body?: Record<string, unknown>): Promise<any> {
    const accessToken = await this.getAccessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (!response.ok) {
      throw new Error(`${method} ${path} failed ${response.status}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
    }
    return parsed || {};
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;

    const botHandle = this.auth.botHandle?.trim() || 'router';
    const password = deriveMatrixBotPassword({
      botSecretKey: this.auth.botSecretKey,
      serverName: this.serverName,
    });
    if (!password) {
      throw new Error('Matrix direct API requires MATRIX_ACCESS_TOKEN or MATRIX_BOT_SECRET_KEY.');
    }

    const response = await fetch(`${this.baseUrl}/_matrix/client/v3/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: botHandle },
        password,
      }),
    });
    const text = await response.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (!response.ok) {
      throw new Error(`Matrix login failed ${response.status}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
    }
    if (!parsed?.access_token) {
      throw new Error('Matrix login did not return access_token.');
    }
    const token = String(parsed.access_token);
    this.accessToken = token;
    return token;
  }
}

function matrixLocalpart(userId: string | undefined): string | undefined {
  if (!userId?.startsWith('@')) return undefined;
  return userId.slice(1).split(':')[0]?.toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
