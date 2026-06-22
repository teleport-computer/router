/**
 * Read a required environment variable.
 *
 * - In production (NODE_ENV=production): throws if unset, so misconfiguration
 *   is caught at startup rather than silently routing to a wrong URL.
 * - In development: warns once and returns "" so local dev keeps working
 *   while still surfacing the missing var.
 * - In test: returns "" silently so test setup doesn't have to set every var.
 */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v) return v;
  const env = process.env.NODE_ENV;
  if (env === 'production') {
    throw new Error(`Missing required env var: ${name}`);
  }
  if (env !== 'test') {
    console.warn(`[router] ${name} not set; using empty string. Set it in .env.`);
  }
  return '';
}
