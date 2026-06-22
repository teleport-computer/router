import { createHash } from 'crypto';

export interface SignatureInput {
  token: string;       // verification_token from Lark app config
  timestamp: string;
  nonce: string;
  body: string;
}

export function computeCardSignature(input: SignatureInput): string {
  // Lark card callback signature = sha256(timestamp + nonce + token + body)
  return createHash('sha256').update(input.timestamp + input.nonce + input.token + input.body).digest('hex');
}

export function verifyCardSignature(input: SignatureInput & { signature: string }): boolean {
  return computeCardSignature(input) === input.signature;
}
