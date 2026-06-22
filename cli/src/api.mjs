export function parseVersionHeaders(headers) {
  return {
    latest: headers.get('X-Router-CLI-Latest'),
    minSupported: headers.get('X-Router-CLI-Min-Supported'),
  };
}

export async function apiCall({ method, server, path, key, body, cliVersion, timeoutMs = 30_000 }) {
  const sep = path.includes('?') ? '&' : '?';
  const url = key ? `${server}${path}${sep}key=${encodeURIComponent(key)}` : `${server}${path}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `teleport-router/${cliVersion}`,
    },
    signal: ac.signal,
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') {
      throw new Error(`Server did not respond within ${timeoutMs / 1000}s (${server}). Check connectivity, or set ROUTER_SERVER / --server <url> if pointing at the wrong host.`);
    }
    throw new Error(`Network error reaching ${server}: ${e?.message ?? e}`);
  }
  clearTimeout(timer);
  const versionInfo = parseVersionHeaders(res.headers);
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data, versionInfo };
}
