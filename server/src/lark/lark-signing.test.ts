import { describe, expect, it } from 'vitest';
import { computeCardSignature, verifyCardSignature } from './lark-signing.js';

const TOKEN = 'verify_token_test';

describe('lark card callback signing', () => {
  it('computeCardSignature is deterministic', () => {
    const s1 = computeCardSignature({ token: TOKEN, timestamp: '12345', nonce: 'n', body: '{"x":1}' });
    const s2 = computeCardSignature({ token: TOKEN, timestamp: '12345', nonce: 'n', body: '{"x":1}' });
    expect(s1).toBe(s2);
    expect(s1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verifyCardSignature returns true with matching headers', () => {
    const sig = computeCardSignature({ token: TOKEN, timestamp: '1', nonce: 'a', body: 'b' });
    expect(verifyCardSignature({ token: TOKEN, timestamp: '1', nonce: 'a', body: 'b', signature: sig })).toBe(true);
  });

  it('verifyCardSignature false with tampered body', () => {
    const sig = computeCardSignature({ token: TOKEN, timestamp: '1', nonce: 'a', body: 'b' });
    expect(verifyCardSignature({ token: TOKEN, timestamp: '1', nonce: 'a', body: 'BAD', signature: sig })).toBe(false);
  });
});
