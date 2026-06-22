import type { RouterEntry, RouterUser, Storage } from './storage.js';
import { tokenize } from './storage.js';

export const ROUTER_SPARK_EVENT = 'com.router.spark';

export type SparkConfidence = 'high' | 'moderate' | 'low' | 'skip';
export type SparkActionKind = 'introduce' | 'suggest' | 'nudge' | 'skip';

export interface SparkCandidate {
  handle: string;
  matchingEntries: RouterEntry[];
  overlapTopics: string[];
}

export interface SparkAction {
  action: SparkActionKind;
  confidence: SparkConfidence;
  sourceHandle: string;
  targetHandle: string;
  reason: string;
  message?: string;
  existingRoomId?: string;
}

export interface SparkConnectionInfo {
  handle: string;
  sharedRoomIds: string[];
  recentInteractions: number;
  isConnected: boolean;
}

export interface MatrixSparkMessage {
  roomId: string;
  roomName?: string;
  senderHandle?: string;
  text: string;
  timestamp: number;
  isDM?: boolean;
}

export interface MatrixSparkGateway {
  createEncryptedSparkRoom(input: {
    name: string;
    topic: string;
    inviteUserIds: string[];
    sourceHandle: string;
    targetHandle: string;
  }): Promise<{ roomId: string }>;
  sendRoomMessage(roomId: string, text: string): Promise<void>;
  sendEncryptedDM(userId: string, text: string): Promise<{ roomId?: string }>;
  postSparkContext(roomId: string, spark: {
    sourceHandle: string;
    targetHandle: string;
    reason: string;
    evidence: SparkEvidence[];
  }): Promise<void>;
  getSparkRoomPair?(roomId: string): Promise<{ sourceHandle: string; targetHandle: string } | null>;
  queryRecentMessages?(input: {
    since: number;
    limit: number;
    perRoomLimit: number;
  }): Promise<MatrixSparkMessage[]>;
}

export interface SparkEvidence {
  entryId: string;
  author: string;
  snippet: string;
}

export interface SparkExecutionResult {
  status: 'introduced' | 'suggested' | 'nudged' | 'skipped';
  roomId?: string;
  reason?: string;
}

export interface SparkEvaluationOptions {
  evaluationModel?: string;
  copyModel?: string;
}

export type SparkLLM = (
  prompt: string,
  opts?: { model?: string; temperature?: number; maxTokens?: number },
) => Promise<string>;

const SPARK_MATRIX_DEBOUNCE_WINDOW_MS = process.env.SPARK_MATRIX_DEBOUNCE_WINDOW_MS
  ? parseInt(process.env.SPARK_MATRIX_DEBOUNCE_WINDOW_MS, 10)
  : 72 * 60 * 60 * 1000;
const SPARK_MATRIX_DEBOUNCE_LIMIT = process.env.SPARK_MATRIX_DEBOUNCE_LIMIT
  ? parseInt(process.env.SPARK_MATRIX_DEBOUNCE_LIMIT, 10)
  : 160;

const SPARK_DEBOUNCE_STOP_WORDS = new Set([
  'about', 'after', 'again', 'already', 'also', 'around', 'because', 'between',
  'could', 'different', 'directly', 'entry', 'exactly', 'having', 'might',
  'notes', 'people', 'question', 'recent', 'recently', 'router', 'should',
  'spark', 'subject', 'their', 'there', 'these', 'thing', 'think', 'those',
  'through', 'together', 'would', 'worth',
]);

export const SPARK_EVALUATION_PROMPT = `You are the Router, a thoughtful mutual friend who connects people and ideas.

Evaluate whether a detected overlap between two private Router users is worth acting on.

Consider:
- Is this a genuine intellectual overlap, or just surface-level keyword matching?
- Would both people actually benefit from knowing about each other's work?
- Are they already connected? If so, is this new information worth surfacing?
- How confident are you that this introduction would be welcome?

Hard constraints:
- Only evaluate the two users named in the request.
- Do not route around to a third person.
- If the best connection is actually with someone else, return confidence "skip".
- Do not write user-facing copy. This is only the evaluation step.

Respond with JSON only:
{
  "confidence": "high" | "moderate" | "low" | "skip",
  "reason": "1-2 sentence internal explanation"
}

"high" = create an introduction room immediately
"moderate" = suggest via DM, let them decide
"low" = note it but don't act yet
"skip" = not worth pursuing`;

export const SPARK_COPY_PROMPT = `You are the Router, a precise and socially careful mutual friend.

A cheaper evaluator has approved a spark between two private Router users. Write the final human-facing copy.

Hard constraints:
- Write only for the two evaluated users named in the request.
- Do not mention, tag, invite, or route around a third Router handle.
- Do not introduce facts not supported by the provided evidence.
- Do not overstate certainty or imply the people have already agreed to talk.
- Keep it concise and natural.

Action guidance:
- "introduce": the message will be posted in a private Matrix room containing both people. Address both users.
- "nudge": the message will be posted in an existing private spark room. Address both users.
- "suggest": the message will be sent as a DM to the source user. Mention the target user, but do not write as if the target is present.

Respond with JSON only:
{
  "topic": "A concise room topic or context sentence",
  "message": "The final message to send"
}`;

export function isPublishedVisibleForSparks(entry: RouterEntry, now = Date.now()): boolean {
  return !entry.hidden && !(entry.publishAt && entry.publishAt > now);
}

export function formatEntryForSparkEvaluation(entry: RouterEntry): string {
  const date = new Date(entry.timestamp).toISOString().split('T')[0];
  const body = (entry.content || entry.summary || '').trim();
  const text = body || [entry.summary, ...(entry.tags || []).map(tag => `#${tag}`)].filter(Boolean).join(' ');
  return `[${date}] ${text.slice(0, 300)}`;
}

export async function detectSparks(
  entry: RouterEntry,
  storage: Storage,
  keywords?: string[],
): Promise<SparkCandidate[]> {
  if (!entry.handle || !entry.teamId || !isPublishedVisibleForSparks(entry)) return [];

  const searchTerms = (keywords?.length ? keywords : [
    ...(entry.keywords || []),
    ...tokenize([entry.content, entry.summary, ...(entry.tags || [])].join(' ')),
  ]).slice(0, 8);
  if (searchTerms.length === 0) return [];

  const relatedEntries = await storage.searchEntries(entry.teamId, searchTerms.join(' '), 50);
  const otherEntries = relatedEntries.filter(candidate =>
    candidate.teamId === entry.teamId
    && candidate.handle
    && candidate.handle !== entry.handle
    && isPublishedVisibleForSparks(candidate)
  );

  const byAuthor = new Map<string, RouterEntry[]>();
  for (const candidate of otherEntries) {
    const existing = byAuthor.get(candidate.handle) || [];
    existing.push(candidate);
    byAuthor.set(candidate.handle, existing);
  }

  const candidates: SparkCandidate[] = [];
  const myTopics = new Set(searchTerms.map(t => t.toLowerCase()));
  for (const [handle, entries] of byAuthor) {
    const theirTopics = new Set<string>();
    for (const related of entries) {
      for (const word of [
        ...(related.keywords || []),
        ...tokenize([related.content, related.summary, ...(related.tags || [])].join(' ')),
      ]) {
        theirTopics.add(word.toLowerCase());
      }
    }
    const overlap = [...myTopics].filter(topic => theirTopics.has(topic));
    candidates.push({
      handle,
      matchingEntries: entries.slice(0, 3),
      overlapTopics: overlap.length > 0 ? overlap.slice(0, 8) : searchTerms.slice(0, 3),
    });
  }

  candidates.sort((a, b) => b.matchingEntries.length - a.matchingEntries.length);
  return candidates.slice(0, 5);
}

export async function getConnectionInfo(
  teamId: string,
  handleA: string,
  handleB: string,
  storage: Storage,
): Promise<SparkConnectionInfo> {
  const sharedRoomIds: string[] = [];
  let recentInteractions = 0;

  const [userA, userB] = await Promise.all([
    storage.getUser(handleA),
    storage.getUser(handleB),
  ]);
  if (userA?.teamId !== teamId || userB?.teamId !== teamId) {
    return { handle: handleB, sharedRoomIds, recentInteractions, isConnected: false };
  }

  if (userA.following?.some(f => f.handle === handleB) || userB.following?.some(f => f.handle === handleA)) {
    recentInteractions++;
  }

  const [entriesA, entriesB] = await Promise.all([
    storage.getEntriesByHandle(teamId, handleA, 50),
    storage.getEntriesByHandle(teamId, handleB, 50),
  ]);
  const aToB = entriesA.filter(e => isPublishedVisibleForSparks(e) && e.to?.includes(`@${handleB}`)).length;
  const bToA = entriesB.filter(e => isPublishedVisibleForSparks(e) && e.to?.includes(`@${handleA}`)).length;
  recentInteractions += aToB + bToA;

  const pairRoom = await storage.getSparkPairRoom(teamId, handleA, handleB);
  if (pairRoom) {
    sharedRoomIds.push(pairRoom.roomId);
    recentInteractions++;
  }

  return {
    handle: handleB,
    sharedRoomIds,
    recentInteractions,
    isConnected: sharedRoomIds.length > 0 || recentInteractions > 0,
  };
}

export async function evaluateSpark(
  sourceEntry: RouterEntry,
  candidate: SparkCandidate,
  connectionInfo: SparkConnectionInfo,
  callLLM: SparkLLM,
  options: SparkEvaluationOptions = {},
): Promise<SparkAction> {
  const sourceHandle = sourceEntry.handle;
  const targetHandle = candidate.handle;

  try {
    const sourceContent = (sourceEntry.content || sourceEntry.summary || '').slice(0, 700);
    const targetContent = candidate.matchingEntries.map(formatEntryForSparkEvaluation).join('\n\n');
    const connectionContext = connectionInfo.isConnected
      ? `These two ARE already connected (${connectionInfo.sharedRoomIds.length} spark rooms, ${connectionInfo.recentInteractions} prior interaction signals).`
      : 'These two are NOT currently connected.';

    const evaluationRaw = await callLLM([
      SPARK_EVALUATION_PROMPT,
      '',
      `Source user: @${sourceHandle}`,
      `Target user: @${targetHandle}`,
      '',
      `@${sourceHandle}'s new entry:`,
      sourceContent,
      '',
      `@${targetHandle}'s related entries:`,
      targetContent || '(none)',
      '',
      `Overlapping topics: ${candidate.overlapTopics.join(', ') || '(none)'}`,
      connectionContext,
    ].join('\n'), {
      model: options.evaluationModel || process.env.SPARK_EVALUATION_MODEL || process.env.OPENROUTER_MODEL,
      temperature: 0.1,
      maxTokens: 400,
    });
    const parsed = parseJsonObject(evaluationRaw);
    const confidence = parseConfidence(parsed.confidence);
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim()
      : 'No rationale provided';

    if (confidence === 'skip') {
      return { action: 'skip', confidence, sourceHandle, targetHandle, reason };
    }

    let action: SparkAction;
    if (connectionInfo.isConnected) {
      if (confidence === 'high' || confidence === 'moderate') {
        action = {
          action: 'nudge',
          confidence,
          sourceHandle,
          targetHandle,
          reason,
          existingRoomId: connectionInfo.sharedRoomIds[0],
        };
        return withSparkCopy(sourceEntry, candidate, connectionInfo, action, callLLM, options);
      }
      return { action: 'skip', confidence, sourceHandle, targetHandle, reason: 'Already connected, low confidence' };
    }

    if (confidence === 'high') {
      action = { action: 'introduce', confidence, sourceHandle, targetHandle, reason };
      return withSparkCopy(sourceEntry, candidate, connectionInfo, action, callLLM, options);
    }
    if (confidence === 'moderate') {
      action = { action: 'suggest', confidence, sourceHandle, targetHandle, reason };
      return withSparkCopy(sourceEntry, candidate, connectionInfo, action, callLLM, options);
    }

    return { action: 'skip', confidence, sourceHandle, targetHandle, reason };
  } catch (err) {
    console.error('[Sparks] Evaluation failed:', err);
    return { action: 'skip', confidence: 'skip', sourceHandle, targetHandle, reason: 'Evaluation error' };
  }
}

export function getUnexpectedSparkHandles(
  text: string | undefined,
  sourceHandle: string,
  targetHandle: string,
): string[] {
  if (!text) return [];
  const allowed = new Set([normalizeHandle(sourceHandle), normalizeHandle(targetHandle)]);
  const unexpected = new Set<string>();
  const handlePattern = /(^|[\s([{"'`])@([a-z0-9_][a-z0-9_-]{1,28}[a-z0-9_])(?=$|[\s)\]}:.,!?'"`])/g;
  for (const match of text.matchAll(handlePattern)) {
    const handle = normalizeHandle(match[2]);
    if (!allowed.has(handle)) unexpected.add(handle);
  }
  return [...unexpected];
}

export function getSparkDebounceTopicTerms(
  action: Pick<SparkAction, 'reason'>,
  candidate: Pick<SparkCandidate, 'overlapTopics' | 'matchingEntries'>,
  sourceEntry: Pick<RouterEntry, 'content' | 'summary' | 'tags' | 'keywords'>,
  maxTerms = 16,
): string[] {
  const scores = new Map<string, number>();
  const add = (terms: string[], weight: number) => {
    for (const term of terms) scores.set(term, (scores.get(term) || 0) + weight);
  };
  add(tokenizeSparkDebounceText(candidate.overlapTopics.join(' ')), 5);
  add(tokenizeSparkDebounceText([...(sourceEntry.keywords || []), ...(sourceEntry.tags || [])].join(' ')), 4);
  add(tokenizeSparkDebounceText(action.reason), 3);
  add(tokenizeSparkDebounceText(sourceEntry.content || sourceEntry.summary), 2);
  add(tokenizeSparkDebounceText(candidate.matchingEntries.map(e => `${e.content} ${e.summary}`).join(' ')), 1);
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term)
    .slice(0, maxTerms);
}

export function findRecentMatrixSparkConversation(
  messages: MatrixSparkMessage[],
  sourceHandle: string,
  targetHandle: string,
  terms: string[],
): { roomId: string; roomName: string; matchedTerms: string[]; sourceCount: number; targetCount: number } | null {
  if (terms.length === 0) return null;
  const source = normalizeHandle(sourceHandle);
  const target = normalizeHandle(targetHandle);
  const byRoom = new Map<string, MatrixSparkMessage[]>();
  for (const message of messages) {
    if (message.isDM) continue;
    const sender = message.senderHandle ? normalizeHandle(message.senderHandle) : '';
    if (sender !== source && sender !== target) continue;
    const existing = byRoom.get(message.roomId) || [];
    existing.push(message);
    byRoom.set(message.roomId, existing);
  }

  for (const [roomId, roomMessages] of byRoom) {
    const sourceMessages = roomMessages.filter(message => normalizeHandle(message.senderHandle || '') === source);
    const targetMessages = roomMessages.filter(message => normalizeHandle(message.senderHandle || '') === target);
    if (sourceMessages.length === 0 || targetMessages.length === 0) continue;

    const matchedTerms = new Set<string>();
    const matchedHandles = new Set<string>();
    for (const message of roomMessages) {
      const text = message.text.toLowerCase();
      const hits = terms.filter(term => text.includes(term));
      if (hits.length === 0) continue;
      hits.forEach(term => matchedTerms.add(term));
      matchedHandles.add(normalizeHandle(message.senderHandle || ''));
    }

    const pairIsActivelyTalking = roomMessages.length >= 4 && matchedTerms.size >= 2;
    const bothUsedTopicTerms = matchedHandles.has(source) && matchedHandles.has(target);
    if (pairIsActivelyTalking || bothUsedTopicTerms) {
      return {
        roomId,
        roomName: roomMessages[0]?.roomName || roomId,
        matchedTerms: [...matchedTerms],
        sourceCount: sourceMessages.length,
        targetCount: targetMessages.length,
      };
    }
  }
  return null;
}

export async function executeSpark(
  teamId: string,
  action: SparkAction,
  candidate: SparkCandidate,
  sourceEntry: RouterEntry,
  storage: Storage,
  matrix: MatrixSparkGateway,
  options: { debounceMatrix?: boolean } = {},
): Promise<SparkExecutionResult> {
  if (action.action === 'skip') return { status: 'skipped', reason: action.reason };

  const [sourceUser, targetUser] = await Promise.all([
    storage.getUser(action.sourceHandle),
    storage.getUser(action.targetHandle),
  ]);
  if (!hasVerifiedMatrixBinding(sourceUser, teamId) || !hasVerifiedMatrixBinding(targetUser, teamId)) {
    return { status: 'skipped', reason: 'Both users need verified Matrix links.' };
  }

  const unexpectedHandles = getUnexpectedSparkHandles(
    [action.reason, action.message].filter(Boolean).join('\n'),
    action.sourceHandle,
    action.targetHandle,
  );
  if (unexpectedHandles.length > 0) {
    return { status: 'skipped', reason: `Spark copy mentioned unrelated handles: ${unexpectedHandles.map(h => `@${h}`).join(', ')}` };
  }

  if (options.debounceMatrix !== false && matrix.queryRecentMessages) {
    const terms = getSparkDebounceTopicTerms(action, candidate, sourceEntry);
    const messages = await matrix.queryRecentMessages({
      since: Date.now() - SPARK_MATRIX_DEBOUNCE_WINDOW_MS,
      limit: SPARK_MATRIX_DEBOUNCE_LIMIT,
      perRoomLimit: 40,
    }).catch(() => []);
    const existingConversation = findRecentMatrixSparkConversation(messages, action.sourceHandle, action.targetHandle, terms);
    if (existingConversation) {
      return {
        status: 'skipped',
        roomId: existingConversation.roomId,
        reason: `Recent Matrix conversation already active in ${existingConversation.roomName}.`,
      };
    }
  }

  const message = action.message || action.reason;
  if (action.action === 'suggest') {
    await matrix.sendEncryptedDM(sourceUser!.matrixUserId!, message);
    return { status: 'suggested' };
  }

  const existing = action.existingRoomId
    ? { teamId, roomId: action.existingRoomId, sourceHandle: action.sourceHandle, targetHandle: action.targetHandle }
    : await storage.getSparkPairRoom(teamId, action.sourceHandle, action.targetHandle);
  if (existing?.roomId) {
    const pair = matrix.getSparkRoomPair ? await matrix.getSparkRoomPair(existing.roomId) : null;
    const matches = matrix.getSparkRoomPair
      ? !!pair && samePair(pair.sourceHandle, pair.targetHandle, action.sourceHandle, action.targetHandle)
      : true;
    if (matches) {
      await matrix.sendRoomMessage(existing.roomId, message);
      return {
        status: action.action === 'nudge' ? 'nudged' : 'introduced',
        roomId: existing.roomId,
      };
    }
  }

  const room = await matrix.createEncryptedSparkRoom({
    name: `@${action.sourceHandle} and @${action.targetHandle}`,
    topic: action.reason,
    inviteUserIds: [sourceUser!.matrixUserId!, targetUser!.matrixUserId!],
    sourceHandle: action.sourceHandle,
    targetHandle: action.targetHandle,
  });
  await storage.setSparkPairRoom(teamId, action.sourceHandle, action.targetHandle, room.roomId);
  await matrix.postSparkContext(room.roomId, {
    sourceHandle: action.sourceHandle,
    targetHandle: action.targetHandle,
    reason: action.reason,
    evidence: sparkEvidence(sourceEntry, candidate),
  });
  await matrix.sendRoomMessage(room.roomId, message);
  return { status: 'introduced', roomId: room.roomId };
}

export function canModerateSparks(user: RouterUser, env: NodeJS.ProcessEnv = process.env): boolean {
  if (user.isAdmin) return true;
  const handles = (env.SPARK_MODERATOR_HANDLES || '')
    .split(',')
    .map(h => normalizeHandle(h))
    .filter(Boolean);
  return handles.includes(normalizeHandle(user.handle));
}

export function sparkEvidence(sourceEntry: RouterEntry, candidate: SparkCandidate): SparkEvidence[] {
  return [
    {
      entryId: sourceEntry.id,
      author: `@${sourceEntry.handle}`,
      snippet: (sourceEntry.content || sourceEntry.summary || '').slice(0, 200),
    },
    ...candidate.matchingEntries.slice(0, 2).map(entry => ({
      entryId: entry.id,
      author: `@${entry.handle}`,
      snippet: (entry.content || entry.summary || '').slice(0, 200),
    })),
  ];
}

async function withSparkCopy(
  sourceEntry: RouterEntry,
  candidate: SparkCandidate,
  connectionInfo: SparkConnectionInfo,
  action: SparkAction,
  callLLM: SparkLLM,
  options: SparkEvaluationOptions,
): Promise<SparkAction> {
  const targetContent = candidate.matchingEntries.map(formatEntryForSparkEvaluation).join('\n\n');
  const connectionContext = connectionInfo.isConnected
    ? `These two are already connected (${connectionInfo.sharedRoomIds.length} spark rooms, ${connectionInfo.recentInteractions} prior interaction signals).`
    : 'These two are not currently connected.';

  try {
    const raw = await callLLM([
      SPARK_COPY_PROMPT,
      '',
      `Action: ${action.action}`,
      `Source user: @${action.sourceHandle}`,
      `Target user: @${action.targetHandle}`,
      `Evaluator confidence: ${action.confidence}`,
      `Evaluator rationale: ${action.reason}`,
      `Connection status: ${connectionContext}`,
      `Overlapping topics: ${candidate.overlapTopics.join(', ') || '(none)'}`,
      '',
      `@${action.sourceHandle}'s new entry:`,
      (sourceEntry.content || sourceEntry.summary || '').slice(0, 700),
      '',
      `@${action.targetHandle}'s related entries:`,
      targetContent || '(none)',
    ].join('\n'), {
      model: options.copyModel || process.env.SPARK_COPY_MODEL || process.env.OPENROUTER_MODEL,
      temperature: 0.2,
      maxTokens: 600,
    });
    const parsed = parseJsonObject(raw);
    const topic = typeof parsed.topic === 'string' && parsed.topic.trim()
      ? parsed.topic.trim()
      : action.reason;
    const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
    if (!message) {
      return { action: 'skip', confidence: 'skip', sourceHandle: action.sourceHandle, targetHandle: action.targetHandle, reason: 'Spark copywriting returned no message' };
    }
    return { ...action, reason: topic, message };
  } catch (err) {
    console.error('[Sparks] Copywriting failed:', err);
    return { action: 'skip', confidence: 'skip', sourceHandle: action.sourceHandle, targetHandle: action.targetHandle, reason: 'Spark copywriting error' };
  }
}

function parseJsonObject(raw: string): Record<string, any> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('LLM response did not contain JSON');
  }
}

function parseConfidence(value: unknown): SparkConfidence {
  return value === 'high' || value === 'moderate' || value === 'low' || value === 'skip'
    ? value
    : 'skip';
}

function tokenizeSparkDebounceText(text: string | undefined): string[] {
  return (text || '')
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9-]{3,}/g)
    ?.map(term => term.replace(/^-+|-+$/g, ''))
    .filter(term => term.length >= 4 && !SPARK_DEBOUNCE_STOP_WORDS.has(term))
    .slice(0, 80) || [];
}

function hasVerifiedMatrixBinding(user: RouterUser | null | undefined, teamId: string): boolean {
  return !!user?.matrixUserId && user.teamId === teamId;
}

function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, '').trim().toLowerCase();
}

function samePair(a: string, b: string, x: string, y: string): boolean {
  return [normalizeHandle(a), normalizeHandle(b)].sort().join(':') === [normalizeHandle(x), normalizeHandle(y)].sort().join(':');
}
