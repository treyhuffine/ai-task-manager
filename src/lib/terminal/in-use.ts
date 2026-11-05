/**
 * How many terminals an update or planned restart should wait for
 * (docs/always-on-spec.md 7.2): one a window is showing, or one running a
 * command, since walking away from a long job is normal. An idle shell nobody
 * has open doesn't count, because nothing ever closes those by itself. Reads the
 * registry pty-manager keeps on globalThis, so the service's HTTP host can ask
 * without loading node-pty.
 */
import path from 'node:path';

interface Terminal { exited: boolean; shell: string; listeners: Set<unknown>; proc: { process: string } }

function runningCommand(terminal: Terminal) {
  // The foreground process's name, which is the shell itself when it's idle.
  try { return terminal.proc.process !== path.basename(/* turbopackIgnore: true */ terminal.shell); }
  catch { return false; }
}

export function terminalsInUse(): number {
  const registry = (globalThis as { __ptyRegistry?: { terminals: Map<string, Terminal> } }).__ptyRegistry;
  if (!registry) return 0;
  let inUse = 0;
  for (const terminal of registry.terminals.values()) {
    if (!terminal.exited && (terminal.listeners.size > 0 || runningCommand(terminal))) inUse++;
  }
  return inUse;
}
