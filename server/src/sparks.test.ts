import { describe, expect, it, vi } from 'vitest';
import { hashSecretKey } from './identity.js';
import { MemoryStorage, type RouterEntry, type RouterUser } from './storage.js';
import {
  canModerateSparks,
  detectSparks,
  evaluateSpark,
  executeSpark,
  findRecentMatrixSparkConversation,
  getConnectionInfo,
  getSparkDebounceTopicTerms,
  getUnexpectedSparkHandles,
  type MatrixSparkGateway,
  type MatrixSparkMessage,
  type SparkCandidate,
} from './sparks.js';

function entry(input: Partial<RouterEntry> & Pick<RouterEntry, 'handle' | 'teamId' | 'content' | 'summary' | 'tags'>): Omit<RouterEntry, 'id'> {
  return {
    client: 'code',
    timestamp: Date.now(),
    ...input,
  };
}

async function bootstrap() {
  const storage = new MemoryStorage();
  await storage.createTeam({ id: 'shape', name: 'Shape', createdBy: 'alice', createdAt: 1 });
  await storage.createTeam({ id: 'other', name: 'Other', createdBy: 'mallory', createdAt: 1 });
  for (const user of [
    { handle: 'alice', teamId: 'shape', matrixUserId: '@alice:mtrx.test', isAdmin: true },
    { handle: 'bob', teamId: 'shape', matrixUserId: '@bob:mtrx.test' },
    { handle: 'carol', teamId: 'shape', matrixUserId: '@carol:mtrx.test' },
    { handle: 'mallory', teamId: 'other', matrixUserId: '@mallory:mtrx.test' },
  ] as Array<Partial<RouterUser> & Pick<RouterUser, 'handle' | 'teamId'>>) {
    await storage.createUser({
      handle: user.handle,
      teamId: user.teamId,
      secretKeyHash: hashSecretKey(`${user.handle}-key`),
      isAdmin: user.isAdmin,
      matrixUserId: user.matrixUserId,
      matrixBoundAt: user.matrixUserId ? 1 : undefined,
    });
  }
  return storage;
}

class FakeMatrix implements MatrixSparkGateway {
  createdRooms: Array<{ roomId: string; inviteUserIds: string[]; sourceHandle: string; targetHandle: string; topic: string }> = [];
  roomMessages: Array<{ roomId: string; text: string }> = [];
  dms: Array<{ userId: string; text: string }> = [];
  contexts: Array<{ roomId: string; sourceHandle: string; targetHandle: string; evidenceCount: number }> = [];
  pairs = new Map<string, { sourceHandle: string; targetHandle: string } | null>();
  recentMessages: MatrixSparkMessage[] = [];

  async createEncryptedSparkRoom(input: { name: string; topic: string; inviteUserIds: string[]; sourceHandle: string; targetHandle: string }): Promise<{ roomId: string }> {
    const roomId = `!spark-${this.createdRooms.length + 1}:mtrx.test`;
    this.createdRooms.push({ roomId, ...input });
    this.pairs.set(roomId, { sourceHandle: input.sourceHandle, targetHandle: input.targetHandle });
    return { roomId };
  }

  async sendRoomMessage(roomId: string, text: string): Promise<void> {
    this.roomMessages.push({ roomId, text });
  }

  async sendEncryptedDM(userId: string, text: string): Promise<{ roomId?: string }> {
    this.dms.push({ userId, text });
    return { roomId: `!dm-${userId}:mtrx.test` };
  }

  async postSparkContext(roomId: string, spark: { sourceHandle: string; targetHandle: string; evidence: any[] }): Promise<void> {
    this.contexts.push({ roomId, sourceHandle: spark.sourceHandle, targetHandle: spark.targetHandle, evidenceCount: spark.evidence.length });
  }

  async getSparkRoomPair(roomId: string): Promise<{ sourceHandle: string; targetHandle: string } | null> {
    return this.pairs.get(roomId) ?? null;
  }

  async queryRecentMessages(): Promise<MatrixSparkMessage[]> {
    return this.recentMessages;
  }
}

describe('private sparks', () => {
  it('detects sparks only from published visible entries in the same team', async () => {
    const storage = await bootstrap();
    const alice = await storage.addEntry(entry({
      handle: 'alice',
      teamId: 'shape',
      content: 'Working on Matrix onboarding and encrypted introductions',
      summary: 'Matrix onboarding',
      tags: ['matrix', 'onboarding'],
    }));
    await storage.addEntry(entry({
      handle: 'bob',
      teamId: 'shape',
      content: 'Matrix onboarding needs better encrypted room invites',
      summary: 'Encrypted Matrix invites',
      tags: ['matrix', 'onboarding'],
    }));
    await storage.addEntry(entry({
      handle: 'carol',
      teamId: 'shape',
      content: 'Matrix onboarding but private draft',
      summary: 'Hidden Matrix note',
      tags: ['matrix'],
      hidden: true,
    }));
    await storage.addEntry(entry({
      handle: 'carol',
      teamId: 'shape',
      content: 'Matrix onboarding staged for later',
      summary: 'Staged Matrix note',
      tags: ['matrix'],
      publishAt: Date.now() + 60_000,
    }));
    await storage.addEntry(entry({
      handle: 'mallory',
      teamId: 'other',
      content: 'Matrix onboarding in another team',
      summary: 'Other team',
      tags: ['matrix'],
    }));

    const sparks = await detectSparks(alice, storage, ['matrix', 'onboarding']);

    expect(sparks.map(s => s.handle)).toEqual(['bob']);
    expect(sparks[0].overlapTopics).toContain('matrix');
  });

  it('evaluates high-confidence sparks and writes final copy', async () => {
    const storage = await bootstrap();
    const source = await storage.addEntry(entry({
      handle: 'alice',
      teamId: 'shape',
      content: 'I am building encrypted Matrix spark rooms',
      summary: 'Matrix spark rooms',
      tags: ['matrix'],
    }));
    const target = await storage.addEntry(entry({
      handle: 'bob',
      teamId: 'shape',
      content: 'I need encrypted Matrix rooms for introductions',
      summary: 'Encrypted introductions',
      tags: ['matrix'],
    }));
    const llm = vi.fn()
      .mockResolvedValueOnce('{"confidence":"high","reason":"Both are building the same Matrix intro flow."}')
      .mockResolvedValueOnce('{"topic":"Matrix intro rooms","message":"@alice and @bob, you are both circling encrypted Matrix intro rooms."}');

    const action = await evaluateSpark(
      source,
      { handle: 'bob', matchingEntries: [target], overlapTopics: ['matrix'] },
      await getConnectionInfo('shape', 'alice', 'bob', storage),
      llm,
    );

    expect(action).toMatchObject({
      action: 'introduce',
      confidence: 'high',
      reason: 'Matrix intro rooms',
    });
    expect(action.message).toContain('@alice');
    expect(llm).toHaveBeenCalledTimes(2);
  });

  it('suggests moderate-confidence sparks by encrypted DM instead of creating a room', async () => {
    const storage = await bootstrap();
    const matrix = new FakeMatrix();
    const source = await storage.addEntry(entry({
      handle: 'alice',
      teamId: 'shape',
      content: 'Matrix bridge onboarding',
      summary: 'Matrix bridge',
      tags: ['matrix'],
    }));
    const candidate: SparkCandidate = { handle: 'bob', matchingEntries: [], overlapTopics: ['matrix'] };

    const result = await executeSpark('shape', {
      action: 'suggest',
      confidence: 'moderate',
      sourceHandle: 'alice',
      targetHandle: 'bob',
      reason: 'Matrix bridge overlap',
      message: 'You may want to talk with @bob about Matrix bridge onboarding.',
    }, candidate, source, storage, matrix);

    expect(result.status).toBe('suggested');
    expect(matrix.dms).toEqual([{ userId: '@alice:mtrx.test', text: expect.stringContaining('@bob') }]);
    expect(matrix.createdRooms).toHaveLength(0);
  });

  it('creates, records, and reuses encrypted Matrix spark rooms', async () => {
    const storage = await bootstrap();
    const matrix = new FakeMatrix();
    const source = await storage.addEntry(entry({
      handle: 'alice',
      teamId: 'shape',
      content: 'Matrix encrypted rooms',
      summary: 'Matrix rooms',
      tags: ['matrix'],
    }));
    const candidate: SparkCandidate = { handle: 'bob', matchingEntries: [], overlapTopics: ['matrix'] };
    const action = {
      action: 'introduce' as const,
      confidence: 'high' as const,
      sourceHandle: 'alice',
      targetHandle: 'bob',
      reason: 'Matrix rooms',
      message: '@alice and @bob should compare Matrix room work.',
    };

    const first = await executeSpark('shape', action, candidate, source, storage, matrix);
    const second = await executeSpark('shape', action, candidate, source, storage, matrix);

    expect(first.status).toBe('introduced');
    expect(second.roomId).toBe(first.roomId);
    expect(matrix.createdRooms).toHaveLength(1);
    expect(matrix.createdRooms[0].inviteUserIds).toEqual(['@alice:mtrx.test', '@bob:mtrx.test']);
    expect(matrix.contexts[0]).toMatchObject({ sourceHandle: 'alice', targetHandle: 'bob' });
    await expect(storage.getSparkPairRoom('shape', 'bob', 'alice')).resolves.toMatchObject({ roomId: first.roomId });
  });

  it('rejects stale stored rooms whose Matrix spark state belongs to another pair', async () => {
    const storage = await bootstrap();
    const matrix = new FakeMatrix();
    const source = await storage.addEntry(entry({
      handle: 'alice',
      teamId: 'shape',
      content: 'Matrix rooms',
      summary: 'Matrix rooms',
      tags: ['matrix'],
    }));
    await storage.setSparkPairRoom('shape', 'alice', 'bob', '!stale:mtrx.test');
    matrix.pairs.set('!stale:mtrx.test', { sourceHandle: 'alice', targetHandle: 'carol' });

    const result = await executeSpark('shape', {
      action: 'introduce',
      confidence: 'high',
      sourceHandle: 'alice',
      targetHandle: 'bob',
      reason: 'Matrix rooms',
      message: '@alice and @bob should compare Matrix room work.',
    }, { handle: 'bob', matchingEntries: [], overlapTopics: ['matrix'] }, source, storage, matrix);

    expect(result.roomId).not.toBe('!stale:mtrx.test');
    expect(matrix.createdRooms).toHaveLength(1);
    await expect(storage.getSparkPairRoom('shape', 'alice', 'bob')).resolves.toMatchObject({ roomId: result.roomId });
  });

  it('does not reuse stored rooms without Matrix spark state', async () => {
    const storage = await bootstrap();
    const matrix = new FakeMatrix();
    const source = await storage.addEntry(entry({
      handle: 'alice',
      teamId: 'shape',
      content: 'Matrix rooms',
      summary: 'Matrix rooms',
      tags: ['matrix'],
    }));
    await storage.setSparkPairRoom('shape', 'alice', 'bob', '!unmarked:mtrx.test');

    const result = await executeSpark('shape', {
      action: 'introduce',
      confidence: 'high',
      sourceHandle: 'alice',
      targetHandle: 'bob',
      reason: 'Matrix rooms',
      message: '@alice and @bob should compare Matrix room work.',
    }, { handle: 'bob', matchingEntries: [], overlapTopics: ['matrix'] }, source, storage, matrix);

    expect(result.roomId).not.toBe('!unmarked:mtrx.test');
    expect(matrix.roomMessages.map(message => message.roomId)).not.toContain('!unmarked:mtrx.test');
    expect(matrix.createdRooms).toHaveLength(1);
    await expect(storage.getSparkPairRoom('shape', 'alice', 'bob')).resolves.toMatchObject({ roomId: result.roomId });
  });

  it('guards missing Matrix links and unsafe copy that mentions unrelated handles', async () => {
    const storage = await bootstrap();
    const matrix = new FakeMatrix();
    await storage.updateUser('bob', { matrixUserId: undefined, matrixBoundAt: undefined });
    const source = await storage.addEntry(entry({
      handle: 'alice',
      teamId: 'shape',
      content: 'Matrix rooms',
      summary: 'Matrix rooms',
      tags: ['matrix'],
    }));

    const missing = await executeSpark('shape', {
      action: 'introduce',
      confidence: 'high',
      sourceHandle: 'alice',
      targetHandle: 'bob',
      reason: 'Matrix rooms',
      message: '@alice and @bob should compare Matrix rooms.',
    }, { handle: 'bob', matchingEntries: [], overlapTopics: ['matrix'] }, source, storage, matrix);
    expect(missing).toMatchObject({ status: 'skipped', reason: expect.stringContaining('Matrix links') });

    await storage.updateUser('bob', { matrixUserId: '@bob:mtrx.test', matrixBoundAt: 1 });
    const unsafe = await executeSpark('shape', {
      action: 'introduce',
      confidence: 'high',
      sourceHandle: 'alice',
      targetHandle: 'bob',
      reason: 'Matrix rooms',
      message: '@alice, @bob, and @carol should meet.',
    }, { handle: 'bob', matchingEntries: [], overlapTopics: ['matrix'] }, source, storage, matrix);
    expect(unsafe).toMatchObject({ status: 'skipped', reason: expect.stringContaining('@carol') });
  });

  it('debounces when both users are already discussing the spark topic in Matrix', async () => {
    const storage = await bootstrap();
    const matrix = new FakeMatrix();
    matrix.recentMessages = [
      { roomId: '!room', roomName: 'Matrix Work', senderHandle: 'alice', text: 'encrypted matrix onboarding room work', timestamp: Date.now() },
      { roomId: '!room', roomName: 'Matrix Work', senderHandle: 'bob', text: 'matrix onboarding has room invite issues', timestamp: Date.now() },
    ];
    const source = await storage.addEntry(entry({
      handle: 'alice',
      teamId: 'shape',
      content: 'encrypted matrix onboarding rooms',
      summary: 'Matrix onboarding',
      tags: ['matrix', 'onboarding'],
    }));
    const candidate = { handle: 'bob', matchingEntries: [], overlapTopics: ['matrix', 'onboarding'] };
    const terms = getSparkDebounceTopicTerms({ reason: 'Matrix onboarding' }, candidate, source);

    expect(findRecentMatrixSparkConversation(matrix.recentMessages, 'alice', 'bob', terms)?.roomName).toBe('Matrix Work');

    const result = await executeSpark('shape', {
      action: 'introduce',
      confidence: 'high',
      sourceHandle: 'alice',
      targetHandle: 'bob',
      reason: 'Matrix onboarding',
      message: '@alice and @bob should compare Matrix onboarding.',
    }, candidate, source, storage, matrix);

    expect(result).toMatchObject({ status: 'skipped', reason: expect.stringContaining('Recent Matrix conversation') });
    expect(matrix.createdRooms).toHaveLength(0);
  });

  it('allows only admins or configured moderators to manually moderate sparks', () => {
    expect(canModerateSparks({ handle: 'alice', teamId: 'shape', secretKeyHash: 'h', createdAt: 1, isAdmin: true })).toBe(true);
    expect(canModerateSparks(
      { handle: 'mod', teamId: 'shape', secretKeyHash: 'h', createdAt: 1 },
      { SPARK_MODERATOR_HANDLES: 'mod,other' } as any,
    )).toBe(true);
    expect(canModerateSparks(
      { handle: 'member', teamId: 'shape', secretKeyHash: 'h', createdAt: 1 },
      { SPARK_MODERATOR_HANDLES: 'mod' } as any,
    )).toBe(false);
  });

  it('detects unrelated handles in generated spark copy', () => {
    expect(getUnexpectedSparkHandles('@alice meet @bob', 'alice', 'bob')).toEqual([]);
    expect(getUnexpectedSparkHandles('@alice meet @bob and @carol', 'alice', 'bob')).toEqual(['carol']);
  });
});
