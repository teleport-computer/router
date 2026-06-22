/**
 * PM2 process definitions for Teamwork.
 *
 * Apps read their own .env file (server/.env, server/.env.shape, web/.env.production)
 * — keep secrets there, NOT in this checked-in config.
 *
 * Local "fake-prod" usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs        # tail logs
 *   pm2 restart all # after rebuild
 *   pm2 stop all
 *
 * Production layout:
 *   teamwork-server (3001) + teamwork-web (3000)  — Lark instance
 *   shape-server    (4002) + shape-web    (4001)  — Shape Rotator instance
 *
 * Each web instance has its OWN `.next.<name>` build artifact:
 *   teamwork-web   → web/.next        (built with default API_PROXY_TARGET)
 *   shape-web      → web/.next.shape  (built with API_PROXY_TARGET=:4002)
 *
 * deploy.yml CI runs `next build` twice with different env to produce both
 * artifacts. We tried Edge-runtime middleware for single-build dynamic
 * routing but Next.js 16.2's middleware sandbox strips arbitrary
 * process.env vars at runtime. Two-build approach is reliable.
 *
 * The shape-server uses Node 20.6+ `--env-file=.env.shape` so secrets stay
 * in server/.env.shape (gitignored) instead of leaking into this config.
 */

const path = require('path');

module.exports = {
  apps: [
    // ── Lark instance ──
    {
      name: 'teamwork-server',
      cwd: path.join(__dirname, 'server'),
      script: 'node',
      args: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      // Belt-and-suspenders for the Lark WS "ghost connection" issue (broker
      // drops session subscription while socket stays alive → no events flow).
      // The in-process watchdog in lark/event-client.ts already exits after 45
      // min of silence; this nightly cron is a defense in case the watchdog
      // itself is somehow wedged. 04:00 UTC = lowest-traffic window (~noon JST,
      // ~midnight EDT). Reload takes ~1s.
      cron_restart: '0 4 * * *',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
        // DATABASE_URL, PUBLIC_URL, STAGING_DELAY_MS, etc. come from server/.env (dotenv).
      },
      out_file: path.join(__dirname, 'logs/server.out.log'),
      error_file: path.join(__dirname, 'logs/server.err.log'),
      time: true,
    },
    {
      name: 'teamwork-web',
      cwd: path.join(__dirname, 'web'),
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port 3000',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        // NEXT_PUBLIC_API_URL is intentionally unset → API requests go same-origin.
        // API_PROXY_TARGET unset → next.config defaults to http://localhost:3001.
      },
      out_file: path.join(__dirname, 'logs/web.out.log'),
      error_file: path.join(__dirname, 'logs/web.err.log'),
      time: true,
    },

    // ── Shape Rotator instance ──
    {
      name: 'shape-server',
      cwd: path.join(__dirname, 'server'),
      // Node 20.6+ --env-file loads .env.shape into the process env, replacing
      // the default `.env` that dotenv-config would pick up. PORT, DATABASE_URL,
      // PUBLIC_URL, OPENROUTER_API_KEY, LARK_BOT_ENABLED=false, LOCALES_AVAILABLE=en
      // all live there.
      script: 'node',
      args: '--env-file=.env.shape dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      out_file: path.join(__dirname, 'logs/shape-server.out.log'),
      error_file: path.join(__dirname, 'logs/shape-server.err.log'),
      time: true,
    },
    {
      name: 'shape-web',
      cwd: path.join(__dirname, 'web'),
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port 4001',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: '4001',
        // Tell Next to read its build artifact from .next.shape (built by
        // deploy.yml with API_PROXY_TARGET=http://localhost:4002 baked in).
        // teamwork-web has no NEXT_DIST_DIR and uses the default .next.
        NEXT_DIST_DIR: '.next.shape',
        // Baked at BUILD time, kept here for documentation / future-proofing.
        API_PROXY_TARGET: 'http://localhost:4002',
      },
      out_file: path.join(__dirname, 'logs/shape-web.out.log'),
      error_file: path.join(__dirname, 'logs/shape-web.err.log'),
      time: true,
    },
  ],
};
