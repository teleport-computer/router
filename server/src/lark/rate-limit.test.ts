import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit.js';

describe('rate-limit', () => {
  it('first call passes', () => {
    const rl = createRateLimiter({ windowMs: 1000, now: () => 0 });
    expect(rl.check('a:b')).toEqual({ allowed: true });
  });

  it('second within window blocked', () => {
    let t = 0;
    const rl = createRateLimiter({ windowMs: 1000, now: () => t });
    rl.check('a:b');
    t = 500;
    expect(rl.check('a:b')).toMatchObject({ allowed: false, retryInMs: 500 });
  });

  it('after window passes again', () => {
    let t = 0;
    const rl = createRateLimiter({ windowMs: 1000, now: () => t });
    rl.check('a:b');
    t = 1500;
    expect(rl.check('a:b')).toEqual({ allowed: true });
  });

  it('different keys independent', () => {
    let t = 0;
    const rl = createRateLimiter({ windowMs: 1000, now: () => t });
    rl.check('a:b');
    expect(rl.check('a:c').allowed).toBe(true);
  });
});
