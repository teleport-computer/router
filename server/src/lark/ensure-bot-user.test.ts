import { describe, expect, it } from 'vitest';
import { ensureBotUser } from './ensure-bot-user.js';
import { MemoryStorage } from '../storage.js';

describe('ensureBotUser', () => {
  it('creates lark-bot-{teamId} user on first call', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 'T1', createdBy: 'a', createdAt: 0 } as any);
    const user = await ensureBotUser(storage, 't1');
    expect(user.handle).toBe('lark-bot-t1');
    expect(user.teamId).toBe('t1');
    expect(user.displayName).toBe('lark bot');
    expect(user.isAdmin).toBe(false);
  });

  it('returns existing user on subsequent calls', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 'T1', createdBy: 'a', createdAt: 0 } as any);
    const u1 = await ensureBotUser(storage, 't1');
    const u2 = await ensureBotUser(storage, 't1');
    expect(u1.handle).toBe(u2.handle);
    expect(u1.createdAt).toBe(u2.createdAt);
  });

  it('creates per-team bot users separately', async () => {
    const storage = new MemoryStorage();
    await storage.createTeam({ id: 't1', name: 'T1', createdBy: 'a', createdAt: 0 } as any);
    await storage.createTeam({ id: 't2', name: 'T2', createdBy: 'a', createdAt: 0 } as any);
    const u1 = await ensureBotUser(storage, 't1');
    const u2 = await ensureBotUser(storage, 't2');
    expect(u1.handle).toBe('lark-bot-t1');
    expect(u2.handle).toBe('lark-bot-t2');
  });
});
