/**
 * Build the public /api/server-info payload from environment variables.
 *
 * Used by the web frontend to gate per-instance UI (platform surfaces,
 * language toggle) without rebuilding the bundle. One Docker image, many
 * deployments.
 *
 * Platforms model: `features.platforms` is the list of chat platforms
 * with first-class Router web UI on this instance. Today only "lark"
 * exists (OAuth login, account binding, group bindings, reactions, bot
 * commands). Future platforms (matrix / slack / etc.) get added by
 * (a) wiring a new env flag here, (b) pushing the platform name onto
 * the array, (c) writing the platform-specific UI components and
 * gating them on `features.platforms.includes("...")`.
 *
 * Platforms NOT in this list integrate via external agents calling
 * Router's HTTP API / MCP / CLI. They don't appear here because the
 * web UI doesn't need to render anything for them.
 */

export interface ServerInfo {
  site_name: string;
  features: {
    /** Platforms with first-class Router web UI on this instance. */
    platforms: string[];
    /** Locale codes the instance supports (e.g. ["en","zh"] or ["en"]). */
    languages: string[];
    /**
     * True when the Lark API credentials (LARK_APP_ID + LARK_APP_SECRET) are
     * configured on this instance, regardless of whether the event listener
     * (LARK_BOT_ENABLED) is on. Tag-detail pages can use this to surface the
     * binding management panel — managing existing bindings doesn't require
     * the event listener.
     */
    lark_configured: boolean;
  };
}

export function buildServerInfo(): ServerInfo {
  const platforms: string[] = [];
  if (process.env.LARK_BOT_ENABLED === 'true') {
    platforms.push('lark');
  }
  // Future: if (process.env.MATRIX_ENABLED === 'true') platforms.push('matrix');

  const larkConfigured = !!(process.env.LARK_APP_ID && process.env.LARK_APP_SECRET);

  const localesRaw = process.env.LOCALES_AVAILABLE ?? 'en,zh';
  const languages = localesRaw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  return {
    site_name: 'Teleport Router',
    features: {
      platforms,
      languages,
      lark_configured: larkConfigured,
    },
  };
}
