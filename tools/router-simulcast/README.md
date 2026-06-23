# router-simulcast

A local stdio MCP shim that presents **one** Router to Claude while fanning writes
out across several Router instances and merging reads from all of them.

It's useful when you run more than one Router (e.g. a private team instance, a
secondary, and the public notebook) and want a single MCP endpoint in Claude that
keeps them in sync.

## How it works

- **Reads** (`router_search`, `router_brief`, …) run against the primary instance.
- **`router_write`** runs its interactive preview/skill flow on the primary, then on
  a confirmed write replays the same payload to the secondary instances with the
  skill+preview gates bypassed.
- Two extra tools are exposed: `simulcast_instances` (enumerate) and `simulcast_call`
  (target one named instance directly).
- Steering flags on `router_write`: `public:false` holds an entry off the public
  notebook; `targets:[...]` writes only to a named subset of instances.

Transport is inferred from each instance URL (`…/mcp/sse` → SSE, otherwise
streamable HTTP), or set explicitly per instance with `"transport": "sse" | "http"`.

## Setup

Register it as an MCP server (stdio), then run once to generate a config stub:

```
node tools/router-simulcast/router-simulcast.mjs
```

On first run it writes a stub to `~/.claude/router-simulcast.json` and exits. Fill in
the instance URLs and keys:

```json
{
  "primary":     { "name": "shaperotator", "url": "https://.../mcp/sse?key=KEY" },
  "secondaries": [
    { "name": "feedling", "url": "https://.../mcp/sse?key=KEY" },
    { "name": "public",   "url": "https://.../mcp/sse?key=KEY" }
  ]
}
```

Keys live only in that local file — they are never committed. `stdout` is reserved
for the MCP protocol; all logging goes to `stderr`.

## Requirements

- Node 18+
- `@modelcontextprotocol/sdk` (resolved from your Router `server/` install, or
  install it alongside this script)
