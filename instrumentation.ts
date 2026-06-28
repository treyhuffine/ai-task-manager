/**
 * Next.js instrumentation hook. Runs once per server start.
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Layout migration is NOT automatic — run `pnpm migrate:layout` once on an
  // existing install to move into the home + .config + .work shape. Fresh
  // installs need nothing (ensure* helpers create dirs on demand).

  const { ensureLocalToken, buildPairingUrl, getLocalBaseUrl } = await import('@/lib/auth/bootstrap');

  try {
    const info = ensureLocalToken();
    const baseUrl = getLocalBaseUrl();

    if (info.created) {
      console.log('\n[auth] First-time pairing');
      console.log(`[auth] Pairing URL: ${info.pairingUrl}`);
      console.log('[auth] Run `pnpm auth:pair` to reprint this URL.\n');
    } else {
      console.log(`[auth] ready at ${baseUrl} — run \`pnpm auth:pair\` for the pairing URL`);
      // Also print once on startup for convenience.
      console.log(`[auth] pairing URL: ${buildPairingUrl(info.plaintext, baseUrl)}`);
    }
  } catch (err) {
    console.error('[auth] failed to initialize local token:', err);
  }

  // Start the DB-to-markdown mirror: live export on every write + periodic
  // reconcile. Non-blocking; failures here don't stop the app.
  try {
    const { initMirror } = await import('@/lib/export/mirror');
    await initMirror();
  } catch (err) {
    console.warn('[mirror] init failed', err);
  }

  // Sweep active Claude sessions against their on-disk JSONL transcripts
  // AND heal in-memory state. Catches drift introduced when the server
  // died mid-turn or the live stream missed events, drops dead cached
  // handles, and silently redispatches any unanswered user messages so
  // returning users see completed work instead of stuck spinners.
  // First-ever reconcile per session just initializes the byte-offset
  // cursor (no replay); subsequent calls replay only the delta.
  // Background; never blocks startup.
  try {
    const { reconcileAllSessions } = await import('@/lib/executor/reconcile');
    reconcileAllSessions()
      .then((stats) => {
        console.log(
          `[reconcile] startup sweep: checked=${stats.checked} drifted=${stats.drifted} replayed=${stats.replayed} redispatched=${stats.redispatched} reapedStuckBootstraps=${stats.reapedStuckBootstraps} errors=${stats.errors}`,
        );
      })
      .catch((err) => {
        console.warn('[reconcile] startup sweep failed', err);
      });
  } catch (err) {
    console.warn('[reconcile] init failed', err);
  }

  // Periodic background health check over the small set of sessions
  // currently marked running. Catches missed-`result`-event stalls
  // even if the user never opens the session — without it, a wedged
  // turn stays wedged until the next user interaction. Iterates only
  // running sessions, so the cost scales with active work, not total
  // session count.
  //
  // Sweep is sequential to match the cold-start pattern: a missed-
  // result wave can produce many stale-running sessions at once;
  // firing all health checks (each of which may kick off a fresh
  // dispatch) in parallel would stampede subprocess spawn and
  // SQLite. The `dispatch` call inside healthCheckSession is itself
  // fire-and-forget, so the await here only covers reconcile + state
  // checks — fast even on a large running set.
  //
  // The reentrancy guard prevents a second tick from starting while
  // the previous sweep is still running (slow reconcile on cold
  // disks, etc.).
  try {
    const { listRunningSessions } = await import('@/lib/executor/adapter');
    const { healthCheckSession } = await import('@/lib/executor/health');
    const HEALTH_SWEEP_INTERVAL_MS = 60_000;
    let sweeping = false;
    const interval = setInterval(async () => {
      if (sweeping) return;
      sweeping = true;
      try {
        for (const id of listRunningSessions()) {
          try {
            await healthCheckSession(id, { redispatchOrphans: true });
          } catch (err) {
            console.warn(`[health] background sweep failed for ${id}:`, err);
          }
        }
      } finally {
        sweeping = false;
      }
    }, HEALTH_SWEEP_INTERVAL_MS);
    // Don't keep the event loop alive on shutdown.
    interval.unref?.();
  } catch (err) {
    console.warn('[health] background sweep init failed', err);
  }

  // Reset orphaned background setup scripts. A `setupScriptStatus='running'`
  // at boot means the runner died with the previous server process (restart /
  // crash mid-install), so it can never resolve — the UI would spin on
  // "Running setup script…" forever. Flip to failed-with-retry instead.
  try {
    const { resetOrphanedSetupScripts } = await import('@/lib/db/queries');
    const n = resetOrphanedSetupScripts();
    if (n > 0) console.log(`[setup] reset ${n} orphaned 'running' setup script(s) from a prior run`);
  } catch (err) {
    console.warn('[setup] orphaned-setup reset failed', err);
  }

  // Reap orphaned preview processes from a prior Flow run that crashed
  // or restarted without a clean stop. The PID files we wrote at spawn
  // time tell us what to look for; we kill the process group only when
  // the live command line still matches what we recorded, so PID
  // recycling can't make us nuke an unrelated process.
  try {
    const { sweepOrphans } = await import('@/lib/preview/pid-store');
    sweepOrphans()
      .then((stats) => {
        if (stats.checked > 0) {
          console.log(
            `[preview] orphan sweep: checked=${stats.checked} killed=${stats.killed} skipped=${stats.skipped}`,
          );
        }
      })
      .catch((err) => {
        console.warn('[preview] orphan sweep failed', err);
      });
  } catch (err) {
    console.warn('[preview] orphan sweep init failed', err);
  }

  // Register built-in preview providers (localhost / beamd / portless /
  // manual) and start the idle-evict loop: after N idle minutes, stop the
  // server and close its tunnel, keeping the name/URL reserved so the next
  // view cold-starts the same URL. Keeps an overnight queue of finished
  // tasks from melting the host. No eager bring-up on boot — bring-up is
  // lazy on first resolve (see docs/preview-system-spec.md §2/§4).
  try {
    await import('@/lib/preview/providers'); // side-effect: register built-ins
    const { startIdleEvictLoop } = await import('@/lib/preview/service');
    startIdleEvictLoop();
  } catch (err) {
    console.warn('[preview] provider/idle-evict init failed', err);
  }

  // Wire the live calendar connector into the deck's calendar seam so the
  // proactive deck sizes/slots against the user's real day. No-op until a
  // calendar is connected; the connector isn't loaded until a deck generation
  // actually reads the calendar.
  try {
    const { ensureCalendarProvider } = await import('@/lib/deck/calendar-connector');
    ensureCalendarProvider();
  } catch (err) {
    console.warn('[calendar] provider init failed', err);
  }

  // Best-effort: stop every supervised preview when Flow is asked to
  // exit cleanly. SIGTERM/SIGINT only — Node can't intercept SIGKILL.
  // Lives in a dynamically-imported module because Next.js's Edge
  // runtime build statically rejects `process.once` / `process.exit`
  // in this file's body even though the early-return above guarantees
  // they never run in the Edge runtime.
  try {
    const { installShutdownHook } = await import('@/lib/preview/shutdown');
    installShutdownHook();
  } catch (err) {
    console.warn('[preview] shutdown hook init failed', err);
  }

  // Scheduler tick — fires every 60s, reads enabled `schedules` whose
  // `next_run_at` has matured, and dispatches runs. Includes its own
  // boot recovery (reaping stuck `running` runs from a prior process)
  // and a file lock so two ticks can't dispatch the same row. See
  // src/lib/scheduler/runner.ts.
  try {
    const { startScheduler } = await import('@/lib/scheduler/runner');
    startScheduler();
  } catch (err) {
    console.warn('[scheduler] init failed', err);
  }
}
