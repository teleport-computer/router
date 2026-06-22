export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
  }
  return 0;
}

export function decideAction(currentVersion, headers) {
  if (!headers.latest || !headers.minSupported) return { kind: 'none' };
  if (compareVersions(currentVersion, headers.minSupported) < 0) {
    return { kind: 'block', latest: headers.latest };
  }
  if (compareVersions(currentVersion, headers.latest) < 0) {
    return { kind: 'soft', latest: headers.latest };
  }
  return { kind: 'none' };
}

export function formatBlockMessage(latest) {
  return `✗ Your CLI version is no longer supported. Please upgrade:\n  npm install -g @teleport-computer/router-cli@latest  # currently ${latest}`;
}

export function formatSoftMessage(latest) {
  return `💡 v${latest} available — upgrade with: npm install -g @teleport-computer/router-cli@latest`;
}
