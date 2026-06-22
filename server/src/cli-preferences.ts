import type { Storage, RouterUser } from './storage.js';

export interface PreferencesResponse {
  sync_mode: 'active' | 'passive';
  preview_mode: 'always' | 'never';
  privacy_strip_custom: string[];
}

export function userToPreferences(user: RouterUser): PreferencesResponse {
  return {
    sync_mode: user.syncMode ?? 'active',
    preview_mode: user.previewMode ?? 'always',
    privacy_strip_custom: user.privacyStripCustom ?? [],
  };
}

export interface PatchPreferencesBody {
  sync_mode?: 'active' | 'passive';
  preview_mode?: 'always' | 'never';
  privacy_strip_custom?: string[];
}

export function validatePatch(body: unknown): { ok: true; value: PatchPreferencesBody } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid_body' };
  const b = body as Record<string, unknown>;
  const out: PatchPreferencesBody = {};
  if (b.sync_mode !== undefined) {
    if (b.sync_mode !== 'active' && b.sync_mode !== 'passive') return { ok: false, error: 'invalid_sync_mode' };
    out.sync_mode = b.sync_mode;
  }
  if (b.preview_mode !== undefined) {
    if (b.preview_mode !== 'always' && b.preview_mode !== 'never') return { ok: false, error: 'invalid_preview_mode' };
    out.preview_mode = b.preview_mode;
  }
  if (b.privacy_strip_custom !== undefined) {
    if (!Array.isArray(b.privacy_strip_custom) || !b.privacy_strip_custom.every(x => typeof x === 'string')) {
      return { ok: false, error: 'invalid_privacy_strip_custom' };
    }
    out.privacy_strip_custom = b.privacy_strip_custom as string[];
  }
  return { ok: true, value: out };
}

export async function applyPatch(storage: Storage, handle: string, body: PatchPreferencesBody): Promise<void> {
  await storage.updateUserPreferences(handle, {
    syncMode: body.sync_mode,
    previewMode: body.preview_mode,
    privacyStripCustom: body.privacy_strip_custom,
  });
}
