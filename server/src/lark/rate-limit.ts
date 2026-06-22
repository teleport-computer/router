export interface RateLimiter {
  check(key: string): { allowed: true } | { allowed: false; retryInMs: number };
}

export function createRateLimiter(opts: { windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const last = new Map<string, number>();
  return {
    check(key: string) {
      const t = now();
      const prev = last.get(key);
      if (prev != null && t - prev < opts.windowMs) {
        return { allowed: false, retryInMs: opts.windowMs - (t - prev) };
      }
      last.set(key, t);
      return { allowed: true };
    },
  };
}
