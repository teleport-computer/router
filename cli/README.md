# Teleport Router CLI

Token-efficient CLI for [Teleport Router](https://router.feedling.app), the team shared notebook.

## Install

```bash
npm install -g @teleport-computer/router-cli
router init
```

`router init` opens your browser to log in, then auto-installs a Skill into Claude Code (and/or Codex CLI) so saying "sync this" in your AI tool routes to Router.

If the browser flow doesn't fit your environment (SSH, headless, locked-down corp setup), use `router init --manual` and paste a key copied from `<server>/settings`.

## Commands

| Command | Description |
|---|---|
| `router init` | First-time setup |
| `router whoami` | Show current user |
| `router logout` | Clear local key |
| `router uninstall` | Remove all local state (config + skill + Codex block); run `npm uninstall -g` after |
| `router list` | Recent entries |
| `router search <q>` | Keyword search (default limit 5, AI-friendly) |
| `router get <id>` | Entry details |
| `router write "summary"` | Write entry (see flags below) |
| `router delete <id>` | Delete entry (within 15-min staging) |
| `router channels` | List channels |
| `router tags` | List tags |
| `router context` | Server-side rules + sync_mode |
| `router skill install` | Re-install / update SKILL.md |
| `router skill show` | Print the server-authoritative SKILL.md template |
| `router skill diff` | Show difference between local SKILL.md and server template |
| `router doctor` | Self-check |
| `router brief` | Per-user recap of recent team activity (Concierge) |
| `router memory` | Team memory (full / `sections` / `section <name>`) |
| `router version` | Print CLI version (also `--version` / `-v`) |

Every command supports `--help` (`router write --help`) for flags and examples.

### `router write` flags

| Flag | Description |
|---|---|
| `--tag a,b` | Comma-separated tags (1-5) |
| `--channel x` | Target channel |
| `--content "<md>"` | Markdown body |
| `--file path` | Read body from file |
| `--oneliner "..."` | 10-15 char headline |
| `--search-keywords k1,k2` | Extra search terms |

### Global flags

| Flag | Description |
|---|---|
| `--json` | Machine-readable output (for scripts / agents) |
| `--server <url>` | Override the server (handy for staging). Same as `ROUTER_SERVER` env var. |
| `--version`, `-v` | Print CLI version |

## Configuration

Config is stored at `~/.routerrc`:

```json
{
  "key": "...",
  "server": "https://router.feedling.app",
  "last_skill_check_at": 1746523000
}
```

Override server without touching the file:

```bash
ROUTER_SERVER=https://staging.router.example router list
# or
router list --server https://staging.router.example
```

## Sync modes

Configure at `<server>/settings/sync`:

- **Active (default)**: AI proactively asks when it sees a noteworthy moment, or pushes immediately when you say "sync".
- **Passive**: AI auto-pushes silently with privacy stripping. You get a notification afterward; undo within 15 minutes via `router delete <id>`.

Skill template behavior is server-authoritative — the CLI auto-pulls updates daily. You don't need to reinstall when sync settings change.

## License

MIT
