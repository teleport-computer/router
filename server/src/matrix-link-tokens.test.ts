import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearMatrixLinkTokens,
  generateMatrixLinkCode,
  getActiveMatrixLinkTokenCount,
  isMatrixUserId,
  matrixHandleBase,
  redeemMatrixLinkCode,
} from './matrix-link-tokens.js';

describe('matrix-link-tokens', () => {
  beforeEach(() => clearMatrixLinkTokens());

  it('validates Matrix user IDs', () => {
    expect(isMatrixUserId('@alice:mtrx.shaperotator.xyz')).toBe(true);
    expect(isMatrixUserId('@alice:example.org:8448')).toBe(true);
    expect(isMatrixUserId('alice')).toBe(false);
    expect(isMatrixUserId('@missing-domain')).toBe(false);
  });

  it('generates one-time team-scoped codes', () => {
    const token = generateMatrixLinkCode({
      matrixUserId: '@alice:mtrx.shaperotator.xyz',
      teamId: 'shape',
      issuedByHandle: 'matrix_bot',
      ttlMs: 1000,
      now: 10_000,
    });

    expect(token.code).toMatch(/^MATRIX-[A-Z0-9]+$/);
    expect(getActiveMatrixLinkTokenCount(10_500)).toBe(1);
    expect(redeemMatrixLinkCode(token.code, 'other', 10_500)).toBeNull();
    expect(redeemMatrixLinkCode(token.code.toLowerCase(), 'shape', 10_500)?.matrixUserId)
      .toBe('@alice:mtrx.shaperotator.xyz');
    expect(redeemMatrixLinkCode(token.code, 'shape', 10_500)).toBeNull();
  });

  it('expires codes', () => {
    const token = generateMatrixLinkCode({
      matrixUserId: '@alice:mtrx.shaperotator.xyz',
      teamId: 'shape',
      issuedByHandle: 'matrix_bot',
      ttlMs: 1000,
      now: 10_000,
    });

    expect(redeemMatrixLinkCode(token.code, 'shape', 11_001)).toBeNull();
    expect(getActiveMatrixLinkTokenCount(11_001)).toBe(0);
  });

  it('derives Router-safe handle bases from Matrix IDs', () => {
    expect(matrixHandleBase('@Alice.Smith:mtrx.shaperotator.xyz')).toBe('alice_smith');
    expect(matrixHandleBase('@12:mtrx.shaperotator.xyz')).toBe('m_12');
    expect(matrixHandleBase('@a:mtrx.shaperotator.xyz')).toBe('a_mx');
  });
});
