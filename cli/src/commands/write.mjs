import { readFileSync } from 'fs';
import { apiCall } from '../api.mjs';
import { loadConfig, DEFAULT_RC_PATH } from '../config.mjs';
import { emit, fail } from '../output.mjs';

export async function cmdWrite(argv, ctx) {
  const cfg = loadConfig(DEFAULT_RC_PATH);
  if (!cfg.key) fail('Not logged in. Run: router init');

  const summary = argv.find(a => !a.startsWith('--')) ?? '';
  if (!summary && !argv.includes('--file') && !argv.includes('--content')) {
    fail('Usage: router write "summary" [--tag a,b] [--channel x] [--content "<md>"] [--file path] [--oneliner "..."] [--search-keywords k1,k2]');
  }

  let tags = [];
  let channel;
  let content;
  let oneliner;
  let searchKeywords = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tag' && argv[i + 1]) tags = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (argv[i] === '--channel' && argv[i + 1]) channel = argv[++i];
    else if (argv[i] === '--file' && argv[i + 1]) content = readFileSync(argv[++i], 'utf-8');
    else if (argv[i] === '--content' && argv[i + 1]) content = argv[++i];
    else if (argv[i] === '--oneliner' && argv[i + 1]) oneliner = argv[++i];
    else if (argv[i] === '--search-keywords' && argv[i + 1]) searchKeywords = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
  }
  const body = { summary, tags: tags.length ? tags : ['cli'], client: 'cli', channel, content, oneliner, search_keywords: searchKeywords.length ? searchKeywords : undefined };

  const r = await apiCall({ method: 'POST', server: cfg.server, path: '/api/entries', key: cfg.key, body, cliVersion: ctx.cliVersion });
  if (!r.ok) fail(`Error ${r.status}: ${r.data?.error ?? '?'}`);
  const entryId = r.data.entry?.id ?? r.data.id ?? '?';
  const entryLink = entryId !== '?' ? ` ${cfg.server.replace(/\/$/, '')}/entry?id=${entryId}` : '';
  emit(`✓ Synced. Entry ${entryId}${entryLink}`, r.data);
}
