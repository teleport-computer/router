/**
 * Entry source detection — derive `sourceApp` and `sourceVia` from request
 * context (MCP clientInfo or HTTP User-Agent) at write time.
 *
 * Record-only for now; UI is deferred until we collect 1-2 weeks of real-world
 * data. See docs/superpowers/specs/2026-05-13-entry-source-tracking-design.md.
 *
 * Mapping rules are best-effort — unknown values pass through with a prefix
 * (eg `mcp-windsurf`) and are logged ONCE per process so we can extend the
 * canonical enum after observing what real clients actually send.
 */

// In-memory dedup so the "new clientInfo seen" log fires once per name per
// process restart — avoids log floods if a non-mainstream client connects
// frequently.
const SEEN_UNKNOWN_MCP_CLIENTS = new Set<string>();
const SEEN_UNKNOWN_HTTP_AGENTS = new Set<string>();

/** Canonical MCP clientInfo.name → source_app value. */
const MCP_CLIENT_MAP: Record<string, string> = {
  'claude-code': 'cc-cli',
  // Claude Desktop's actual clientInfo.name is unverified at design time —
  // candidates include 'claude-ai', 'claude', 'anthropic-claude-desktop'.
  // We map all of them to 'cc-desktop'; first deploy will reveal which one
  // is real (the others stay as no-op safety nets).
  'claude-ai': 'cc-desktop',
  'claude': 'cc-desktop',
  'anthropic-claude-desktop': 'cc-desktop',
  'codex': 'codex',
  'cursor': 'cursor',
  'cursor-vscode': 'cursor',
  'windsurf': 'windsurf',
  'continue': 'continue',
};

/**
 * Map MCP clientInfo.name → source_app. Unknown names are returned with an
 * `mcp-` prefix (eg `mcp-some-new-client`) so we capture the literal value
 * for later analysis. First sighting per process is logged.
 */
export function detectMcpClientApp(name: string | undefined): string {
  if (!name) return 'unknown';
  const normalized = name.toLowerCase();
  const known = MCP_CLIENT_MAP[normalized];
  if (known) return known;
  if (!SEEN_UNKNOWN_MCP_CLIENTS.has(normalized)) {
    SEEN_UNKNOWN_MCP_CLIENTS.add(normalized);
    console.log(`[entry-source] new MCP clientInfo.name seen: "${name}" — mapped to "mcp-${normalized}"`);
  }
  return `mcp-${normalized}`;
}

/**
 * Map HTTP request signal (User-Agent + Origin) → source_app. router-cli
 * sends a recognizable UA; browser-shaped UAs from our own origin are `web`;
 * everything else falls back to `http` (curl, scripts, third-party).
 *
 * @param ourOrigins — list of host names we consider "our web" (eg
 *                     ['router.feedling.app', 'shaperotator.teleport.computer']).
 *                     Pass [] to treat all browser UAs as `web` regardless.
 */
export function detectHttpClientApp(
  userAgent: string | undefined,
  origin: string | undefined,
  ourOrigins: string[] = [],
): string {
  if (!userAgent) return 'http';
  const ua = userAgent.toLowerCase();
  if (ua.includes('router-cli/') || ua.startsWith('router-cli')) return 'router-cli';
  // Mozilla-prefixed UAs cover all major browsers (Chrome/Safari/Firefox/Edge).
  if (ua.includes('mozilla/')) {
    if (ourOrigins.length === 0) return 'web';
    if (origin) {
      try {
        const host = new URL(origin).host;
        if (ourOrigins.some(o => host === o || host.endsWith('.' + o))) return 'web';
      } catch {
        // Malformed origin — fall through to generic `http`.
      }
    }
    // Browser UA but origin doesn't match → likely cross-site script. Log once.
    if (!SEEN_UNKNOWN_HTTP_AGENTS.has(ua)) {
      SEEN_UNKNOWN_HTTP_AGENTS.add(ua);
      console.log(`[entry-source] browser-UA HTTP write from non-our origin: ua="${userAgent}" origin="${origin || '(none)'}"`);
    }
    return 'http';
  }
  return 'http';
}

/** Convenience for internal addEntry callers (cron, channel digest, etc.). */
export const INTERNAL_SOURCE = {
  sourceApp: 'lark-bot',
  sourceVia: 'internal',
} as const;
