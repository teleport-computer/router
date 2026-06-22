import { randomBytes } from 'crypto';

export interface MatrixLinkToken {
  code: string;
  matrixUserId: string;
  teamId: string;
  issuedByHandle: string;
  createdAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const tokens = new Map<string, MatrixLinkToken>();

export function isMatrixUserId(value: unknown): value is string {
  return typeof value === 'string'
    && /^@[A-Za-z0-9._=\-/+]+:[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(value);
}

export function generateMatrixLinkCode(input: {
  matrixUserId: string;
  teamId: string;
  issuedByHandle: string;
  ttlMs?: number;
  now?: number;
}): MatrixLinkToken {
  pruneExpired(input.now);
  const now = input.now ?? Date.now();
  const code = `MATRIX-${randomBytes(5).toString('base64url').replace(/[-_]/g, '').slice(0, 8).toUpperCase()}`;
  const token: MatrixLinkToken = {
    code,
    matrixUserId: input.matrixUserId,
    teamId: input.teamId,
    issuedByHandle: input.issuedByHandle,
    createdAt: now,
    expiresAt: now + (input.ttlMs ?? DEFAULT_TTL_MS),
  };
  tokens.set(code, token);
  return token;
}

export function redeemMatrixLinkCode(code: string, teamId: string, now = Date.now()): MatrixLinkToken | null {
  const normalized = code.trim().toUpperCase();
  const token = tokens.get(normalized);
  if (!token) return null;
  if (token.teamId !== teamId || now > token.expiresAt) {
    if (now > token.expiresAt) tokens.delete(normalized);
    return null;
  }
  tokens.delete(normalized);
  return token;
}

export function getActiveMatrixLinkTokenCount(now = Date.now()): number {
  pruneExpired(now);
  return tokens.size;
}

export function clearMatrixLinkTokens(): void {
  tokens.clear();
}

function pruneExpired(now = Date.now()): void {
  for (const [code, token] of tokens) {
    if (now > token.expiresAt) tokens.delete(code);
  }
}

export function matrixHandleBase(matrixUserId: string): string {
  const localpart = matrixUserId.replace(/^@/, '').split(':')[0] || 'matrix';
  let handle = localpart
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(handle)) handle = `m_${handle}`;
  if (handle.length < 3) handle = `${handle}_mx`;
  return handle.slice(0, 15).replace(/_+$/g, '') || 'matrix_user';
}
