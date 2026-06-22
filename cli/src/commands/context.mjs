import { apiCall } from '../api.mjs';
import { decideAction, formatBlockMessage, formatSoftMessage } from '../version-check.mjs';
import { loadConfig, DEFAULT_RC_PATH } from '../config.mjs';
import { emit, note, fail, isJsonMode } from '../output.mjs';

export async function cmdContext(_argv, ctx) {
  const cfg = loadConfig(DEFAULT_RC_PATH);
  if (!cfg.key) fail('Not logged in. Run: router init');

  const r = await apiCall({
    method: 'GET',
    server: cfg.server,
    path: '/api/context',
    key: cfg.key,
    cliVersion: ctx.cliVersion,
  });

  const action = decideAction(ctx.cliVersion, r.versionInfo);
  if (action.kind === 'block') fail(formatBlockMessage(action.latest));

  if (!r.ok) fail(`API error ${r.status}: ${r.data?.error ?? '?'}`);

  if (isJsonMode()) {
    emit('', r.data);
    return;
  }

  const c = r.data;
  emit(`# Router context (v${c.version})

sync_mode: ${c.sync_mode}
preview_mode: ${c.preview_mode}
skill_template_version: ${c.skill_template_version}

## Sync triggers (${c.sync_triggers.length})
${c.sync_triggers.map(t => '- ' + t).join('\n')}

## Tag rules
${c.tag_rules}

## Preset tags (${c.preset_tags.length})
${c.preset_tags.map(t => `- ${t.name}: ${t.description}`).join('\n')}

## Channels (${c.channels.length})
${c.channels.map(ch => `- #${ch.id} (${ch.name})${ch.skill ? '\n  ' + ch.skill.split('\n').join('\n  ') : ''}`).join('\n')}

## Privacy strip patterns
${c.privacy_strip_patterns.map(p => '- ' + p).join('\n')}
`, c);

  if (action.kind === 'soft') note(formatSoftMessage(action.latest));
}
