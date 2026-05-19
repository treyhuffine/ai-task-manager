/**
 * Graceful-shutdown wiring for the preview supervisor.
 *
 * Lives in its own module (rather than inline in `instrumentation.ts`)
 * because Next.js's Edge runtime build statically analyzes
 * `instrumentation.ts` and refuses any direct `process.*` calls in its
 * body — even ones that can only run when `NEXT_RUNTIME === 'nodejs'`.
 * Dynamic imports are opaque to that analyzer, so Node-only code that
 * lives inside them is fine.
 *
 * On SIGINT/SIGTERM we ask the supervisor to stop every supervised
 * preview (SIGTERM then SIGKILL after a 5s grace per process). PID
 * files are unlinked as each process exits, so a graceful shutdown
 * leaves no orphans for the next boot's sweep.
 */

import { getSupervisor } from './supervisor';

let installed = false;

export function installShutdownHook(): void {
  // Re-import on dev-server save shouldn't re-register the listener.
  if (installed) return;
  installed = true;

  const supervisor = getSupervisor();
  let shuttingDown = false;
  const onShutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await supervisor.stopAll();
    } catch (err) {
      console.warn('[preview] stopAll on shutdown failed', err);
    }
    // We've intercepted the default behavior by registering a listener,
    // so we need to exit manually. Use the standard signal-derived codes
    // (130 = SIGINT, 143 = SIGTERM).
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.once('SIGINT', onShutdown);
  process.once('SIGTERM', onShutdown);
}
