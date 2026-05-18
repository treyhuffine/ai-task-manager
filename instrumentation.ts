/**
 * Next.js instrumentation hook. Runs once per server start.
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Run before any db / config access so the first read finds data in the
  // new location. No-op on fresh installs or when path overrides are set.
  const { migrateLegacyLayoutToBrain } = await import('@/lib/config/paths');
  const migration = migrateLegacyLayoutToBrain();
  if (migration.migrated) {
    console.log(`[paths] migrated legacy layout → brain/ (${migration.moved.join(', ')})`);
  }

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

  // Sweep active Claude sessions against their on-disk JSONL transcripts.
  // Catches drift introduced when the server died mid-turn or the live
  // stream missed events. First-ever reconcile per session just
  // initializes the byte-offset cursor (no replay); subsequent calls
  // replay only the delta. Background; never blocks startup.
  try {
    const { reconcileAllSessions } = await import('@/lib/executor/reconcile');
    reconcileAllSessions()
      .then((stats) => {
        console.log(
          `[reconcile] startup sweep: checked=${stats.checked} drifted=${stats.drifted} replayed=${stats.replayed} errors=${stats.errors}`,
        );
      })
      .catch((err) => {
        console.warn('[reconcile] startup sweep failed', err);
      });
  } catch (err) {
    console.warn('[reconcile] init failed', err);
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
}
