import { createServer } from 'http';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { saveConfig, loadConfig, DEFAULT_RC_PATH, DEFAULT_SERVER } from '../config.mjs';
import { emit, note, fail } from '../output.mjs';
import { cmdSkill } from './skill.mjs';
import { apiCall } from '../api.mjs';

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
}

async function awaitKeyOnLoopback(port, expectedNonce, timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      // CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST',
        });
        return res.end();
      }
      if (req.method === 'POST' && req.url === '/key') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { key, nonce } = JSON.parse(body);
            if (nonce !== expectedNonce) {
              res.writeHead(403);
              return res.end('bad nonce');
            }
            res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
            res.end('ok');
            server.close();
            resolve(key);
          } catch (e) {
            res.writeHead(400);
            res.end('bad body');
            server.close();
            reject(e);
          }
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(port);
    setTimeout(() => { server.close(); reject(new Error('timeout waiting for key')); }, timeoutMs);
  });
}

async function multiSelectMenu(options) {
  // Fallback for non-TTY (CI, piped stdin): comma-separated numbers.
  if (!process.stdin.isTTY) {
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write('Select platforms (comma-separated numbers, e.g. "1,3"):\n');
    options.forEach((o, i) => process.stdout.write(`  [${i + 1}] ${o.label}\n`));
    return new Promise(resolve => {
      rl.question('> ', answer => {
        rl.close();
        const picked = answer.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(i => i >= 0 && i < options.length);
        resolve(picked.map(i => options[i].value));
      });
    });
  }

  // Interactive checkbox: ↑/↓ to move, space to toggle, enter to confirm.
  const readline = await import('readline');
  const stdin = process.stdin;
  const stdout = process.stdout;
  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();

  let cursor = 0;
  const checked = new Array(options.length).fill(false);

  const render = (firstPaint) => {
    if (!firstPaint) {
      // Move cursor up by (options.length + 2) to repaint
      stdout.write(`\x1b[${options.length + 2}A`);
    }
    stdout.write('\x1b[2K' + 'Select platforms (↑↓ move · space toggle · enter confirm):\n');
    options.forEach((o, i) => {
      const mark = checked[i] ? '[x]' : '[ ]';
      const arrow = i === cursor ? '>' : ' ';
      stdout.write('\x1b[2K' + `${arrow} ${mark} ${o.label}\n`);
    });
    stdout.write('\x1b[2K\n');
  };

  return new Promise((resolve, reject) => {
    render(true);
    const onKey = (_str, key) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('keypress', onKey);
        process.exit(130);
      }
      if (key.name === 'up') { cursor = (cursor - 1 + options.length) % options.length; render(false); }
      else if (key.name === 'down') { cursor = (cursor + 1) % options.length; render(false); }
      else if (key.name === 'space') { checked[cursor] = !checked[cursor]; render(false); }
      else if (key.name === 'return') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('keypress', onKey);
        const picked = options.filter((_, i) => checked[i]).map(o => o.value);
        resolve(picked);
      }
    };
    stdin.on('keypress', onKey);
  });
}

async function manualKeyPrompt(server) {
  const readline = await import('readline');
  process.stdout.write(`\nManual login. Steps:
  1. Open ${server} in your browser
  2. Log in (paste an existing key on the home page) or register at ${server}/register
  3. Go to ${server}/settings — your secret key is shown there
  4. Paste it below.

`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('Secret key: ', answer => { rl.close(); resolve(answer.trim()); });
  });
}

async function confirmRotateWarning() {
  // Skip if stdin isn't interactive (CI / piped input).
  if (!process.stdin.isTTY) return true;
  process.stdout.write(`\n⚠️  router init will GENERATE A NEW key, replacing the existing one.

Why: the server stores only a hash of your key, not the plaintext, so it
cannot return your existing key — it can only issue a new one.

This will INVALIDATE any existing session using the old key:
  • MCP connections (Claude Code / Desktop / Web)
  • CLI installs on other machines
  • Browser tabs that cached the old key

If you want to KEEP a working MCP and add CLI alongside, exit now and run:
  router login <your-existing-key>
  router skill install --cc --force        # and/or --codex --force

Multi-key per user is on the v1.1 roadmap to remove this trade-off.

`);
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve =>
    rl.question('Continue with init (rotate key)? [y/N] ', a => { rl.close(); resolve(a.trim().toLowerCase()); }),
  );
  return answer === 'y' || answer === 'yes';
}

export async function cmdInit(argv, ctx) {
  const cfg = loadConfig(DEFAULT_RC_PATH);
  const server = cfg.server || DEFAULT_SERVER;
  const manual = argv.includes('--manual');
  const yes = argv.includes('--yes') || argv.includes('-y');

  if (!yes) {
    const ok = await confirmRotateWarning();
    if (!ok) {
      emit('Aborted. No key was rotated.', { ok: false, aborted: true });
      return;
    }
  }

  emit(`Welcome to Teleport Router CLI v${ctx.cliVersion}.`, { ok: true });

  // Step 1: get key
  let key;
  if (manual) {
    key = await manualKeyPrompt(server);
  } else {
    const port = 50000 + Math.floor(Math.random() * 10000);
    const nonce = randomBytes(16).toString('hex');
    const url = `${server}/setup/cli?port=${port}&nonce=${nonce}`;
    note(`Opening browser: ${url}`);
    openBrowser(url);
    try { key = await awaitKeyOnLoopback(port, nonce); }
    catch (e) { fail(`Browser login failed: ${e.message}\nFall back: rerun with --manual`); }
  }

  saveConfig(DEFAULT_RC_PATH, { ...cfg, key });

  // Step 2: verify with whoami
  const r = await apiCall({ method: 'GET', server, path: '/api/me', key, cliVersion: ctx.cliVersion });
  if (!r.ok) fail(`Login failed: ${r.status} ${r.data?.error ?? ''}`);
  emit(`✓ Logged in as @${r.data.handle} (team: ${r.data.teamId})`, { ok: true, handle: r.data.handle });

  // Step 3: pick platforms (no selection = CLI only, no skill installed)
  const picked = await multiSelectMenu([
    { label: 'Claude Code  → ~/.claude/skills/router-sync/SKILL.md', value: 'cc' },
    { label: 'Codex CLI    → ~/.codex/AGENTS.md (with marker)', value: 'codex' },
    { label: 'Print skill text  (paste it elsewhere yourself)', value: 'print' },
  ]);

  const installArgs = [];
  if (picked.includes('cc')) installArgs.push('--cc');
  if (picked.includes('codex')) installArgs.push('--codex');
  if (installArgs.length > 0) {
    await cmdSkill(['install', ...installArgs], ctx);
  }
  if (picked.includes('print')) {
    note('\n──────────── SKILL.md content (copy-paste anywhere) ────────────');
    await cmdSkill(['show'], ctx);
    note('────────────────────────────────────────────────────────────────');
  }

  emit('\n✓ Done. Restart your AI tool to pick up the skill.', { ok: true });
  // Some sub-handlers (loopback server, readline raw mode) leave handles open
  // that prevent natural exit. Force a clean shutdown so the user gets their
  // shell back immediately.
  process.exit(0);
}
