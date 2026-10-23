/**
 * Next.js instrumentation hook. Runs once per server start.
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // A home's database changes when its server starts, and only then.
  const { allowMigrations } = await import('@/lib/db/migrate');
  allowMigrations();
  const { validationBoot } = await import('@/lib/service/validation-boot');
  if (validationBoot()) return;
  // Convert integration storage before config readers or stores can create new state.
  const { migrateIntegrationStorage } = await import('@/lib/integrations/storage');
  migrateIntegrationStorage();
  // Labels the background work below in the perf log (docs/server-perf-log.md).
  const { perfScope } = await import('@/lib/perf/recorder');
  const { registerWebSocketRuntime } = await import('@/lib/trpc/ws-server');
  await registerWebSocketRuntime();

  // Layout migration is NOT automatic — run `pnpm migrate:layout` once on an
  // existing install to move into the home + .config + .work shape. Fresh
  // installs need nothing (ensure* helpers create dirs on demand).

  const { ensureLocalToken, buildPairingUrl, getLocalBaseUrl } = await import('@/lib/auth/bootstrap');

  try {
    const info = ensureLocalToken();
    const baseUrl = getLocalBaseUrl();
    // A team's host token administers the installation. It's never a pairing
    // link and never a member's sign-in (docs/homes-spec.md §9.1).
    const { authorityKind } = await import('@/lib/home/authority');
    if (authorityKind() === 'team') {
      console.log(`[team] ready at ${baseUrl}`);
    } else if (info.created) {
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

  // Home identity (docs/homes-spec.md §10.3). A root whose data came from
  // another device does not act as the home: no background work starts,
  // and the API answers 503 until someone runs `ri home claim`.
  let teamHome = false;
  try {
    const { ensureHomeIdentity } = await import('@/lib/home/identity');
    const identity = ensureHomeIdentity();
    if (identity.created) console.log(`[home] created ${identity.home.kind === 'team' ? 'team' : 'home'} ${identity.home.id} on ${identity.device.name}`);
    // A team space starts only what a team uses (docs/homes-spec.md §9.2,
    // P6.3): no harness, schedule, import, embedding, app runtime or other
    // personal work, from its very first start. Everything below is personal.
    teamHome = identity.home.kind === 'team';
  } catch (err) {
    console.error(`[home] not acting as the home: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (teamHome) {
    await (await import('@/lib/team/startup')).startTeamSpace();
    return;
  }
  await (await import('@/lib/home/execution-startup')).startHomeExecutionRuntime();

  const { localAppsEnabled } = await import('@/lib/config/features');
  if (localAppsEnabled()) {
    try { await (await import('@/lib/local-apps/service')).localApps().initialize(); }
    catch (error) { console.error('[local-apps] startup failed', error instanceof Error ? error.message : 'App registry could not start'); }
  }

  // Every agent's folders are in the home's records (docs/homes-spec.md
  // §4.1): move what existed before into them, once, then check the home's
  // own. Connected devices check theirs when their workers connect.
  try {
    const { moveFolderRecords } = await import('@/lib/db/queries');
    const moved = moveFolderRecords();
    if (moved.setups || moved.links) console.log(`[setups] moved ${moved.setups} agent folder(s) and ${moved.links} linked folder(s) into the home's records`);
    for (const line of moved.settled) console.log(`[setups] agents used different places for ${line}`);
    const { checkHomeFolders } = await import('@/lib/setups/folders');
    await checkHomeFolders();
  } catch (err) {
    console.warn('[setups] moving folder records failed', err);
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
  // Moves a restart interrupted stop where they were, holding what they
  // held, before the sweep below re-fires unanswered messages (P4 review).
  try {
    const { recoverInterruptedTransfers } = await import('@/lib/transfer/continue');
    const recovered = recoverInterruptedTransfers();
    if (recovered.stopped || recovered.delivering) {
      console.log(`[transfer] startup: ${recovered.stopped} interrupted move(s) stopped, ${recovered.delivering} still delivering`);
    }
  } catch (err) {
    console.warn('[transfer] startup recovery failed', err);
  }

  try {
    const { reconcileAllSessions } = await import('@/lib/executor/reconcile');
    perfScope('startup:reconcile', () => reconcileAllSessions())
      .then((stats) => {
        console.log(
          `[reconcile] startup sweep: checked=${stats.checked} drifted=${stats.drifted} replayed=${stats.replayed} redispatched=${stats.redispatched} reapedStuckBootstraps=${stats.reapedStuckBootstraps} importsChecked=${stats.importsChecked} importsSynced=${stats.importsSynced} errors=${stats.errors}`,
        );
      })
      .catch((err) => {
        console.warn('[reconcile] startup sweep failed', err);
      });
  } catch (err) {
    console.warn('[reconcile] init failed', err);
  }

  // Durable agent requests and replies resume independently of browser viewers.
  try {
    const { startAgentCoordination } = await import('@/lib/coordination/service');
    startAgentCoordination();
  } catch (err) {
    console.warn('[coordination] startup failed', err);
  }

  // Send notifications a crash left pending: queued in a transaction that
  // committed, never sent (docs/homes-build.md, P2.3). At startup, then every
  // 5 minutes.
  try {
    const { drainPendingNotifications } = await import('@/lib/notifications/notify');
    const drain = () =>
      perfScope('timer:notifier', () => drainPendingNotifications())
        .then((n) => {
          if (n > 0) console.log(`[notifier] sent ${n} notification(s) left pending`);
        })
        .catch((err) => console.warn('[notifier] drain failed', err));
    void drain();
    const interval = setInterval(drain, 5 * 60_000);
    interval.unref?.();
  } catch (err) {
    console.warn('[notifier] drain init failed', err);
  }

  // Shared work from connected teams (docs/homes-spec.md §9.3, P7.2): the
  // tasks assigned to this person, and the ones they added, read now and
  // every two minutes. A viewer coming back to the window asks again.
  try {
    const { startTeamSync } = await import('@/lib/spaces/sync');
    startTeamSync();
  } catch (err) {
    console.warn('[teams] sync init failed', err);
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
    const interval = setInterval(() => perfScope('timer:health', async () => {
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
    }), HEALTH_SWEEP_INTERVAL_MS);
    // Don't keep the event loop alive on shutdown.
    interval.unref?.();
  } catch (err) {
    console.warn('[health] background sweep init failed', err);
  }

  // Wire the live calendar integration into the deck's calendar seam so the
  // proactive deck sizes/slots against the user's real day. No-op until a
  // calendar is connected; the integration isn't loaded until a deck generation
  // actually reads the calendar.
  try {
    const { ensureCalendarProvider } = await import('@/lib/deck/calendar-integration');
    ensureCalendarProvider();
  } catch (err) {
    console.warn('[calendar] provider init failed', err);
  }

  // "Keep Ri reachable": when the user opted in, re-open the app's own beamd
  // tunnel at boot and keep it alive, so a headless/remote box stays reachable
  // across restarts without a manual settings click. No-op unless opted in and
  // beamd is logged in. Background; never blocks startup.
  try {
    const { startAutoTunnel } = await import('@/lib/auth/auto-tunnel');
    startAutoTunnel();
  } catch (err) {
    console.warn('[auto-tunnel] init failed', err);
  }

  // Seed the app-managed morning-deck trigger (create-if-absent, adopts any
  // legacy name-linked row once). Must run before the scheduler tick so the
  // row is present for the first pass. See src/lib/deck/trigger.ts.
  try {
    const { ensureMorningDeckTrigger } = await import('@/lib/deck/trigger');
    ensureMorningDeckTrigger();
  } catch (err) {
    console.warn('[deck] morning trigger seed failed', err);
  }

  // Stream triage boot work: seed the app-managed sweep triggers.
  // See docs/streaming-spec-tasks.md.
  try {
    const { ensureStreamTriageTriggers } = await import('@/lib/stream-triage/triggers');
    ensureStreamTriageTriggers();
  } catch (err) {
    console.warn('[stream-triage] trigger seed failed', err);
  }

  // Seed the app-managed heartbeat trigger, off until the user turns it on.
  // See src/lib/heartbeat/trigger.ts and docs/heartbeat-spec.md.
  try {
    const { ensureHeartbeatTrigger } = await import('@/lib/heartbeat/trigger');
    await ensureHeartbeatTrigger();
  } catch (err) {
    console.warn('[heartbeat] trigger seed failed', err);
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
