/**
 * `router brief` — fetch the user's daily Router Daily Brief on demand.
 *
 * Same content as the daily 10am Beijing Lark push (and the same data the
 * MCP `router_brief` tool returns). Calling does NOT advance the "since"
 * anchor — you can call as many times as you want, you'll always see
 * what's accumulated since this morning's cron-generated brief.
 */

import { apiCall } from '../api.mjs';
import { loadConfig, DEFAULT_RC_PATH } from '../config.mjs';
import { emit, fail } from '../output.mjs';

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const GROUP_LABELS = {
  mentioned: '@ you',
  replied: 'Replies to you',
  subscribed_channels: 'Subscribed channels',
  milestones: 'Team milestones',
  related_topics: 'Related to your topics',
};
const GROUP_ORDER = ['mentioned', 'replied', 'subscribed_channels', 'milestones', 'related_topics'];

export async function cmdBrief(_argv, ctx) {
  const cfg = loadConfig(DEFAULT_RC_PATH);
  if (!cfg.key) fail('Not logged in. Run: router init');

  const r = await apiCall({
    method: 'GET',
    server: cfg.server,
    path: '/api/brief',
    key: cfg.key,
    cliVersion: ctx.cliVersion,
  });

  if (r.status === 501) {
    // Older server still on the M3 stub
    emit(r.data?.error ?? 'Coming soon. Concierge feature ships in M3.', r.data);
    return;
  }
  if (!r.ok) fail(`Error ${r.status}: ${r.data?.error ?? '?'}`);

  const data = r.data;

  if (data.enabled === false) {
    emit(yellow('Concierge recap is disabled in your settings. Toggle at <server>/settings/concierge.'), data);
    return;
  }

  if (data.totalItems === 0) {
    emit(dim('No new activity since your last brief.'), data);
    return;
  }

  const sinceLabel = data.since ? new Date(data.since).toLocaleString() : 'a while ago';
  const lines = [
    bold(`Activity since ${sinceLabel} (${data.totalItems} items):`),
    '',
  ];

  for (const key of GROUP_ORDER) {
    const items = data.groups[key] || [];
    if (items.length === 0) continue;
    lines.push(`${bold(GROUP_LABELS[key])} ${dim(`(${items.length})`)}`);
    for (const it of items) {
      const channelTag = it.channel ? ` ${cyan('#' + it.channel)}` : '';
      lines.push(`  - ${dim('@' + it.handle)}${channelTag} ${it.summary}`);
      lines.push(`    ${dim(it.url)}`);
    }
    lines.push('');
  }

  emit(lines.join('\n').trimEnd(), data);
}
