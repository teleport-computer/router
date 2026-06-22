import type { NextConfig } from "next";

// API proxy target — read at BUILD time. To run multiple instances pointing
// at different backends, build separately with different API_PROXY_TARGET
// values into different `.next.<name>` directories, then run each PM2
// process with `next start --dist-dir .next.<name>`. See deploy/ecosystem.
//
// Tried Edge-runtime middleware (web/middleware.ts) for runtime env reading
// but Next.js 16.2's middleware sandbox strips arbitrary process.env vars.
// nodeMiddleware experimental flag isn't in 16.2 TS types yet. Two-build
// approach is the simplest reliable path.
const API_PROXY_TARGET =
  process.env.API_PROXY_TARGET || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Hosts allowed to access dev resources (HMR, etc). Used in dev when serving
// through a tunnel like ngrok. Comma-separated list via env, e.g.:
//   NEXT_DEV_ALLOWED_ORIGINS="rage-expand-upstroke.ngrok-free.dev,*.ngrok-free.dev"
const allowedDevOrigins = (process.env.NEXT_DEV_ALLOWED_ORIGINS || '*.ngrok-free.dev,*.ngrok.app,*.trycloudflare.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Read at both build and start time — set NEXT_DIST_DIR=.next.shape to
  // build into / serve from a separate directory (used by shape-web). Lark's
  // teamwork-web leaves it unset and uses the default .next dir.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  allowedDevOrigins,

  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_PROXY_TARGET}/api/:path*` },
      { source: '/mcp/:path*', destination: `${API_PROXY_TARGET}/mcp/:path*` },
    ];
  },
};

export default nextConfig;
