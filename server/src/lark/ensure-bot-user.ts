import { createHash, randomBytes } from 'crypto';
import type { Storage, RouterUser } from '../storage.js';

export async function ensureBotUser(storage: Storage, teamId: string): Promise<RouterUser> {
  const handle = `lark-bot-${teamId}`;
  const existing = await storage.getUser(handle);
  if (existing) {
    // Migrate displayName for users seeded under earlier Chinese name
    if (existing.displayName !== 'lark bot') {
      try {
        await storage.updateUser(handle, { displayName: 'lark bot' });
      } catch {
        // best-effort; don't break ensureBotUser if updateUser doesn't exist
      }
    }
    return existing;
  }

  const dummyKey = randomBytes(32).toString('hex');
  const secretKeyHash = createHash('sha256').update(dummyKey).digest('hex');

  return await storage.createUser({
    handle,
    teamId,
    secretKeyHash,
    displayName: 'lark bot',
    bio: 'Auto-created by router for Lark group summaries. Do not log in.',
    isAdmin: false,
  } as any);
}
