/**
 * Display helpers for handle-related UI rendering.
 *
 * Background: when a user is deleted, all handle references in the team data
 * (entry author, comment author, notification recipient, follow lists) are
 * rewritten to a placeholder of the form `_deleted_<6 hex>`. The freed
 * handle stays available for re-registration. See the spec at
 * docs/superpowers/specs/2026-05-14-handle-reuse-leak-fix-design.md.
 *
 * Renderers should NOT show `_deleted_<hex>` to users — show `(deleted user)`
 * instead, and don't link to a profile page (it would 404 / show empty state).
 */

const DELETED_HANDLE_RE = /^_deleted_[0-9a-f]{6}$/;

export function isDeletedHandle(handle: string | undefined | null): boolean {
  return typeof handle === 'string' && DELETED_HANDLE_RE.test(handle);
}

/**
 * Format a handle for display. Returns `@<handle>` for normal users and the
 * literal `(deleted user)` for placeholders. Pass to anywhere we'd otherwise
 * write `@{handle}` in JSX.
 */
export function displayHandle(handle: string | undefined | null): string {
  if (!handle) return '';
  if (isDeletedHandle(handle)) return '(deleted user)';
  return `@${handle}`;
}
