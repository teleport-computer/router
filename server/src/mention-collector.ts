/**
 * Pure collector — gather distinct `@handle` tokens from an entry's text body
 * and explicit `to[]` field, lowercase them, drop the author's own handle.
 *
 * Server-side mention extraction is strict: only canonical `@handle` (lowercase
 * alphanumeric, matching a real router user) fires a notification. Alias /
 * fuzzy resolution happens upstream — CC translates "ping Andrew Miller" to
 * `@amiller` BEFORE writing, using TEAM MEMORY in MCP instructions. See
 * docs/superpowers/specs/2026-05-13-at-mention-llm-design.md.
 *
 * Channel-style entries `to: ["#channel-x", "@amiller"]` are mixed: only the
 * `@`-prefixed targets become notification candidates here; `#`-prefixed
 * targets are channel webhooks (separate path).
 */
export function collectMentionedHandles(args: {
  /** Concatenation of entry.summary + '\n' + entry.content (or comment body). */
  text: string;
  /** entry.to[] field. Mix of `@handle` and `#channel` tokens; only `@` ones count here. */
  to: string[] | undefined;
  /** entry.handle — author. Excluded from the result so writing `@me` doesn't self-notify. */
  selfHandle: string;
}): Set<string> {
  const handles = new Set<string>(
    (args.text.match(/@(\w+)/g) || []).map(m => m.slice(1).toLowerCase()),
  );
  for (const target of args.to || []) {
    if (target.startsWith('@')) {
      const h = target.slice(1).toLowerCase();
      if (h) handles.add(h);
    }
  }
  handles.delete(args.selfHandle.toLowerCase());
  return handles;
}
