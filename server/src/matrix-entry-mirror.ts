import type { RouterEntry, RouterUser, Storage } from './storage.js';
import { sendMatrixRoomMessageFromEnv, type MatrixRoomSendResult } from './matrix-spark-gateway.js';

const MATRIX_ENTRY_MIRROR_MAX_BODY_CHARS = 3500;

export interface MatrixEntryMirrorAuthor {
  handle: string;
  displayName?: string;
  matrixUserId?: string;
}

export interface MatrixEntryMirrorOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  sendRoomMessage?: (
    roomId: string,
    text: string,
    options: { txnId: string; content: Record<string, unknown>; env: NodeJS.ProcessEnv },
  ) => Promise<MatrixRoomSendResult | null>;
}

export interface MatrixEntryMirrorResult {
  status: 'mirrored' | 'skipped';
  reason?: string;
  roomId?: string;
  eventId?: string;
}

export function resolveMatrixEntryMirrorRoomId(env: NodeJS.ProcessEnv = process.env): string | null {
  return (
    env.MATRIX_ENTRY_MIRROR_ROOM_ID?.trim()
    || env.MATRIX_BOT_NOISE_ROOM_ID?.trim()
    || null
  );
}

export function matrixEntryMirrorTxnId(entryId: string): string {
  return `router-entry-mirror-${entryId.replace(/[^a-zA-Z0-9._=-]/g, '_')}`;
}

export function isMatrixEntryMirrorable(entry: RouterEntry, now = Date.now()): boolean {
  if (entry.hidden) return false;
  if (entry.publishAt !== undefined && entry.publishAt !== null && entry.publishAt > now) return false;
  if (entry.matrixMirrorEventId || entry.matrixMirroredAt) return false;
  return true;
}

export function formatMatrixEntryMirror(
  entry: RouterEntry,
  publicUrl?: string,
  author: MatrixEntryMirrorAuthor = { handle: entry.handle },
): string {
  const permalink = entryPermalink(entry, publicUrl);
  const displayText = (entry.summary || entry.content || '').trim();
  const lines = [
    `${formatMatrixEntryMirrorAuthor(author)}:`,
    '',
    displayText || '(no summary)',
  ];
  if (entry.tags.length > 0) {
    lines.push('', `Tags: ${entry.tags.map(tag => `#${tag}`).join(' ')}`);
  }
  if (permalink) {
    lines.push('', permalink);
  }
  return truncate(lines.join('\n'), MATRIX_ENTRY_MIRROR_MAX_BODY_CHARS);
}

export function buildMatrixEntryMirrorContent(
  entry: RouterEntry,
  publicUrl?: string,
  author: MatrixEntryMirrorAuthor = { handle: entry.handle },
): Record<string, unknown> {
  const permalink = entryPermalink(entry, publicUrl);
  const body = formatMatrixEntryMirror(entry, publicUrl, author);
  const formattedBody = formatMatrixEntryMirrorHtml(entry, publicUrl, author);
  return {
    msgtype: 'm.text',
    body,
    format: 'org.matrix.custom.html',
    formatted_body: formattedBody,
    ...(author.matrixUserId ? { 'm.mentions': { user_ids: [author.matrixUserId] } } : {}),
    entry_id: entry.id,
    author_handle: entry.handle,
    author_display_name: author.displayName,
    author_matrix_user_id: author.matrixUserId,
    content: entry.content,
    summary: entry.summary,
    permalink,
    topic_hints: entry.tags,
    source: 'private-router',
  };
}

export async function maybeMirrorEntryToMatrix(
  entry: RouterEntry,
  storage: Storage,
  options: MatrixEntryMirrorOptions = {},
): Promise<MatrixEntryMirrorResult> {
  const env = options.env || process.env;
  const roomId = resolveMatrixEntryMirrorRoomId(env);
  if (!roomId) return { status: 'skipped', reason: 'no-room-configured' };

  const now = options.now || (() => Date.now());
  const current = await storage.getEntry(entry.id) || entry;
  if (!isMatrixEntryMirrorable(current, now())) {
    return { status: 'skipped', reason: 'not-mirrorable' };
  }

  const txnId = matrixEntryMirrorTxnId(current.id);
  const author = await resolveMatrixEntryMirrorAuthor(current, storage);
  const content = buildMatrixEntryMirrorContent(current, env.PUBLIC_URL, author);
  const text = String(content.body);
  const send = options.sendRoomMessage || defaultSendRoomMessage;
  const result = await send(roomId, text, { txnId, content, env });
  if (!result) {
    throw new Error('Matrix entry mirror room is configured, but Matrix send environment is missing.');
  }

  const eventId = result.eventId || txnId;
  await storage.updateEntry(current.id, {
    matrixMirrorRoomId: roomId,
    matrixMirrorEventId: eventId,
    matrixMirroredAt: now(),
  });
  return { status: 'mirrored', roomId, eventId };
}

function defaultSendRoomMessage(
  roomId: string,
  text: string,
  options: { txnId: string; content: Record<string, unknown>; env: NodeJS.ProcessEnv },
): Promise<MatrixRoomSendResult | null> {
  return sendMatrixRoomMessageFromEnv(roomId, text, {
    env: options.env,
    txnId: options.txnId,
    content: options.content,
  });
}

function entryPermalink(entry: RouterEntry, publicUrl?: string): string | undefined {
  const base = publicUrl?.trim().replace(/\/$/, '');
  return base ? `${base}/entry?id=${encodeURIComponent(entry.id)}` : undefined;
}

async function resolveMatrixEntryMirrorAuthor(entry: RouterEntry, storage: Storage): Promise<MatrixEntryMirrorAuthor> {
  const user = await storage.getUser(entry.handle).catch(() => null);
  if (!user || user.teamId !== entry.teamId) return { handle: entry.handle };
  return matrixEntryMirrorAuthorFromUser(entry, user);
}

function matrixEntryMirrorAuthorFromUser(entry: RouterEntry, user: RouterUser): MatrixEntryMirrorAuthor {
  return {
    handle: entry.handle,
    displayName: user.displayName?.trim() || undefined,
    matrixUserId: user.matrixUserId?.trim() || undefined,
  };
}

function formatMatrixEntryMirrorAuthor(author: MatrixEntryMirrorAuthor): string {
  const handle = `@${author.handle}`;
  return author.displayName ? `${author.displayName} (${handle})` : handle;
}

function formatMatrixEntryMirrorHtml(
  entry: RouterEntry,
  publicUrl: string | undefined,
  author: MatrixEntryMirrorAuthor,
): string {
  const permalink = entryPermalink(entry, publicUrl);
  const displayText = (entry.summary || entry.content || '').trim() || '(no summary)';
  const authorText = formatMatrixEntryMirrorAuthor(author);
  const authorHtml = author.matrixUserId
    ? `<a href="https://matrix.to/#/${encodeURIComponent(author.matrixUserId)}">${escapeHtml(authorText)}</a>`
    : escapeHtml(authorText);
  const lines = [
    `${authorHtml}:`,
    '',
    escapeHtml(displayText).replace(/\n/g, '<br>'),
  ];
  if (entry.tags.length > 0) {
    lines.push('', `Tags: ${escapeHtml(entry.tags.map(tag => `#${tag}`).join(' '))}`);
  }
  if (permalink) {
    const safePermalink = escapeHtml(permalink);
    lines.push('', `<a href="${safePermalink}">${safePermalink}</a>`);
  }
  return truncate(lines.join('<br>'), MATRIX_ENTRY_MIRROR_MAX_BODY_CHARS);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}
