#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setJsonMode } from '../src/output.mjs';
import { loadConfig, saveConfig, DEFAULT_RC_PATH } from '../src/config.mjs';

// Read version from package.json so `npm version <bump>` is the single
// source of truth. Previously this was a hardcoded constant that drifted
// (package.json was at 1.0.4 but `router --version` still said 1.0.3).
const PKG_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
})();

const argv = process.argv.slice(2);

// ── Top-level version flag (must come before command dispatch) ─────────────
if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
  process.stdout.write(`router ${PKG_VERSION}\n`);
  process.exit(0);
}

const command = argv[0];
const rest = argv.slice(1);

// ── Global flags (strip from rest before forwarding to command) ────────────
if (rest.includes('--json')) {
  setJsonMode(true);
  rest.splice(rest.indexOf('--json'), 1);
}

// --server <url>: override server target for this invocation. We push it into
// process.env.ROUTER_SERVER so loadConfig (already env-aware) picks it up
// uniformly for all commands without each command needing changes.
const sIdx = rest.indexOf('--server');
if (sIdx >= 0 && rest[sIdx + 1]) {
  process.env.ROUTER_SERVER = rest[sIdx + 1];
  rest.splice(sIdx, 2);
}

const ctx = { cliVersion: PKG_VERSION };

const handlers = {
  init: () => import('../src/commands/init.mjs').then(m => m.cmdInit(rest, ctx)),
  login: () => import('../src/commands/login.mjs').then(m => m.cmdLogin(rest, ctx)),
  logout: () => import('../src/commands/logout.mjs').then(m => m.cmdLogout(rest, ctx)),
  uninstall: () => import('../src/commands/uninstall.mjs').then(m => m.cmdUninstall(rest, ctx)),
  whoami: () => import('../src/commands/whoami.mjs').then(m => m.cmdWhoami(rest, ctx)),
  list: () => import('../src/commands/list.mjs').then(m => m.cmdList(rest, ctx)),
  search: () => import('../src/commands/search.mjs').then(m => m.cmdSearch(rest, ctx)),
  write: () => import('../src/commands/write.mjs').then(m => m.cmdWrite(rest, ctx)),
  channels: () => import('../src/commands/channels.mjs').then(m => m.cmdChannels(rest, ctx)),
  tags: () => import('../src/commands/tags.mjs').then(m => m.cmdTags(rest, ctx)),
  get: () => import('../src/commands/get.mjs').then(m => m.cmdGet(rest, ctx)),
  delete: () => import('../src/commands/delete.mjs').then(m => m.cmdDelete(rest, ctx)),
  context: () => import('../src/commands/context.mjs').then(m => m.cmdContext(rest, ctx)),
  skill: () => import('../src/commands/skill.mjs').then(m => m.cmdSkill(rest, ctx)),
  doctor: () => import('../src/commands/doctor.mjs').then(m => m.cmdDoctor(rest, ctx)),
  brief: () => import('../src/commands/brief.mjs').then(m => m.cmdBrief(rest, ctx)),
  memory: () => import('../src/commands/memory.mjs').then(m => m.cmdMemory(rest, ctx)),
};

// ── Per-command help text ──────────────────────────────────────────────────
const COMMAND_HELP = {
  init: `router init [--manual] [--yes]

  First-time setup. Opens your browser to log in, then installs the SKILL.md
  template into Claude Code (and/or Codex CLI).

  ⚠️  Generates a NEW key, REPLACING any existing one. Will invalidate
  current MCP / CLI sessions using the old key. To keep an existing key,
  use \`router login <key>\` + \`router skill install\` instead.

  --manual    Skip browser flow. Opens a prompt where you paste a key copied
              from <server>/settings.
  --yes / -y  Skip the rotation-warning confirmation (for scripts / fresh installs).`,
  logout: `router logout

  Clears your local key from ~/.routerrc. Server-side keys are not revoked —
  rotate them at <server>/settings if needed.`,
  uninstall: `router uninstall [--yes]

  Remove all local state this CLI created:
    ~/.routerrc                              (CLI config + key)
    ~/.claude/skills/router-sync/SKILL.md    (Claude Code skill)
    router-sync marker block in ~/.codex/AGENTS.md (Codex)

  Does NOT touch the npm package itself — run \`npm uninstall -g
  @teleport-computer/router-cli\` after this completes.

  --yes / -y    Skip the confirmation prompt (for scripts).`,
  whoami: `router whoami

  Show the handle and team for the currently logged-in key.`,
  list: `router list [--limit N] [--channel x] [--tag a,b] [--author @h]

  Recent entries. Defaults to limit 20. Filters compose.`,
  search: `router search <query> [--tag a] [--limit N]

  Keyword search across team entries. Default limit 5 (kept small so AI tools
  can call this for context injection without flooding).`,
  write: `router write "summary" [flags]

  --tag a,b              1-5 tags (defaults to "cli" if omitted)
  --channel x            Target channel (omit for global feed)
  --content "<md>"       Markdown body
  --file <path>          Read body from file
  --oneliner "..."       10-15 char headline shown in lists
  --search-keywords k1,k2  Extra search terms`,
  get: `router get <id>

  Show full entry details (summary, content, tags, timestamps).`,
  delete: `router delete <id>

  Delete an entry within the 15-minute staging window. After staging, entries
  become public and can no longer be deleted via CLI.`,
  channels: `router channels

  List channels you are subscribed to (and any active team channels).`,
  tags: `router tags

  Show top tags ranked by recent usage.`,
  context: `router context [--json]

  Print server-side rules consumed by the AI skill: sync_mode, sync_triggers,
  tag_rules, preset_tags, channels, privacy_strip_patterns. JSON output by
  default; pass --json explicitly for the same.`,
  skill: `router skill <install|show|diff> [flags]

  install [--cc] [--codex] [--force]
        Install or update SKILL.md. --cc writes to ~/.claude/skills/router-sync,
        --codex writes a marker block into ~/.codex/AGENTS.md. --force overrides
        a user-modified file (otherwise it errors).
  show  Print the current server-authoritative SKILL.md template.
  diff  Show the difference between your local SKILL.md and the server template.`,
  doctor: `router doctor

  Self-check: server reachable, login valid, CLI version supported, SKILL.md
  installed and up to date, Codex marker integrity.`,
  brief: `router brief

  Per-user recap of recent router activity (Concierge) — shows entries
  since your last brief grouped into: @you / replies to you / new in
  subscribed channels / team milestones / your topic interests.

  Safe to call at session start — server tracks "last seen" so subsequent
  calls only surface NEW activity.`,
  memory: `router memory                     — full Memory (admin-maintained markdown)
  router memory sections            — list section headings + 1-line summary
  router memory section <name>      — fetch one section's body
  router memory set <file>          — replace Memory with file content (admin)
  router memory set -               — replace Memory with stdin (admin)

  Team Memory gives CC team-wide context (people, tech stack, conventions,
  long-term goals). Sections workflow is the lazy / cheap path — load only
  the section you need instead of the whole doc.

  Edit via this CLI (\`router memory set\`) or at <server>/settings/memory
  (web UI) or via the router_memory_set MCP tool. All three accept the
  same content; previous version is auto-saved as one-step undo.`,
  login: `router login <key>

  (Advanced) Write a key directly to ~/.routerrc. Most users should use
  \`router init\` instead.`,
};

function printHelp() {
  process.stdout.write(`Teleport Router CLI v${PKG_VERSION}

Usage:
  router init                First-time setup (browser login + skill install)
  router whoami              Show current user
  router logout              Clear local key
  router uninstall           Remove all local state (rc + skill + Codex block)
  router list                Recent entries
  router search <q>          Keyword search
  router write "summary"     Write a new entry
  router get <id>            Show entry details
  router delete <id>         Delete entry (within 15-min staging)
  router channels            List channels
  router tags                List tags
  router context             Show server-side rules + sync_mode
  router skill install       Install / update SKILL.md
  router skill show          Print SKILL.md template
  router skill diff          Compare local SKILL.md to server template
  router brief               Personalized recap of recent team activity (Concierge)
  router memory [sections|section <name>]
                             Team memory (full / index / one section)
  router doctor              Self-check
  router login <key>         (advanced) write key directly to ~/.routerrc
  router version             Print CLI version

Per-command help:
  router <command> --help    Show flags + examples for that command

Global flags:
  --json                     JSON output mode
  --server <url>             Override server (otherwise uses ~/.routerrc).
                             Same as setting ROUTER_SERVER env var.
  --version, -v              Print CLI version
`);
}

(async () => {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  const h = handlers[command];
  if (!h) {
    process.stderr.write(`Unknown command: ${command}\nTry: router help\n`);
    process.exit(1);
  }
  // Per-command --help: short-circuit before handler runs.
  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write((COMMAND_HELP[command] ?? `No help available for ${command}.`) + '\n');
    return;
  }
  try {
    await h();

    // Background skill sync (best-effort, never blocks command outcome).
    // Skip for commands that intentionally clear local state — otherwise
    // saveConfig recreates ~/.routerrc the moment the user just deleted it.
    const skipBgSync = command === 'uninstall' || command === 'logout';
    if (!skipBgSync) {
      try {
        const cfg = loadConfig(DEFAULT_RC_PATH);
        const { backgroundSyncSkill } = await import('../src/skill-sync.mjs');
        const result = await backgroundSyncSkill({ cfg, cliVersion: PKG_VERSION });
        // Only bump the 24h timer when we actually checked in with the
        // server. Bumping on 'throttled' would reset the cache window on
        // every command — active users would never trigger another sync.
        // Bumping on 'skipped' (server / network failure) would penalize
        // users for transient errors.
        if (result === 'up-to-date' || result === 'updated') {
          saveConfig(DEFAULT_RC_PATH, { ...cfg, last_skill_check_at: Date.now() });
        }
        if (result === 'updated') {
          process.stdout.write(`ℹ Skill auto-updated.\n`);
        }
      } catch { /* swallow */ }
    }
  } catch (e) {
    process.stderr.write(`Error: ${e?.message ?? e}\n`);
    process.exit(1);
  }
})();
