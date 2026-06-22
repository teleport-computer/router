import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deriveMatrixBotPassword,
  resolveMatrixServerName,
  sendMatrixRoomMessageFromEnv,
} from './matrix-spark-gateway.js';

describe('matrix spark gateway direct auth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('derives the same Matrix bot password shape as the bridge', () => {
    expect(resolveMatrixServerName('https://mtrx.shaperotator.xyz')).toBe('mtrx.shaperotator.xyz');
    expect(deriveMatrixBotPassword({
      botSecretKey: 'router-secret',
      serverName: 'mtrx.shaperotator.xyz',
    })).toBe('HKNBJ4iE1sIcJVtHrqe2Y2mcIxi15--2yqS7FyyiAE4');
    expect(deriveMatrixBotPassword({
      accessToken: 'token-wins',
      botSecretKey: 'router-secret',
      serverName: 'mtrx.shaperotator.xyz',
    })).toBeNull();
  });

  it('uses MATRIX_ACCESS_TOKEN directly when present', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ event_id: '$event' }),
    } as Response);

    const result = await sendMatrixRoomMessageFromEnv('!room:mtrx.test', 'hello', {
      env: {
        MATRIX_HOMESERVER: 'https://mtrx.test',
        MATRIX_ACCESS_TOKEN: 'direct-token',
      } as NodeJS.ProcessEnv,
      txnId: 'txn-1',
      content: { source: 'test' },
    });

    expect(result).toEqual({ eventId: '$event' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://mtrx.test/_matrix/client/v3/rooms/!room%3Amtrx.test/send/m.room.message/txn-1');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PUT',
      headers: expect.objectContaining({ Authorization: 'Bearer direct-token' }),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      body: 'hello',
      source: 'test',
    });
  });

  it('forwards custom Matrix event content through the spark service path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ event_id: '$service-event' }),
    } as Response);

    const result = await sendMatrixRoomMessageFromEnv('!room:mtrx.test', 'hello', {
      env: {
        MATRIX_SPARK_SERVICE_URL: 'https://matrix-service.test',
        MATRIX_SPARK_SERVICE_KEY: 'service-key',
      } as NodeJS.ProcessEnv,
      content: {
        formatted_body: '<a href="https://matrix.to/#/%40alice%3Amtrx.test">Alice</a>',
        'm.mentions': { user_ids: ['@alice:mtrx.test'] },
      },
    });

    expect(result).toEqual({ eventId: '$service-event' });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://matrix-service.test/rooms/message?key=service-key');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      room_id: '!room:mtrx.test',
      text: 'hello',
      content: {
        formatted_body: '<a href="https://matrix.to/#/%40alice%3Amtrx.test">Alice</a>',
        'm.mentions': { user_ids: ['@alice:mtrx.test'] },
      },
    });
  });

  it('logs in with MATRIX_BOT_SECRET_KEY when no access token is present', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const path = String(url);
      if (path.endsWith('/_matrix/client/v3/login')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ access_token: 'fresh-token' }),
        } as Response;
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ event_id: '$sent' }),
      } as Response;
    });

    const result = await sendMatrixRoomMessageFromEnv('!room:mtrx.test', 'hello', {
      env: {
        MATRIX_HOMESERVER: 'https://mtrx.test',
        MATRIX_SERVER_NAME: 'mtrx.test',
        MATRIX_BOT_SECRET_KEY: 'router-secret',
        MATRIX_BOT_HANDLE: 'router',
      } as NodeJS.ProcessEnv,
      txnId: 'txn-2',
    });

    expect(result).toEqual({ eventId: '$sent' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://mtrx.test/_matrix/client/v3/login');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: 'router' },
      password: deriveMatrixBotPassword({
        botSecretKey: 'router-secret',
        serverName: 'mtrx.test',
      }),
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'PUT',
      headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
    });
  });
});
