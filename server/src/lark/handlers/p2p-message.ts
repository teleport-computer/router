/**
 * Private (1-on-1) message handler. Group messages are routed elsewhere
 * (command-router).
 *
 * Branches:
 *   1. Sender's Lark account not bound → send binding guide card
 *   2. Slash command:
 *      - `/help` / `/帮助` → static p2p help card (no LLM, no rate budget)
 *      - any other slash → "group-only" pointer card
 *   3. Plain text → run agent in p2p mode
 *   4. agent reports rate-limited → send rate-limit guide card pointing to /setup/cli
 *
 * Failures (lark API errors) are swallowed + logged. Never throws to caller.
 */

import type { LarkApiClient } from '../api-client.js';
import type { Storage } from '../../storage.js';
import type { RunAgentOptions, AgentRequest, AgentDeps } from '../agent.js';
import {
  buildBindingGuideCard,
  buildRateLimitGuideCard,
  buildP2pHelpCard,
  buildP2pUnknownSlashCard,
} from '../card-builder.js';

export interface P2pMessageHandlerDeps {
  storage: Pick<Storage, 'getUserByLarkOpenId'>;
  apiClient: LarkApiClient;
  publicUrl: string;
  runAgent: (req: AgentRequest, deps: AgentDeps, opts?: RunAgentOptions) => Promise<{ rateLimited: true } | void>;
  /** Used by p2p handler when calling runAgent — must match server.ts construction */
  agentDeps: AgentDeps;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

function extractText(content: string): string {
  try { const j = JSON.parse(content); return j.text ?? ''; } catch { return ''; }
}

async function postCard(api: LarkApiClient, chatId: string, card: unknown, log: (l: 'info' | 'warn' | 'error', m: string) => void): Promise<void> {
  try {
    await api.post('/open-apis/im/v1/messages?receive_id_type=chat_id', {
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    });
  } catch (e: any) {
    log('warn', `post card failed: ${e?.message ?? e}`);
  }
}

export function createP2pMessageHandler(deps: P2pMessageHandlerDeps) {
  const log = deps.log ?? ((lvl, m) => console[lvl === 'info' ? 'log' : lvl](`[p2p-msg] ${m}`));

  return async function handle(payload: any): Promise<void> {
    const message = payload?.message;
    if (!message) return;
    if (message.chat_type !== 'p2p') return; // defensive — server.ts already routes by chat_type
    if (message.message_type !== 'text') return; // images/files fall through silently
    const chatId = message.chat_id as string | undefined;
    const senderOpenId = payload?.sender?.sender_id?.open_id as string | undefined;
    if (!chatId || !senderOpenId) return;

    const text = extractText(message.content ?? '').trim();
    if (!text) return;

    // 1. Bound?
    const user = await deps.storage.getUserByLarkOpenId(senderOpenId);
    if (!user) {
      log('info', `unbound sender=${senderOpenId} — sending binding guide`);
      await postCard(deps.apiClient, chatId, buildBindingGuideCard(deps.publicUrl), log);
      return;
    }

    // 2. Slash command intercept (zero-LLM, doesn't consume rate budget).
    //    /help is the only supported one in DM; everything else gets a short
    //    "group-only" pointer so users don't waste an LLM round on it.
    if (text.startsWith('/')) {
      const cmd = text.split(/\s+/, 1)[0].toLowerCase();
      if (cmd === '/help' || cmd === '/帮助') {
        log('info', `help sender=${senderOpenId}`);
        await postCard(deps.apiClient, chatId, buildP2pHelpCard(deps.publicUrl), log);
        return;
      }
      log('info', `unknown slash sender=${senderOpenId} cmd=${cmd}`);
      await postCard(deps.apiClient, chatId, buildP2pUnknownSlashCard(cmd), log);
      return;
    }

    // 3. Run agent in p2p mode
    const result = await deps.runAgent(
      { chatId, senderOpenId, text },
      deps.agentDeps,
      { mode: 'p2p' },
    );

    // 4. Handle rate-limit signal
    if (result && (result as any).rateLimited) {
      log('info', `rate-limited sender=${senderOpenId} chat=${chatId} — sending guide`);
      await postCard(deps.apiClient, chatId, buildRateLimitGuideCard(deps.publicUrl), log);
    }
  };
}
