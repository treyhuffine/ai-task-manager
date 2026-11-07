/** Ordinary Node controller. No Electron imports or GUI dependency. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import getPort from 'get-port';
import { acquireServiceOwner } from '@/lib/service/owner';
import { runtimeJob, initializeRuntimeJobs, stopRuntimeJobs } from '@/lib/service/runtime-job';
import { serviceEnvironment } from '@/lib/service/environment';
import { bundledCliCommand } from '../../desktop/config';
import { canonical, servicePaths } from '@/lib/service/paths';
import type { ServiceStatus } from '@/lib/service/client';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { ensureGeneratedTls } from '@/lib/config/tls';
import { startNextServer } from '@/cli/lib/server';
import { startHttp2Gateway, type Http2GatewayHandle } from '@/cli/http2-gateway';
import { readLiveServerRuntime, publishServerRuntime, clearServerRuntimeIfOwned, newRunId, PUBLIC_BASE_URL_ENV, isProcessAlive } from '@/lib/server-runtime/record';
import { pendingMigrations, snapshotsInUse, UpdateCoordinator, type RuntimeTarget } from '@/lib/service/update';
import { assertNoLegacyWriters, ownedProcessIds } from '@/lib/service/processes';
import { HANG_LIMIT_MS, HangDetector, memoryAction, PROBE_INTERVAL_MS, PROBE_TIMEOUT_MS, RestartTracker, serverMissing, type Memory } from '@/lib/service/supervisor';
import { readStopped } from '@/lib/service/stopped';
import { hasLoginSupervision } from '@/lib/service/install';
import { installedRuntime } from '@/lib/service/runtime';
import { emptyTrash, pruneReleases, writeHomeRecord } from '@/lib/service/store';
import { activationPending, clearActivation, readActivation } from '@/lib/service/activation';
import { isHomeSnapshot, pruneSnapshots } from '@/lib/service/snapshot';
import { writeMaintenance, clearMaintenance, exclusiveActivity } from '@/lib/service/maintenance';
import { checkReleaseIndex, releasePolicy } from '@/lib/service/release';
import { followTarget, type HomeRelease } from '@/lib/service/follow-home';
import { negotiateWorker } from '@/lib/releases/compatibility';
import { readOrigin } from '@/lib/service/origin';
import { updateReleasePreferences } from '@/lib/service/release-trust';
import { ServiceControlCoordination } from '@/lib/service/control-coordination';
import { consumeDesktopInitialization } from '@/lib/service/initialization';
import { redactServiceLine, rotateServiceLog } from '@/lib/service/logging';
import { StartupDiagnostics } from '@/lib/service/startup-diagnostics';
import { ServiceAwake } from '@/lib/service/awake';
import { ServiceWorker, validateWorkerRuntime } from '@/lib/service/worker';
import { acquireWorkerLock } from '@/lib/worker/lock';
import { assertWorkerStorage } from '@/lib/service/worker-checkpoint';
import { workerUpdateCompatibility, runtimePeerRelease } from '@/lib/releases/runtime-identity';
import { describeServiceRole, resolveServiceRole, servesHome } from '@/lib/service/role';

const paths = servicePaths();
let repo = canonical(process.env.RI_RUNTIME_REPO ?? process.cwd());
const controllerRepo = repo;
let node = process.execPath;
process.chdir(repo);
process.env.RI_RUNTIME_REPO = repo;
process.env.RI_DESKTOP_CLIENT_SECRET = randomBytes(32).toString('base64url');
process.env.RI_SERVICE_CONTROL_TOKEN = randomBytes(32).toString('base64url');
const status: ServiceStatus = { protocol: 1, identity: paths.identity, runId: newRunId(), pid: process.pid,
  phase: 'starting', release: runtimePeerRelease(repo), version: JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version, repo, node };
let next: ChildProcess | undefined;
let gateway: Http2GatewayHandle | undefined;
let certificate = '';
let token = '';
let privatePort = 0;
let publicPort = 0;
let expectedExit = false;
let startupDiagnostics = new StartupDiagnostics();
let releaseOwner: (() => void) | undefined;
let stopping: Promise<void> | undefined;
let updater: UpdateCoordinator;
const coordination = new ServiceControlCoordination(() => updater.status().busy);
const updateTick = () => roleChange || starting ? Promise.resolve() : coordination.tick(() => updater.tick());
const childRecord = path.join(paths.identity.work, 'service-child.json');
const awake = new ServiceAwake();
let worker: ServiceWorker | undefined;
let role = resolveServiceRole();
let roleChange: Promise<void> | undefined;
/** A Home served at the address it had before the service took it over keeps
 * plain HTTP on that port (docs/always-on-spec.md section 10.3). */
let scheme: 'http' | 'https' = 'https';
let backendHost = '127.0.0.1';
const restarts = new RestartTracker();
const hangLimitMs = Number(process.env.RI_SERVICE_HANG_MS) || HANG_LIMIT_MS;
const hang = new HangDetector(hangLimitMs);
let restartTimer: ReturnType<typeof setTimeout> | undefined;
let exitReason: string | undefined;
let plannedRestart: Promise<void> | undefined;
let urgentRestart = false;
let probing = false;
/** A start is in flight: the first one, from the moment this process begins,
 * or a retry. Nothing else may start, stop or restart the server meanwhile. */
let starting = true;
/** startHome finished, so the address and gateway are up and a retry only
 * needs a server. Until then, a retry repeats all of it. */
let homeServing = false;
let timersStarted = false;
let housekeepingStarted = false;

async function backendRequest<T>(route: string, timeout = 3000, body?: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${privatePort}${route}`, {
    method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'x-ri-service-control': process.env.RI_SERVICE_CONTROL_TOKEN!, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error('Backend readiness is unavailable');
  return response.json() as Promise<T>;
}
async function stopBackend() {
  await worker?.stop();
  if (!next) return;
  const child = next;
  expectedExit = true;
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 15_000);
    try { await exited; } finally { clearTimeout(force); }
  }
  next = undefined;
  fs.rmSync(childRecord, { force: true });
}
async function startBackend(target?: RuntimeTarget, validating?: string, deadlineMs = 180_000) {
  if (stopping) throw new Error('The service is stopping');
  if (target) { repo = canonical(target.repo); node = target.node; }
  process.env.RI_RUNTIME_REPO = repo;
  process.env.RI_DESKTOP_REPO = repo;
  process.env.RI_CLI_COMMAND = bundledCliCommand(node, repo, paths.identity.root, paths.identity);
  process.chdir(repo);
  expectedExit = false;
  const environment = serviceEnvironment(node);
  const secrets = [token, validating ?? '', ...Object.entries(environment).filter(([name]) => /KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTHORIZATION/i.test(name)).map(([, value]) => value ?? '')];
  startupDiagnostics = new StartupDiagnostics(secrets);
  const diagnostics = startupDiagnostics;
  next = startNextServer({ port: privatePort, repo, node, dev: process.env.RI_DESKTOP_MODE === 'development', hostname: backendHost, supervised: true,
    env: { ...environment, NODE_ENV: process.env.RI_DESKTOP_MODE === 'development' ? 'development' : 'production', RI_SERVICE_VALIDATING: validating ? '1' : '', RI_MAINTENANCE_TOKEN: validating ?? '' } });
  const child = next;
  if (child.pid) atomicWriteFile(childRecord, JSON.stringify({ pid: child.pid, runId: status.runId }));
  for (const input of [child.stdout, child.stderr]) if (input) createInterface({ input }).on('line', line => {
    const redacted = redactServiceLine(line, secrets);
    diagnostics.capture(redacted);
    console.info(redacted);
  });
  let launchError: Error | undefined;
  child.once('error', error => { launchError = error; diagnostics.capture(`Error: ${error.message}`); });
  child.once('exit', (code, signal) => {
    if (expectedExit || stopping || status.phase !== 'running' || next !== child) return;
    const reason = exitReason ?? diagnostics.brief(`The server exited (${signal ?? `exit ${code}`})`);
    exitReason = undefined;
    backendExited(reason);
  });
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (stopping) throw new Error('The service is stopping');
    if (launchError) throw diagnostics.failure('The local Next.js process could not start');
    if (child.exitCode !== null || child.signalCode !== null) throw diagnostics.failure(`Backend exited during startup (${child.signalCode ?? `exit ${child.exitCode}`})`);
    try {
      const ready = await backendRequest<{ ready: boolean; repo: string; validation: boolean }>('/__ri_ready');
      if (ready.ready && ready.repo === repo && ready.validation === !!validating) {
        status.repo = repo;
        status.node = node;
        status.version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
        status.release = runtimePeerRelease(repo);
        return;
      }
    } catch { /* retry while Next initializes */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw diagnostics.failure(`Backend did not become ready within ${Math.round(deadlineMs / 60_000)} minutes`);
}
function publish() {
  status.phase = 'running';
  status.since = new Date().toISOString();
  publishServerRuntime({ version: 1, runId: status.runId, launcherPid: process.pid, startedAt: status.since,
    mode: scheme, http2: scheme === 'https', publicBaseUrl: status.origin!, publicPort, privateUpstreams: { next: `http://127.0.0.1:${privatePort}` } });
}

/**
 * The server exited, or was stopped for not answering (docs/always-on-spec.md
 * section 6.2). The controller restarts it itself, after 1 s, 5 s, 15 s and
 * 60 s, then every 5 minutes, and a crash loop slows to every 15 minutes.
 * It never gives up, and the control socket stays up to say why.
 */
function backendExited(failure: string) {
  // Status shows one line. The service log keeps the rest.
  const reason = failure.split('\n').filter(line => !line.startsWith('Open the service log')).join(' ').slice(0, 600);
  next = undefined;
  fs.rmSync(childRecord, { force: true });
  const { delayMs, crashLoop } = restarts.failed();
  status.phase = 'restarting';
  status.error = reason;
  status.restarts = { count: (status.restarts?.count ?? 0) + 1, last: { at: new Date().toISOString(), reason }, crashLoop,
    nextAttemptAt: new Date(Date.now() + delayMs).toISOString() };
  console.warn(`[service] ${reason}. Restarting it in ${Math.round(delayMs / 1000)} s${crashLoop ? ', more slowly because it keeps crashing' : ''}.`);
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => void restartBackend(), delayMs);
}

/** Leave nothing half started, so the next try begins clean. A Home that was
 * serving keeps its gateway, which holds the address while the server is back. */
async function stopFailedStart() {
  await stopBackend().catch(() => {});
  if (homeServing) return;
  await awake.stop();
  await gateway?.close(1000).catch(() => {});
  gateway = undefined;
}

async function restartBackend() {
  restartTimer = undefined;
  if (stopping || next || starting || updater.status().phase === 'recovery-required') return;
  // An update attempt holds the backend for a moment. Try again after it, or
  // the Home would stay down until something else restarted it.
  if (updater.status().busy || coordination.handingOff || roleChange) { restartTimer = setTimeout(() => void restartBackend(), 5000); return; }
  starting = true;
  try {
    if (homeServing) {
      await startBackend();
      hang.reset();
      publish();
    } else await refreshRole(true);
    status.error = undefined;
    if (status.restarts) delete status.restarts.nextAttemptAt;
    console.info('[service] The server is back.');
  } catch (error) {
    await stopFailedStart();
    if (!stopping) backendExited(error instanceof Error ? error.message : 'The server failed to start');
  } finally { starting = false; }
}

/**
 * Every probe: should this Home have a server, and does it? This is what makes
 * "never gives up" true for every way a server can go away, including ones
 * nobody wrote a restart for. Only a recovery that needs a person holds it back.
 */
function superviseServer() {
  const update = updater.status();
  if (serverMissing({ serves: servesHome(role), running: !!next, stopping: !!stopping, unsafe: update.phase === 'recovery-required',
    busy: update.busy || coordination.handingOff || !!roleChange || !!plannedRestart, retrying: starting || restartTimer !== undefined })) {
    backendExited(status.error ?? 'The server was not running, so it was started');
  }
}

/** Stop the server and every process under it. A hung server ignores SIGTERM. */
async function killBackendTree(reason: string) {
  const child = next;
  if (!child?.pid) return;
  exitReason = reason;
  const pids = await ownedProcessIds(child.pid).catch(() => [] as number[]);
  for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
  child.kill('SIGKILL');
}

/** The exclusive lease, once the requests in flight have finished. */
async function activityLease() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { return exclusiveActivity(); } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  return undefined;
}

/** Restart on purpose: for memory, or because someone asked. Unless urgent,
 * it waits for the Home to be idle, then drains requests like an update does. */
function planRestart(reason: string, now: boolean) {
  if (now) urgentRestart = true;
  if (plannedRestart) return plannedRestart;
  plannedRestart = (async () => {
    try {
      while (!stopping && !urgentRestart) {
        if (updater.status().busy || coordination.handingOff) return;
        const reasons = await activity().catch(() => ['the server is unavailable']);
        if (!reasons.length) break;
        status.restartPending = { reason, waitingFor: reasons.join(', ') };
        await new Promise(resolve => setTimeout(resolve, 30_000));
      }
      if (stopping || !next || updater.status().busy || coordination.handingOff) return;
      const gate = { phase: 'draining' as const, token: randomBytes(32).toString('hex'), startedAt: new Date().toISOString() };
      writeMaintenance(gate);
      let lease: (() => void) | undefined;
      try {
        await backendRequest('/__ri_prepare', 30_000).catch(() => {});
        lease = await activityLease();
        writeMaintenance({ ...gate, phase: 'offline' });
        status.phase = 'restarting';
        status.restarts = { count: (status.restarts?.count ?? 0) + 1, last: { at: new Date().toISOString(), reason }, crashLoop: restarts.crashLooping };
        console.info(`[service] Restarting the server: ${reason}.`);
        await stopBackend();
      } finally { lease?.(); clearMaintenance(); }
      await startBackend();
      hang.reset();
      publish();
    } catch (error) {
      // The new server didn't come up: retry by the same schedule as a crash.
      await stopFailedStart();
      if (!stopping) backendExited(error instanceof Error ? error.message : 'The server failed to restart');
    } finally {
      plannedRestart = undefined;
      urgentRestart = false;
      delete status.restartPending;
    }
  })();
  return plannedRestart;
}

/** Every 15 s: is the server answering, and how much memory does it use?
 * One probe at a time: a frozen server makes each one wait its full timeout. */
async function probeBackend() {
  if (probing || !servesHome(role) || status.phase !== 'running' || !next || stopping || updater.status().busy || coordination.handingOff) return;
  probing = true;
  try {
    const ready = await backendRequest<{ ready: boolean; memory?: Memory }>('/__ri_ready', PROBE_TIMEOUT_MS);
    if (!ready.ready) throw new Error('Not ready');
    hang.answered();
    restarts.healthy();
    status.memory = ready.memory;
    const uptime = status.since ? Date.now() - Date.parse(status.since) : 0;
    // The grace and the idle line can be lowered for the lifecycle smoke, as the hang limit can.
    const action = memoryAction(ready.memory, uptime, process.env.RI_SERVICE_MEMORY_GRACE_MS ? Number(process.env.RI_SERVICE_MEMORY_GRACE_MS) : undefined,
      Number(process.env.RI_SERVICE_MEMORY_IDLE_SHARE) || undefined);
    if (action !== 'none' && ready.memory) {
      const share = Math.round(ready.memory.heapUsed / ready.memory.heapLimit * 100);
      void planRestart(`its memory reached ${share}% of Node's limit`, action === 'now');
    }
  } catch {
    if (!hang.hung() || !next) return;
    const limit = hangLimitMs >= 120_000 ? `${Math.round(hangLimitMs / 60_000)} minutes` : `${Math.round(hangLimitMs / 1000)} seconds`;
    console.warn(`[service] The server hasn't answered for ${limit}. Stopping it so it can restart.`);
    await killBackendTree('The server stopped answering, so it was restarted');
  } finally { probing = false; }
}
/** What a restart would cut off (docs/always-on-spec.md 7.2). Not every process
 * under the server: an idle agent resumes when its chat continues, and the agent
 * browser is meant to outlive the server. */
const count = (total: number, one: string) => total ? `${total} ${one}${total === 1 ? '' : 's'}` : '';
interface ServerActivity { executions: number; apps: number; background: number; permissions: number; terminals: number; previews: number; lastUseAt: number }
const serverActivity = () => backendRequest<ServerActivity>('/__ri_activity');
const workOf = (state: ServerActivity) => [count(state.executions, 'chat'), count(state.apps, 'app task'), count(state.background, 'background task'),
  count(state.permissions, 'pending permission'), count(state.terminals, 'busy terminal')].filter(Boolean);
async function activity() {
  if (!servesHome(role)) return worker ? worker.activity() : [];
  if (!next?.pid) return ['the server to come back'];
  return workOf(await serverActivity());
}
/** What the update rule reads (7.2). A person asking with `ri update` isn't held
 * up by a preview left open, but a Home updating by itself is. */
async function quiet() {
  if (!next?.pid) throw new Error('The server is not running');
  const state = await serverActivity();
  return { work: [...workOf(state), count(state.previews, 'open preview')].filter(Boolean), lastUseAt: state.lastUseAt };
}

const control = http.createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store');
  const reply = (body: object, code = 200) => { response.statusCode = code; response.end(JSON.stringify({ ...status, worker: worker?.status(), ...body })); };
  try {
    if (request.method === 'POST' && request.url === '/role/refresh') {
      if (starting || updater.status().busy || coordination.handingOff || roleChange) throw new Error('Wait for the current service action before refreshing this device.');
      if (['recovery-required', 'validating', 'checkpointing', 'draining'].includes(updater.status().phase)) throw new Error('Complete runtime recovery before changing this device connection.');
      if (next || gateway) throw new Error('Stop the local Ri before changing this device connection.');
      roleChange = refreshRole();
      try { await roleChange; } finally { roleChange = undefined; }
      return reply({});
    }
    if (request.method === 'POST' && ['/worker/stop', '/worker/resume'].includes(request.url ?? '')) {
      if (starting || updater.status().busy || coordination.handingOff || roleChange) throw new Error('Wait for the current service action before changing local execution.');
      if (!worker || role.role !== 'worker') throw new Error('This device does not run a connected worker.');
      if (request.url === '/worker/resume' && status.phase !== 'running') throw new Error('Complete runtime recovery before resuming local execution.');
      roleChange = request.url === '/worker/stop' ? worker.stop(true) : worker.resume();
      try { await roleChange; } finally { roleChange = undefined; }
      return reply({});
    }
    if (request.method === 'GET' && request.url === '/status') return reply({ update: updater?.status(), awake: awake.status() });
    if (request.method === 'GET' && request.url === '/awake') return reply({ awake: awake.status() });
    if (request.method === 'PATCH' && request.url === '/awake') {
      if (status.phase !== 'running' || coordination.handingOff || updater.status().busy) throw new Error('Wait until the background service is running before changing keep-awake preferences.');
      let bytes = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 4096) throw new Error('Control request too large'); chunks.push(chunk); }
      if (status.phase !== 'running' || coordination.handingOff || updater.status().busy) throw new Error('Wait until the background service is running before changing keep-awake preferences.');
      return reply({ awake: await awake.configure(JSON.parse(Buffer.concat(chunks).toString())) });
    }
    if (request.method === 'GET' && request.url === '/session' && status.phase === 'running' && servesHome(role) && !!status.origin) return reply({ certificate, token, desktopClient: process.env.RI_DESKTOP_CLIENT_SECRET });
    if (request.method === 'GET' && request.url === '/update') return reply({ update: updater.status() });
    if (request.method === 'GET' && request.url === '/update/rollback') return reply({ rollback: servesHome(role) && next ? updater.rollbackPreview() : updater.rollbackStatus() });
    if (request.method === 'PATCH' && request.url === '/update/policy') {
      if (coordination.handingOff || updater.status().busy) throw new Error('Wait for the current service action before changing update preferences.');
      let bytes = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 4096) throw new Error('Control request too large'); chunks.push(chunk); }
      if (coordination.handingOff || updater.status().busy) throw new Error('Wait for the current service action before changing update preferences.');
      const policy = updateReleasePreferences(JSON.parse(Buffer.concat(chunks).toString()));
      // Turned on, or the limit lifted: a release that was waiting needn't wait for the next check.
      if (policy.auto && !policy.metered) setImmediate(() => void checkForRelease());
      return reply({ policy });
    }
    if (request.method === 'POST' && request.url === '/update') {
      if (roleChange || ['first-run', 'retired', 'conflict'].includes(role.role)) throw new Error('Complete device setup before updating this installation.');
      await coordination.dispatchUpdate(request, body => {
        if (body.action === 'check' || body.action === 'download') {
          const promise = body.action === 'check' ? updater.check() : updater.download();
          void promise.catch(error => console.error('[update]', error instanceof Error ? error.message : 'Failed'));
        } else if (body.action === 'apply' || body.action === 'when-idle' || body.action === 'apply-now') {
          updater.approve(body.window, body.action === 'apply-now', body.action !== 'when-idle');
          if (body.action !== 'when-idle') setImmediate(() => void updateTick());
        } else if (body.action === 'later') updater.later();
        else if (body.action === 'offer') return updater.offer(body.release!, body.local).then(update => reply({ update }));
        else if (body.action === 'rollback') {
          if (!servesHome(role)) throw new Error('Only a Home can roll back.');
          const state = updater.rollbackStatus();
          if (!state.available) throw new Error(state.reason);
          setImmediate(() => void updater.rollback().catch(error => console.error('[update] Rollback failed:', error instanceof Error ? error.message : 'Failed')));
        }
        return reply({ update: updater.status() });
      });
      return;
    }
    if (request.method === 'POST' && request.url === '/recover') {
      if (status.phase !== 'failed' || next || updater.status().busy || coordination.handingOff) throw new Error('Recovery is only available while the backend is stopped');
      await updater.recover(true);
      // Under the launcher, 75 brings the Home straight back on the right release.
      reply({ phase: 'stopping' }); setImmediate(() => void shutdown(process.env.RI_SERVICE_LAUNCHER === '2' ? 75 : 0)); return;
    }
    if (request.method === 'POST' && request.url === '/handoff') {
      await coordination.handoff(async () => {
        let release: (() => void) | undefined;
        try {
          if (roleChange || starting) throw new Error('Wait for device setup to finish before installing login supervision.');
          await worker?.prepareIdle();
          const reasons = await activity();
          if (reasons.length) throw new Error(`Finish or close active work before installing login supervision: ${reasons.join(', ')}`);
          writeMaintenance({ phase: 'draining', token: randomBytes(32).toString('hex'), startedAt: new Date().toISOString() });
          await new Promise(resolve => setTimeout(resolve, 2000));
          const pending = await activity();
          if (pending.length) throw new Error(`Active work is still running: ${pending.join(', ')}`);
          release = await activityLease();
          if (!release) throw new Error('Requests are still running. Try again in a moment.');
          await stopBackend();
          clearMaintenance();
          reply({ phase: 'stopping' });
          setImmediate(() => void shutdown());
        } finally { clearMaintenance(); release?.(); if (!stopping) await worker?.resumeAdmission(); }
      });
      return;
    }
    if (request.method === 'POST' && request.url === '/restart') {
      if (!servesHome(role)) throw new Error('This computer runs no Home to restart.');
      let bytes = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 1024) throw new Error('Control request too large'); chunks.push(chunk); }
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as { now?: boolean } : {};
      if (updater.status().phase === 'recovery-required') throw new Error('This Home needs its recovery finished first. See `ri update recover`.');
      // A start already under way is the restart asked for.
      if (starting) return reply({});
      // A Home waiting for its next retry tries now instead.
      if (!next) { clearTimeout(restartTimer); void restartBackend(); return reply({}); }
      void planRestart('restarted on request', body.now === true);
      return reply({});
    }
    if (request.method === 'POST' && request.url === '/stop') {
      if (updater?.status().busy || coordination.handingOff || roleChange) return reply({ error: 'A service action is in progress. Wait before stopping the service.' }, 409);
      reply({ phase: 'stopping' }); void shutdown(); return;
    }
    reply({ error: 'Control action unavailable' }, 404);
  } catch (error) { reply({ error: error instanceof Error ? error.message : 'Control action failed' }, 400); }
});
control.requestTimeout = 5000; control.headersTimeout = 5000;

async function shutdown(code = 0) {
  if (stopping) return stopping;
  stopping = (async () => {
    status.phase = 'stopping';
    clearTimeout(restartTimer);
    await awake.stop();
    await worker?.dispose();
    await stopRuntimeJobs();
    await gateway?.close(1000).catch(() => {});
    await stopBackend();
    clearServerRuntimeIfOwned(status.runId);
    control.close(); control.closeAllConnections(); releaseOwner?.(); process.exit(code);
  })();
  return stopping;
}

/** Let the selected release's own controller take over. */
async function handOver() {
  // The stable launcher starts the selected release on exit 75 itself, OS job or not.
  if (process.env.RI_SERVICE_LAUNCHER === '2' || hasLoginSupervision()) { setImmediate(() => void shutdown(75)); return; }
  // Unsupervised: the relay starts the release just selected, which a
  // rollback never validated, so `repo` can still be this controller's.
  const selected = installedRuntime() ?? { node, repo };
  const relay = spawn(process.execPath, [path.join(process.env.RI_RUNTIME_REPO!, 'dist/service/handoff.cjs'), String(process.pid), selected.node, selected.repo], {
    cwd: repo, detached: true, stdio: 'ignore', env: { ...process.env, RI_SERVICE_VALIDATING: '', RI_MAINTENANCE_TOKEN: '' },
  });
  await new Promise<void>((resolve, reject) => { relay.once('spawn', resolve); relay.once('error', reject); });
  relay.unref(); setImmediate(() => void shutdown());
}

/**
 * Whether this controller's storage is a Home's. Recovery asks the record it
 * is working from, not the folder: a restore moves the database aside for a
 * moment, and a crash right then makes a Home look like a new installation.
 */
function homeStorage() {
  const record = updater?.status();
  return servesHome(role) || !!record?.rollback || (!!record?.checkpoint && isHomeSnapshot(record.checkpoint));
}

async function start() {
  // Stopped by its owner: the OS started it at login or boot. Stay down (6.4).
  const stopped = readStopped();
  if (stopped) { console.info(`[service] Stopped by its owner at ${stopped.at}. Run \`ri start\` to start it again.`); process.exit(0); }
  releaseOwner = acquireServiceOwner();
  writeHomeRecord();
  await initializeRuntimeJobs();
  if (readLiveServerRuntime()) throw new Error('An existing launcher is using this data root. Stop it before enabling the service.');
  if (fs.existsSync(childRecord)) {
    const child = JSON.parse(fs.readFileSync(childRecord, 'utf8')) as { pid: number };
    const deadline = Date.now() + 50_000;
    while (isProcessAlive(child.pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
    if (isProcessAlive(child.pid)) throw new Error('The previous backend process is still alive. Inspect it before restarting.');
  }
  updater = new UpdateCoordinator({ activity,
    work: async () => servesHome(role) ? activity() : await worker?.work() ?? [],
    get quiet() { return servesHome(role) ? quiet : undefined; },
    get storage() { return homeStorage() ? 'home' as const : 'worker' as const; },
    exclusiveStorage: async () => (await acquireWorkerLock()).release,
    assertNoLegacyWriters: () => homeStorage() ? assertNoLegacyWriters() : Promise.resolve(assertWorkerStorage()),
    compatibility: async target => servesHome(role)
      ? (await backendRequest<{ reasons: string[] }>('/__ri_compatibility', 30_000, { repo: target.repo })).reasons
      : workerUpdateCompatibility(target.repo),
    verify: directory => runtimeJob(controllerRepo, 'verify', directory),
    download: (release, progress) => runtimeJob(controllerRepo, 'download', release, progress),
    checkpoint: request => servesHome(role)
      ? runtimeJob(controllerRepo, 'checkpoint', { from: request.from, to: request.to })
      : runtimeJob(controllerRepo, 'worker-checkpoint', request.recovery),
    restore: directory => runtimeJob(controllerRepo, homeStorage() ? 'restore' : 'worker-checkpoint-verify', directory),
    verifyDatabase: target => servesHome(role) ? runtimeJob(target.repo, 'validate-database', paths.identity.database, undefined, target.node) : Promise.resolve(assertWorkerStorage()),
    prepareIdle: async () => { if (servesHome(role)) await backendRequest('/__ri_prepare', 30_000); else await worker?.prepareIdle(); },
    resumeAdmission: async () => { if (!stopping) { if (servesHome(role)) await backendRequest('/__ri_resume', 30_000); else await worker?.resumeAdmission(); } },
    stop: async () => { status.phase = 'updating'; await stopBackend(); },
    validate: async (target, secret, migrations = 0) => {
      // A start that migrates gets longer: minutes on a 20 GiB database (6.2).
      if (servesHome(role)) return startBackend(target, secret, migrations > 0 ? 30 * 60_000 : undefined);
      await validateWorkerRuntime(target);
      repo = canonical(target.repo); node = target.node; process.env.RI_RUNTIME_REPO = repo;
    },
    activate: async () => {
      // A new controller must load its own Node ABI and implementation before
      // the service accepts work. Validation boot has not started effects.
      await stopBackend();
      await handOver();
    },
    restart: async target => {
      try {
        if (servesHome(role)) { await startBackend(target); publish(); }
        else { repo = target.repo; node = target.node; process.env.RI_RUNTIME_REPO = repo; await refreshRole(true); }
      }
      catch (error) { await stopBackend(); throw error; }
    },
    unavailable: error => { status.phase = 'failed'; status.error = error; },
  });
  if (fs.existsSync(paths.socket)) {
    if (!fs.lstatSync(paths.socket).isSocket()) throw new Error('The service socket path is occupied by another file');
    fs.unlinkSync(paths.socket);
  }
  await new Promise<void>((resolve, reject) => { control.once('error', reject); control.listen(paths.socket, resolve); });
  fs.chmodSync(paths.socket, 0o600);
  // Keep the private recovery/status surface alive without a crash loop.
  try { await updater.recover(); }
  catch (error) {
    starting = false;
    status.phase = 'failed'; status.error = error instanceof Error ? error.message : 'Recovery required';
    console.error(`[service] Recovery needs attention: ${status.error}`);
    return;
  }
  const installed = installedRuntime();
  // A release runs under its own controller, whether recovery just selected it
  // or this one was started from somewhere else.
  if (installed && canonical(installed.repo) !== controllerRepo) {
    console.info(`[service] This Home runs release ${installed.id.slice(0, 12)}. Handing over to its controller.`);
    await handOver();
    return;
  }
  if (installed) { repo = installed.repo; node = installed.node; process.env.RI_RUNTIME_REPO = repo; process.env.NEXT_DIST_DIR = '.next-desktop'; process.chdir(repo); }
  await refreshRole();
  starting = false;
  startTimers();
}

/** A connected computer follows its Home's version (docs/always-on-spec.md 7.7),
 * whatever the automatic updates switch says, as soon as its own chats finish. */
let workerHome: HomeRelease = {};
let following = false;
/** After a failure, heartbeats keep coming every 20 seconds. Not a retry every 20 seconds. */
let followAfter = 0;
async function followHome() {
  if (following || Date.now() < followAfter || role.role !== 'worker' || starting || roleChange || coordination.handingOff || updater.status().busy) return;
  if (readOrigin().source !== 'published' || !releasePolicy()) return;
  const own = runtimePeerRelease(controllerRepo);
  following = true;
  try {
    const next = workerHome.next?.compatibility;
    const index = next && !negotiateWorker(next, own.compatibility).compatible ? await checkReleaseIndex() : [];
    const target = followTarget({ own, home: workerHome, index });
    if (!target) return;
    if (updater.status().release?.version !== target.version || updater.status().phase === 'idle') await updater.checkVersion(target.version);
    if (updater.status().rejected === updater.status().release?.runtime.id) return;
    if (['available', 'failed'].includes(updater.status().phase)) {
      // It may fail again further on, without throwing here. Not every 20 seconds.
      if (updater.status().phase === 'failed') followAfter = Date.now() + 5 * 60_000;
      await updater.download();
    }
    if (updater.status().phase === 'ready') { updater.approveAutomatically(); void updateTick(); }
  } catch (error) {
    followAfter = Date.now() + 5 * 60_000;
    console.warn('[update] Following the Home failed:', error instanceof Error ? error.message : 'Failed');
  }
  finally { following = false; }
}

async function refreshRole(force = false) {
  const selected = resolveServiceRole();
  if (!force && worker && selected.role === 'worker' && worker.matchesEnrollment()) {
    role = selected; status.role = selected.role; status.home = selected.home; return;
  }
  if (worker && !force) {
    const reasons = await worker.activity();
    if (reasons.length) throw new Error(`Stop local execution before changing this device: ${reasons.join(', ')}`);
  }
  status.phase = 'starting';
  await awake.stop();
  await worker?.dispose(); worker = undefined;
  role = selected;
  status.role = role.role; status.home = 'home' in role ? role.home : null;
  status.error = undefined;
  status.repo = repo; status.node = node;
  status.version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
  status.release = runtimePeerRelease(repo);
  if (!servesHome(role)) {
    delete status.origin;
    clearActivation();
    if (role.role === 'worker') {
      worker = new ServiceWorker({ repo, node, onHome: home => { workerHome = { ...workerHome, ...home }; void followHome(); }, onChild: pid => {
        if (pid) atomicWriteFile(childRecord, JSON.stringify({ pid, runId: status.runId, role: 'worker' }));
        else fs.rmSync(childRecord, { force: true });
      } });
      await worker.start();
    }
    if (role.role === 'retired' || role.role === 'conflict') { status.phase = 'failed'; status.error = describeServiceRole(role) ?? 'Resolve the device role before starting.'; }
    else status.phase = 'running';
    if (role.role === 'worker') await awake.start();
    return;
  }
  await startHome();
  role = resolveServiceRole(); status.role = role.role;
}

async function startHome() {
  homeServing = false;
  let saved: { version: number; port: number; privatePort?: number; scheme?: 'http' | 'https'; host?: string };
  if (fs.existsSync(paths.settings)) saved = JSON.parse(fs.readFileSync(paths.settings, 'utf8'));
  else saved = { version: 1, port: await getPort({ host: '127.0.0.1', port: 42242 }) };
  if (saved.version !== 1 || !Number.isInteger(saved.port) || saved.port < 1024 || saved.port > 65535) throw new Error('Invalid local service endpoint configuration');
  if (saved.scheme !== undefined && saved.scheme !== 'http' && saved.scheme !== 'https') throw new Error('Invalid local service endpoint configuration');
  scheme = saved.scheme ?? 'https';
  if (scheme === 'http') {
    // The address the Home had before the service took it over: plain HTTP,
    // served by the server itself on that port, as `ri start` always did.
    backendHost = saved.host === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
    publicPort = saved.port; privatePort = saved.port;
    status.origin = `http://localhost:${publicPort}`;
    certificate = '';
    atomicWriteFile(paths.settings, JSON.stringify(saved));
  } else {
    if (!saved.privatePort) saved.privatePort = await getPort({ host: '127.0.0.1', port: 42243, exclude: [saved.port] });
    if (!Number.isInteger(saved.privatePort) || saved.privatePort < 1024 || saved.privatePort > 65535 || saved.privatePort === saved.port) throw new Error('Invalid private service endpoint configuration');
    atomicWriteFile(paths.settings, JSON.stringify(saved));
    publicPort = saved.port; privatePort = saved.privatePort;
    status.origin = `https://localhost:${publicPort}`;
    const tls = await ensureGeneratedTls(); certificate = tls.cert;
    gateway = await startHttp2Gateway({ publicPort, publicBaseUrl: status.origin, upstreamHost: '127.0.0.1', upstreamPort: privatePort, tls });
  }
  process.env[PUBLIC_BASE_URL_ENV] = status.origin; process.env.PORT = String(privatePort);
  // Consume the first-install permit before any database opener. A later lost
  // database must never be mistaken for an installation that has not begun.
  consumeDesktopInitialization();
  // Opening the database below applies its migrations. An update has already
  // taken its snapshot, so there are none left by now. This is an existing
  // Home moving to a release for the first time: copy it before it changes.
  const installed = installedRuntime();
  const pending = installed ? await pendingMigrations(installed) : 0;
  if (installed && pending > 0) {
    const copy = await runtimeJob(controllerRepo, 'checkpoint', { from: installed.id, to: installed.id });
    console.info(`[service] This Home's database has ${pending} migration${pending === 1 ? '' : 's'} to apply. A copy from before them is in ${copy}.`);
  }
  const { allowMigrations } = await import('@/lib/db/migrate');
  const { ensureLocalToken } = await import('@/lib/auth/bootstrap');
  const { resetDb } = await import('@/lib/db');
  // This controller holds the Home's owner lock and opens its database before
  // the backend starts. A migration grant in the spawning CLI cannot reach it.
  allowMigrations();
  try {
    token = ensureLocalToken().plaintext;
  } finally {
    allowMigrations(false);
    resetDb();
  }
  if (stopping) return;
  // The first moment anything outside the database can happen. A candidate
  // release that fails before this is put back by its launcher (section 7.4).
  clearActivation();
  await startBackend();
  hang.reset();
  if (gateway) {
    const probe = await gateway.probe();
    if (!probe.ok) throw startupDiagnostics.readinessFailure(probe);
  }
  publish(); console.info(`[service] Ready at ${status.origin}`);
  homeServing = true;
  await awake.start();
  scheduleHousekeeping();
}

/** A minute after the Home is up: delete releases and snapshots nothing uses. */
function scheduleHousekeeping() {
  if (housekeepingStarted) return;
  housekeepingStarted = true;
  const run = () => {
    try { pruneReleases(); } catch (error) { console.warn('[service] Release cleanup skipped:', error instanceof Error ? error.message : 'Failed'); }
    void emptyTrash().catch(error => console.warn('[service] Removing old releases failed:', error instanceof Error ? error.message : 'Failed'));
    try {
      const keep = snapshotsInUse(updater.status(), readActivation());
      const database = paths.identity.database;
      const size = fs.existsSync(database) ? fs.statSync(database).size : 0;
      pruneSnapshots({ keep, lowDiskBytes: Math.max(20 * 1024 ** 3, size) });
    } catch (error) { console.warn('[service] Snapshot cleanup skipped:', error instanceof Error ? error.message : 'Failed'); }
  };
  const first = setTimeout(run, 60_000); first.unref();
  const daily = setInterval(run, 24 * 60 * 60_000); daily.unref();
}

function startTimers() {
  if (timersStarted) return;
  timersStarted = true;
  const renewal = setInterval(() => {
    if (!servesHome(role) || scheme !== 'https' || updater.status().busy || coordination.handingOff) return;
    void ensureGeneratedTls().then(tls => {
      if (tls.cert !== certificate) { gateway?.rotate(tls); certificate = tls.cert; }
    }).catch(() => console.warn('[service] Certificate renewal failed. Check disk permissions and TLS diagnostics.'));
  }, 6 * 60 * 60_000);
  renewal.unref();
  const logRotation = setInterval(() => {
    if (updater.status().busy) return;
    try { rotateServiceLog(paths.log); } catch { /* read-only diagnostics must not stop the service */ }
  }, 30_000);
  logRotation.unref();
  const tick = setInterval(() => void updateTick(), 30_000); tick.unref();
  // A timer that throws would take the controller down, the one thing that must stay up.
  const probe = setInterval(() => {
    try { superviseServer(); } catch (error) { console.warn('[service] Supervision check failed:', error instanceof Error ? error.message : 'Failed'); }
    void probeBackend().catch(error => console.warn('[service] Probe failed:', error instanceof Error ? error.message : 'Failed'));
  }, Number(process.env.RI_SERVICE_PROBE_MS) || PROBE_INTERVAL_MS); probe.unref();
  // Automatic updates (docs/always-on-spec.md 7.1 and 7.2). A release downloads
  // in the background, then the rule decides when it takes effect. Metered mode
  // holds the download, and an explicit Download stays available.
  const firstCheckMs = Number(process.env.RI_UPDATE_FIRST_CHECK_MS) || 60_000 + Math.random() * 60_000;
  const initial = setTimeout(() => void checkForRelease(), firstCheckMs); initial.unref();
  const checks = setInterval(() => void checkForRelease(), Number(process.env.RI_UPDATE_CHECK_MS) || (6 + Math.random()) * 60 * 60_000); checks.unref();
}

async function checkForRelease() {
  if (role.role === 'worker') { await followHome(); return; }
  const policy = releasePolicy();
  // A Home with no release to move from is a source checkout under development.
  if (!policy || !installedRuntime() || readOrigin().source !== 'published' || updater.status().busy || coordination.handingOff || roleChange || ['first-run', 'retired', 'conflict'].includes(role.role)) return;
  try {
    await updater.check(true);
    const held = () => coordination.handingOff || !policy.auto || updater.status().rejected === updater.status().release?.runtime.id;
    // A download that failed gets another go. A release that failed here doesn't.
    if (!held() && !policy.metered && ['available', 'failed'].includes(updater.status().phase)) await updater.download();
    if (!held() && updater.status().phase === 'ready') { updater.approveAutomatically(); void updateTick(); }
  } catch (error) { console.warn('[update] Automatic check unavailable:', error instanceof Error ? error.message : 'Offline'); }
}
process.once('SIGTERM', () => void shutdown()); process.once('SIGINT', () => void shutdown());
void start().catch(async error => {
  console.error('[service]', error instanceof Error ? error.message : 'Startup failed');
  status.phase = 'failed'; status.error = error instanceof Error ? error.message : 'Startup failed';
  if (!control.listening) { releaseOwner?.(); process.exit(1); }
  // A new release that fails before it starts work exits, so its launcher can
  // try once more and then put the previous release back (section 7.4).
  let own: string | undefined;
  try { own = installedRuntime()?.id; } catch { /* an unreadable selection is not a candidate */ }
  if (activationPending(own)) {
    await stopBackend();
    await gateway?.close(1000).catch(() => {});
    control.close(); control.closeAllConnections(); releaseOwner?.(); process.exit(1);
  }
  // Anything else is retried by the same schedule as a crash, with the control
  // socket up to say why. A restart loop through the OS would hide the reason,
  // and restoring data written after an upgrade is never the answer.
  await stopFailedStart();
  starting = false;
  if (stopping) return;
  backendExited(status.error);
  startTimers();
});
