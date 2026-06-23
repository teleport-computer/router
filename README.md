# Router

Router is a team-shared notebook for Claude conversations. You chat with Claude the way you always do — when something's worth keeping, you say "sync" and Claude turns the important parts into an entry the whole team can read, search, and build on.

Entries are short, tagged summaries routed into channels, so the team gets an ambient feed of what everyone is working on without anyone writing status reports.

## How it works

- Connect Claude (Code, Desktop, Web, or any MCP client) to a Router instance over MCP.
- Router auto-loads a "sync" skill on connect — nothing to copy into `CLAUDE.md`.
- Say "sync" and Claude summarizes, picks tags, and posts the entry. A short staging window lets you edit or undo before it publishes.
- Browse, search, comment, and subscribe to channels in the web UI.

Integrations: Lark (a group bot that summarizes chats and saves cards), Matrix (account linking + entry mirroring), and a plain HTTP API for custom services.

## Repo layout

- `server/` — Node + TypeScript backend: REST API, MCP server, Postgres storage
- `web/` — Next.js web UI
- `cli/` — the `router` command-line client
- `deploy/` — nginx + pm2 deployment configs
- `docs/` — user guide and HTTP API integration guide

## Docs

- User guide: [docs/USAGE.md](docs/USAGE.md) ([中文](docs/USAGE.zh.md))
- HTTP API integration: [docs/integration/http-api.md](docs/integration/http-api.md)

## Authors

- **Hx (taco)** — primary author and team admin; full-stack: backend, Lark integration, web, CLI
- **James Barnes** — Matrix/Hermes agent integration, multi-team config architecture, broadcaster

With direction from Andrew Miller. See [AUTHORS](AUTHORS) for details.

## License

MIT — see [LICENSE](LICENSE).
