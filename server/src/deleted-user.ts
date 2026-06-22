/**
 * Deleted-user placeholder utilities — see
 * docs/superpowers/specs/2026-05-14-handle-reuse-leak-fix-design.md.
 *
 * When a user is deleted, all handle references in entries / comments /
 * notifications / follows are rewritten to a placeholder of the form
 * `_deleted_<6 hex chars>` (eg `_deleted_a3f9b2`). The leading underscore
 * makes the placeholder fail the standard `isValidHandle` check (which
 * requires `^[a-z][a-z0-9_]*$`), so it cannot be registered as a real handle
 * — defense in depth: also explicitly rejected in `isReservedHandlePattern`.
 *
 * Per-delete random suffix means deleting and re-deleting the same handle
 * (after re-registration) produces distinct placeholders, so the two
 * deleted users' entries don't conflate under one tombstone.
 */

import { randomBytes } from 'node:crypto';

const PLACEHOLDER_PREFIX = '_deleted_';
const PLACEHOLDER_SUFFIX_LEN = 6;
const PLACEHOLDER_RE = /^_deleted_[0-9a-f]{6}$/;

/** Generate a fresh placeholder for an in-flight delete event. */
export function generateDeletedHandle(): string {
  // 3 bytes = 6 hex chars = 16,777,216 distinct values; collision negligible
  // at our scale (a team has well under 1000 lifetime users).
  return PLACEHOLDER_PREFIX + randomBytes(3).toString('hex');
}

/** True if the handle was assigned by the anonymize-on-delete flow. */
export function isDeletedHandle(handle: string): boolean {
  return PLACEHOLDER_RE.test(handle);
}

/**
 * True if the handle matches a system-reserved pattern that registration
 * MUST refuse, even if it would otherwise be valid. Prevents intentional
 * impersonation of a deleted-user placeholder.
 *
 * Note: standard `isValidHandle` (identity.ts) already rejects anything
 * starting with `_` because it requires a letter prefix. This function is
 * a belt-and-suspenders check to use at every registration entry point in
 * case validation evolves.
 */
export function isReservedHandlePattern(handle: string): boolean {
  return PLACEHOLDER_RE.test(handle);
}
