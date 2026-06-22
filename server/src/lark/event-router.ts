import type { LarkEvent } from './event-client.js';

export interface EventRouterDeps {
  message: (ev: any) => Promise<void> | void;
  member: (ev: any) => Promise<void> | void;
  /** Reaction add/remove on a card or message. `kind` distinguishes the two. */
  reaction?: (ev: any, kind: 'added' | 'removed') => Promise<void> | void;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export function createEventRouter(deps: EventRouterDeps) {
  const log = deps.log ?? ((lvl, m) => console[lvl === 'info' ? 'log' : lvl](`[lark-event] ${m}`));
  return async function route(ev: LarkEvent): Promise<void> {
    const t = ev.header?.event_type;
    if (t === 'im.message.receive_v1') return void await deps.message(ev.event);
    if (t === 'im.chat.member.bot.added_v1' || t === 'im.chat.member.bot.deleted_v1') return void await deps.member(ev.event);
    if (t === 'im.message.reaction.created_v1') return void await deps.reaction?.(ev.event, 'added');
    if (t === 'im.message.reaction.deleted_v1') return void await deps.reaction?.(ev.event, 'removed');
    log('info', `unhandled event: ${t}`);
  };
}
