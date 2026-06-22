import { describe, expect, it } from 'vitest';
import { MemoryStorage, type RouterEntry } from './storage.js';
import {
  buildMatrixEntryMirrorContent,
  formatMatrixEntryMirror,
  isMatrixEntryMirrorable,
  matrixEntryMirrorTxnId,
  maybeMirrorEntryToMatrix,
  resolveMatrixEntryMirrorRoomId,
} from './matrix-entry-mirror.js';

function entry(input: Partial<RouterEntry> = {}): RouterEntry {
  return {
    id: 'entry-123',
    handle: 'alice',
    teamId: 'shape',
    client: 'code',
    content: 'Full private Router note about Matrix parity.',
    summary: 'Matrix parity note',
    tags: ['matrix', 'private-router'],
    timestamp: 123,
    ...input,
  };
}

describe('matrix entry mirror', () => {
  it('resolves the configured Bot Noise room id', () => {
    expect(resolveMatrixEntryMirrorRoomId({ MATRIX_ENTRY_MIRROR_ROOM_ID: '!entry:room' } as NodeJS.ProcessEnv)).toBe('!entry:room');
    expect(resolveMatrixEntryMirrorRoomId({ MATRIX_BOT_NOISE_ROOM_ID: '!noise:room' } as NodeJS.ProcessEnv)).toBe('!noise:room');
    expect(resolveMatrixEntryMirrorRoomId({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('only mirrors published visible entries that are not already mirrored', () => {
    expect(isMatrixEntryMirrorable(entry())).toBe(true);
    expect(isMatrixEntryMirrorable(entry({ hidden: true }))).toBe(false);
    expect(isMatrixEntryMirrorable(entry({ publishAt: 200 }), 100)).toBe(false);
    expect(isMatrixEntryMirrorable(entry({ publishAt: 100 }), 200)).toBe(true);
    expect(isMatrixEntryMirrorable(entry({ matrixMirrorEventId: '$event' }))).toBe(false);
    expect(isMatrixEntryMirrorable(entry({ matrixMirroredAt: 100 }))).toBe(false);
  });

  it('formats a Matrix fallback message and Router Client metadata', () => {
    const note = entry();
    const text = formatMatrixEntryMirror(note, 'https://shape.test/');
    expect(text).toContain('@alice:');
    expect(text).toContain('Matrix parity note');
    expect(text).toContain('#matrix #private-router');
    expect(text).toContain('https://shape.test/entry?id=entry-123');

    expect(buildMatrixEntryMirrorContent(note, 'https://shape.test/')).toMatchObject({
      entry_id: 'entry-123',
      author_handle: 'alice',
      content: 'Full private Router note about Matrix parity.',
      summary: 'Matrix parity note',
      permalink: 'https://shape.test/entry?id=entry-123',
      topic_hints: ['matrix', 'private-router'],
      source: 'private-router',
    });
  });

  it('formats linked authors as real Matrix mentions with notebook display names', () => {
    const note = entry({ handle: 'specularist' });
    const content = buildMatrixEntryMirrorContent(note, 'https://shape.test/', {
      handle: 'specularist',
      displayName: 'James Barnes',
      matrixUserId: '@specularist:matrix.org',
    });

    expect(content.body).toContain('James Barnes (@specularist):');
    expect(content.formatted_body).toContain('https://matrix.to/#/%40specularist%3Amatrix.org');
    expect(content.formatted_body).toContain('James Barnes (@specularist)');
    expect(content['m.mentions']).toEqual({ user_ids: ['@specularist:matrix.org'] });
    expect(content).toMatchObject({
      author_handle: 'specularist',
      author_display_name: 'James Barnes',
      author_matrix_user_id: '@specularist:matrix.org',
    });
  });

  it('falls back to the notebook handle when the linked author has no display name', () => {
    const note = entry({ handle: 'specularist' });
    const content = buildMatrixEntryMirrorContent(note, 'https://shape.test/', {
      handle: 'specularist',
      matrixUserId: '@specularist:matrix.org',
    });

    expect(content.body).toContain('@specularist:');
    expect(content.formatted_body).toContain('>@specularist</a>:');
    expect(content['m.mentions']).toEqual({ user_ids: ['@specularist:matrix.org'] });
  });

  it('uses deterministic Matrix transaction ids derived from entry ids', () => {
    expect(matrixEntryMirrorTxnId('abc/123')).toBe('router-entry-mirror-abc_123');
  });

  it('sends once and persists the Matrix mirror marker', async () => {
    const storage = new MemoryStorage();
    await storage.createUser({
      handle: 'alice',
      secretKeyHash: 'hash-alice',
      teamId: 'shape',
      displayName: 'Alice Example',
      matrixUserId: '@alice:mtrx.test',
      matrixBoundAt: 1,
    });
    const saved = await storage.addEntry(entry({ id: undefined as never }));
    const sends: Array<{ roomId: string; text: string; txnId: string; content: Record<string, unknown> }> = [];

    const first = await maybeMirrorEntryToMatrix(saved, storage, {
      env: {
        MATRIX_BOT_NOISE_ROOM_ID: '!noise:mtrx.test',
        PUBLIC_URL: 'https://shape.test',
      } as NodeJS.ProcessEnv,
      now: () => 1000,
      sendRoomMessage: async (roomId, text, options) => {
        sends.push({ roomId, text, txnId: options.txnId, content: options.content });
        return { eventId: '$mirror-event' };
      },
    });
    const second = await maybeMirrorEntryToMatrix(saved, storage, {
      env: { MATRIX_BOT_NOISE_ROOM_ID: '!noise:mtrx.test' } as NodeJS.ProcessEnv,
      sendRoomMessage: async () => {
        throw new Error('second send should be skipped');
      },
    });

    expect(first).toMatchObject({ status: 'mirrored', roomId: '!noise:mtrx.test', eventId: '$mirror-event' });
    expect(second).toMatchObject({ status: 'skipped', reason: 'not-mirrorable' });
    expect(sends).toHaveLength(1);
    expect(sends[0].txnId).toBe(matrixEntryMirrorTxnId(saved.id));
    expect(sends[0].text).toContain('Alice Example (@alice):');
    expect(sends[0].content['m.mentions']).toEqual({ user_ids: ['@alice:mtrx.test'] });
    expect(sends[0].content).toMatchObject({
      author_display_name: 'Alice Example',
      author_matrix_user_id: '@alice:mtrx.test',
    });
    await expect(storage.getEntry(saved.id)).resolves.toMatchObject({
      matrixMirrorRoomId: '!noise:mtrx.test',
      matrixMirrorEventId: '$mirror-event',
      matrixMirroredAt: 1000,
    });
  });

  it('rechecks storage before sending so newly hidden entries are skipped', async () => {
    const storage = new MemoryStorage();
    const saved = await storage.addEntry(entry({ id: undefined as never }));
    await storage.updateEntry(saved.id, { hidden: true });

    const result = await maybeMirrorEntryToMatrix(saved, storage, {
      env: { MATRIX_BOT_NOISE_ROOM_ID: '!noise:mtrx.test' } as NodeJS.ProcessEnv,
      sendRoomMessage: async () => {
        throw new Error('hidden entry should not be sent');
      },
    });

    expect(result).toMatchObject({ status: 'skipped', reason: 'not-mirrorable' });
  });
});
