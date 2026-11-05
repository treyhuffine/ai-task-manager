/**
 * How many terminals a window is showing right now, which an update or planned
 * restart waits for (docs/always-on-spec.md 7.2). A terminal nobody has open
 * doesn't count: nothing ever closes those by itself. Reads the registry
 * pty-manager keeps on globalThis, so the service's HTTP host can ask without
 * loading node-pty.
 */
export function watchedTerminals(): number {
  const registry = (globalThis as { __ptyRegistry?: { terminals: Map<string, { exited: boolean; listeners: Set<unknown> }> } }).__ptyRegistry;
  if (!registry) return 0;
  let watched = 0;
  for (const terminal of registry.terminals.values()) if (!terminal.exited && terminal.listeners.size > 0) watched++;
  return watched;
}
