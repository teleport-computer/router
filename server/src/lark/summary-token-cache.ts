import { randomBytes } from 'crypto';
import type { SummaryResult } from './llm-summarize.js';

export interface SummaryTokenData {
  summary: SummaryResult;
  interpretation: string;
  chatId: string;
  chatName: string;
  teamId: string;
  defaultArchiveChannelId: string;
  organizerOpenId: string;
  generatedAt: number;
}

export interface SummaryTokenCache {
  put(data: SummaryTokenData): string;
  take(token: string): SummaryTokenData | null;
}

const TTL_MS = 60 * 60 * 1000;

export function createSummaryTokenCache(opts: { now?: () => number } = {}): SummaryTokenCache {
  const now = opts.now ?? Date.now;
  const store = new Map<string, SummaryTokenData>();

  function gc() {
    const t = now();
    for (const [k, v] of store) {
      if (t - v.generatedAt > TTL_MS) store.delete(k);
    }
  }

  return {
    put(data) {
      const token = randomBytes(12).toString('hex');
      store.set(token, data);
      gc();
      return token;
    },
    take(token) {
      const entry = store.get(token);
      if (!entry) return null;
      store.delete(token);
      if (now() - entry.generatedAt > TTL_MS) return null;
      return entry;
    },
  };
}
