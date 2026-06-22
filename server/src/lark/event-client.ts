/**
 * Lark long-poll WebSocket event client.
 *
 * Wraps the official @larksuiteoapi/node-sdk WSClient + EventDispatcher.
 * Public surface kept stable for callers (server.ts, tests).
 *
 * Lifecycle:
 *   start()                                     // connects via SDK; SDK handles
 *                                               // reconnect, ping/pong, framing
 *   onEvent({ header: { event_type }, event })  // fired for each subscribed event
 *   stop()                                      // best-effort: lets SDK drain
 */

import { WSClient, EventDispatcher, Domain } from '@larksuiteoapi/node-sdk';

export interface LarkEvent {
  header: { event_type: string; [k: string]: unknown };
  event: any;
}

export interface LarkEventClientOpts {
  appId: string;
  appSecret: string;
  /** "https://open.feishu.cn" → Domain.Feishu, "https://open.larksuite.com" → Domain.Lark */
  domain: string;
  botEnabled: boolean;
  onEvent: (ev: LarkEvent) => void | Promise<void>;
  /** Handler for card.action.trigger events; return value becomes the Lark toast response. */
  onCardAction?: (event: any) => Promise<any>;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

// v2 schema event names (modern). These arrive when Lark App is configured
// to use v2.0 event format.
const V2_EVENT_TYPES = [
  'im.message.receive_v1',
  'im.chat.member.bot.added_v1',
  'im.chat.member.bot.deleted_v1',
  'im.message.reaction.created_v1',
  'im.message.reaction.deleted_v1',
] as const;

// v1 schema event names (legacy). These arrive when Lark App is configured
// to use v1.0 event format (the default in older console UIs). We adapt the
// incoming shape to look like v2 before forwarding.
const V1_EVENT_TYPES = ['message', 'add_bot', 'remove_bot'] as const;

function adaptV1ToV2(v1Type: string, raw: any): { eventType: string; event: any } {
  if (v1Type === 'message') {
    return {
      eventType: 'im.message.receive_v1',
      event: {
        message: {
          chat_id: raw.open_chat_id,
          chat_type: raw.chat_type,
          message_type: raw.msg_type,
          content: JSON.stringify({ text: raw.text ?? '' }),
          mentions: raw.is_mention ? [{ key: '@_user_1', name: 'Bot' }] : [],
        },
        sender: { sender_id: { open_id: raw.open_id } },
      },
    };
  }
  if (v1Type === 'add_bot' || v1Type === 'remove_bot') {
    return {
      eventType: v1Type === 'add_bot'
        ? 'im.chat.member.bot.added_v1'
        : 'im.chat.member.bot.deleted_v1',
      event: {
        chat_id: raw.open_chat_id ?? raw.chat_id,
        operator: { open_id: raw.operator?.open_id },
      },
    };
  }
  return { eventType: v1Type, event: raw };
}

function pickDomain(domain: string): Domain {
  return domain.includes('larksuite') ? Domain.Lark : Domain.Feishu;
}

export class LarkEventClient {
  public readonly state: { connected: boolean; lastEventAt: number | null } = {
    connected: false,
    lastEventAt: null,
  };

  private wsClient: WSClient | null = null;
  private stopFlag = false;
  // Dedup recently-seen Lark message IDs. Lark App may have BOTH v1 ('message')
  // and v2 ('im.message.receive_v1') events subscribed → SDK dispatches both
  // for one user message. We collapse them by message_id for a 60s window.
  private seenMessageIds = new Map<string, number>();
  private readonly DEDUP_WINDOW_MS = 60_000;
  // Liveness watchdog. Lark broker occasionally drops a session subscription
  // while the WS socket stays alive — `[lark-ws] connected` keeps showing
  // healthy but no events flow ("ghost connection"). SDK's TCP/ping autorecover
  // doesn't catch this because the wire is fine. Defense: track the gap
  // between events; if too long, exit so PM2 cold-restarts (which re-handshakes
  // with Lark and re-registers the subscription).
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private readonly WATCHDOG_INTERVAL_MS = 60_000;
  private readonly WATCHDOG_SILENCE_MS = 45 * 60_000;  // 45 min

  private isDuplicate(messageId: string | undefined): boolean {
    if (!messageId) return false;
    const now = Date.now();
    // Lazy purge while we're at it.
    for (const [id, ts] of this.seenMessageIds) {
      if (now - ts > this.DEDUP_WINDOW_MS) this.seenMessageIds.delete(id);
    }
    if (this.seenMessageIds.has(messageId)) return true;
    this.seenMessageIds.set(messageId, now);
    return false;
  }

  constructor(private opts: LarkEventClientOpts) {}

  stop() {
    this.stopFlag = true;
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
    // SDK doesn't expose a clean disconnect; on process exit, sockets close.
  }

  private startWatchdog(log: (l: 'info' | 'warn' | 'error', m: string) => void): void {
    if (this.watchdog) return;
    // Seed lastEventAt so we don't immediately exit during a quiet startup.
    if (this.state.lastEventAt === null) this.state.lastEventAt = Date.now();
    this.watchdog = setInterval(() => {
      if (!this.state.connected) return;          // SDK is reconnecting; let it
      const last = this.state.lastEventAt ?? Date.now();
      const silentMs = Date.now() - last;
      if (silentMs >= this.WATCHDOG_SILENCE_MS) {
        log('error', `silent for ${Math.round(silentMs / 60_000)} min — likely ghost connection, exiting for PM2 restart`);
        // PM2's autorestart picks us back up within ~1s with a fresh
        // handshake to Lark. exit(1) (not 0) so the restart counter
        // increments visibly.
        process.exit(1);
      }
    }, this.WATCHDOG_INTERVAL_MS);
    // Don't keep the event loop alive on its own — if everything else
    // shuts down cleanly, we shouldn't block process exit.
    this.watchdog.unref?.();
  }

  async start(_opts?: { runOnce?: boolean }): Promise<void> {
    const log =
      this.opts.log ??
      ((lvl, m) => console[lvl === 'info' ? 'log' : lvl](`[lark-ws] ${m}`));

    if (!this.opts.botEnabled) {
      log('info', 'LARK_BOT_ENABLED=false, not connecting');
      return;
    }
    if (this.stopFlag) return;

    const dispatcher = new EventDispatcher({});
    const handlers: Record<string, (event: any) => Promise<any>> = {};
    // v2 schema handlers — direct passthrough.
    for (const t of V2_EVENT_TYPES) {
      handlers[t] = async (event: any) => {
        this.state.lastEventAt = Date.now();
        const messageId = event?.message?.message_id;
        if (this.isDuplicate(messageId)) {
          log('info', `v2 dup-suppress ${t} message_id=${messageId}`);
          return;
        }
        log('info', `v2 event ${t} chat=${event?.message?.chat_id ?? event?.chat_id ?? '<none>'} message_id=${messageId ?? '<none>'}`);
        try {
          await this.opts.onEvent({ header: { event_type: t }, event });
        } catch (e: any) {
          log('error', `onEvent threw for ${t}: ${e?.message ?? e}`);
        }
      };
    }
    // v1 schema handlers — adapt incoming payload to v2 shape so downstream
    // logic stays unified.
    for (const v1Type of V1_EVENT_TYPES) {
      handlers[v1Type] = async (raw: any) => {
        this.state.lastEventAt = Date.now();
        const messageId = raw?.open_message_id;
        if (this.isDuplicate(messageId)) {
          log('info', `v1 dup-suppress ${v1Type} message_id=${messageId}`);
          return;
        }
        const adapted = adaptV1ToV2(v1Type, raw);
        log('info', `v1 event ${v1Type} → ${adapted.eventType} chat=${adapted.event?.message?.chat_id ?? adapted.event?.chat_id ?? '<none>'} message_id=${messageId ?? '<none>'}`);
        try {
          await this.opts.onEvent({
            header: { event_type: adapted.eventType },
            event: adapted.event,
          });
        } catch (e: any) {
          log('error', `onEvent threw for v1:${v1Type}: ${e?.message ?? e}`);
        }
      };
    }
    if (this.opts.onCardAction) {
      const onCardAction = this.opts.onCardAction;
      handlers['card.action.trigger'] = async (raw: any) => {
        this.state.lastEventAt = Date.now();
        log('info', `card.action.trigger chat=${raw?.context?.open_chat_id ?? '<none>'}`);
        try {
          // Return value flows back to Lark as a toast
          return await onCardAction(raw);
        } catch (e: any) {
          log('error', `card.action handler threw: ${e?.message ?? e}`);
          return { toast: { type: 'error', content: '操作失败' } };
        }
      };
    }
    (dispatcher as any).register(handlers);

    this.wsClient = new WSClient({
      appId: this.opts.appId,
      appSecret: this.opts.appSecret,
      domain: pickDomain(this.opts.domain),
      autoReconnect: true,
      onReady: () => {
        this.state.connected = true;
        log('info', 'connected');
      },
      onReconnecting: () => {
        this.state.connected = false;
        log('warn', 'reconnecting…');
      },
      onReconnected: () => {
        this.state.connected = true;
        log('info', 'reconnected');
      },
      onError: err => {
        this.state.connected = false;
        log('error', `WS error: ${err?.message ?? err}`);
      },
    });

    // SDK's start() resolves immediately after handshake setup; the WS
    // continues running in background. Catch top-level rejection.
    this.wsClient.start({ eventDispatcher: dispatcher }).catch(err => {
      log('error', `wsClient.start crashed: ${err?.message ?? err}`);
      this.state.connected = false;
    });

    this.startWatchdog(log);
  }
}
