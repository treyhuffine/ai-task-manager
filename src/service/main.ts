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
import { UpdateCoordinator, type RuntimeTarget } from '@/lib/service/update';
import { assertNoLegacyWriters, ownedProcesses } from '@/lib/service/processes';
import { hasLoginSupervision } from '@/lib/service/install';
import { installedRuntime } from '@/lib/service/runtime';
import { writeMaintenance, clearMaintenance, exclusiveActivity } from '@/lib/service/maintenance';
import { releasePolicy } from '@/lib/service/release';
import { updateReleasePreferences } from '@/lib/service/release-trust';
import { ServiceControlCoordination } from '@/lib/service/control-coordination';
import { consumeDesktopInitialization } from '@/lib/service/initialization';
import { redactServiceLine, rotateServiceLog } from '@/lib/service/logging';
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
let releaseOwner: (() => void) | undefined;
let stopping: Promise<void> | undefined;
let updater: UpdateCoordinator;
const coordination = new ServiceControlCoordination(() => updater.status().busy);
const updateTick = () => roleChange ? Promise.resolve() : coordination.tick(() => updater.tick());
const childRecord = path.join(paths.identity.work, 'service-child.json');
const awake = new ServiceAwake();
let worker: ServiceWorker | undefined;
let role = resolveServiceRole();
let roleChange: Promise<void> | undefined;

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
async function startBackend(target?: RuntimeTarget, validating?: string) {
  if (stopping) throw new Error('The service is stopping');
  if (target) { repo = canonical(target.repo); node = target.node; }
  process.env.RI_RUNTIME_REPO = repo;
  process.env.RI_DESKTOP_REPO = repo;
  process.env.RI_CLI_COMMAND = bundledCliCommand(node, repo, paths.identity.root, paths.identity);
  process.chdir(repo);
  expectedExit = false;
  const environment = serviceEnvironment(node);
  const secrets = [token, ...Object.entries(environment).filter(([name]) => /KEY|TOKEN|SECRET/.test(name)).map(([, value]) => value ?? '')];
  next = startNextServer({ port: privatePort, repo, node, dev: process.env.RI_DESKTOP_MODE === 'development', hostname: '127.0.0.1', supervised: true,
    env: { ...environment, NODE_ENV: process.env.RI_DESKTOP_MODE === 'development' ? 'development' : 'production', RI_SERVICE_VALIDATING: validating ? '1' : '', RI_MAINTENANCE_TOKEN: validating ?? '' } });
  const child = next;
  if (child.pid) atomicWriteFile(childRecord, JSON.stringify({ pid: child.pid, runId: status.runId }));
  for (const input of [child.stdout, child.stderr]) if (input) createInterface({ input }).on('line', line => console.info(redactServiceLine(line, secrets)));
  child.once('error', error => { status.error = error.message; });
  child.once('exit', () => {
    if (!expectedExit && !stopping && status.phase === 'running') { status.error = 'Backend exited'; void shutdown(1); }
  });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (stopping || child.exitCode !== null || child.signalCode !== null) throw new Error('Backend exited during startup');
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
  throw new Error('Backend did not become ready within three minutes');
}
function publish() {
  status.phase = 'running';
  publishServerRuntime({ version: 1, runId: status.runId, launcherPid: process.pid, startedAt: new Date().toISOString(),
    mode: 'https', http2: true, publicBaseUrl: status.origin!, publicPort, privateUpstreams: { next: `http://127.0.0.1:${privatePort}` } });
}
async function activity() {
  if (!servesHome(role)) return worker ? worker.activity() : [];
  if (!next?.pid) return ['Backend is unavailable'];
  const [state, children] = await Promise.all([
    backendRequest<{ executions: number; background: number; permissions: number }>('/__ri_activity'), ownedProcesses(next.pid),
  ]);
  return [state.executions && `${state.executions} executions`, state.background && `${state.background} background tasks`,
    state.permissions && `${state.permissions} pending permissions`, children.length && `${children.length} owned processes (${[...new Set(children)].join(', ')})`].filter(Boolean) as string[];
}

const control = http.createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store');
  const reply = (body: object, code = 200) => { response.statusCode = code; response.end(JSON.stringify({ ...status, worker: worker?.status(), ...body })); };
  try {
    if (request.method === 'POST' && request.url === '/role/refresh') {
      if (updater.status().busy || coordination.handingOff || roleChange) throw new Error('Wait for the current service action before refreshing this device.');
      if (['recovery-required', 'validating', 'checkpointing', 'draining'].includes(updater.status().phase)) throw new Error('Complete runtime recovery before changing this device connection.');
      if (next || gateway) throw new Error('Stop the local Home before changing this device connection.');
      roleChange = refreshRole();
      try { await roleChange; } finally { roleChange = undefined; }
      return reply({});
    }
    if (request.method === 'POST' && ['/worker/stop', '/worker/resume'].includes(request.url ?? '')) {
      if (updater.status().busy || coordination.handingOff || roleChange) throw new Error('Wait for the current service action before changing local execution.');
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
    if (request.method === 'PATCH' && request.url === '/update/policy') {
      if (coordination.handingOff || updater.status().busy) throw new Error('Wait for the current service action before changing update preferences.');
      let bytes = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 4096) throw new Error('Control request too large'); chunks.push(chunk); }
      if (coordination.handingOff || updater.status().busy) throw new Error('Wait for the current service action before changing update preferences.');
      return reply({ policy: updateReleasePreferences(JSON.parse(Buffer.concat(chunks).toString())) });
    }
    if (request.method === 'POST' && request.url === '/update') {
      if (roleChange || ['first-run', 'retired', 'conflict'].includes(role.role)) throw new Error('Complete device setup before updating this installation.');
      await coordination.dispatchUpdate(request, body => {
        if (body.action === 'check' || body.action === 'download') {
          const promise = body.action === 'check' ? updater.check() : updater.download();
          void promise.catch(error => console.error('[update]', error instanceof Error ? error.message : 'Failed'));
        } else if (body.action === 'apply' || body.action === 'when-idle') {
          updater.approve(body.window);
          if (body.action === 'apply') setImmediate(() => void updateTick());
        } else if (body.action === 'later') updater.later();
        return reply({ update: updater.status() });
      });
      return;
    }
    if (request.method === 'POST' && request.url === '/recover') {
      if (status.phase !== 'failed' || next || updater.status().busy || coordination.handingOff) throw new Error('Recovery is only available while the backend is stopped');
      await updater.recover(true);
      reply({ phase: 'stopping' }); setImmediate(() => void shutdown()); return;
    }
    if (request.method === 'POST' && request.url === '/handoff') {
      await coordination.handoff(async () => {
        let release: (() => void) | undefined;
        try {
          if (roleChange) throw new Error('Wait for device setup to finish before installing login supervision.');
          await worker?.prepareIdle();
          const reasons = await activity();
          if (reasons.length) throw new Error(`Finish or close active work before installing login supervision: ${reasons.join(', ')}`);
          writeMaintenance({ phase: 'draining', token: randomBytes(32).toString('hex'), startedAt: new Date().toISOString() });
          await new Promise(resolve => setTimeout(resolve, 2000));
          const pending = await activity();
          if (pending.length) throw new Error(`Active work is still running: ${pending.join(', ')}`);
          release = exclusiveActivity();
          await stopBackend();
          clearMaintenance();
          reply({ phase: 'stopping' });
          setImmediate(() => void shutdown());
        } finally { clearMaintenance(); release?.(); if (!stopping) await worker?.resumeAdmission(); }
      });
      return;
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

async function start() {
  releaseOwner = acquireServiceOwner();
  await initializeRuntimeJobs();
  if (readLiveServerRuntime()) throw new Error('An existing launcher is using this data root. Stop it before enabling the service.');
  if (fs.existsSync(childRecord)) {
    const child = JSON.parse(fs.readFileSync(childRecord, 'utf8')) as { pid: number };
    const deadline = Date.now() + 50_000;
    while (isProcessAlive(child.pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
    if (isProcessAlive(child.pid)) throw new Error('The previous backend process is still alive. Inspect it before restarting.');
  }
  updater = new UpdateCoordinator({ activity,
    get storage() { return servesHome(role) ? 'home' as const : 'worker' as const; },
    exclusiveStorage: async () => (await acquireWorkerLock()).release,
    assertNoLegacyWriters: () => servesHome(role) ? assertNoLegacyWriters() : Promise.resolve(assertWorkerStorage()),
    compatibility: async target => servesHome(role)
      ? (await backendRequest<{ reasons: string[] }>('/__ri_compatibility', 30_000, { repo: target.repo })).reasons
      : workerUpdateCompatibility(target.repo),
    verify: directory => runtimeJob(controllerRepo, 'verify', directory),
    download: (release, progress) => runtimeJob(controllerRepo, 'download', release, progress),
    checkpoint: directory => runtimeJob(controllerRepo, servesHome(role) ? 'checkpoint' : 'worker-checkpoint', directory),
    restore: directory => runtimeJob(controllerRepo, servesHome(role) ? 'restore' : 'worker-checkpoint-verify', directory),
    verifyDatabase: target => servesHome(role) ? runtimeJob(target.repo, 'validate-database', paths.identity.database, undefined, target.node) : Promise.resolve(assertWorkerStorage()),
    prepareIdle: async () => { if (servesHome(role)) await backendRequest('/__ri_prepare', 30_000); else await worker?.prepareIdle(); },
    resumeAdmission: async () => { if (!stopping) await worker?.resumeAdmission(); },
    stop: async () => { status.phase = 'updating'; await stopBackend(); },
    validate: async (target, secret) => {
      if (servesHome(role)) return startBackend(target, secret);
      await validateWorkerRuntime(target);
      repo = canonical(target.repo); node = target.node; process.env.RI_RUNTIME_REPO = repo;
    },
    activate: async () => {
      // A new controller must load its own Node ABI and implementation before
      // the service accepts work. Validation boot has not started effects.
      await stopBackend();
      if (hasLoginSupervision()) { setImmediate(() => void shutdown(75)); return; }
      const relay = spawn(process.execPath, [path.join(process.env.RI_RUNTIME_REPO!, 'dist/service/handoff.cjs'), String(process.pid), node, repo], {
        cwd: repo, detached: true, stdio: 'ignore', env: { ...process.env, RI_SERVICE_VALIDATING: '', RI_MAINTENANCE_TOKEN: '' },
      });
      await new Promise<void>((resolve, reject) => { relay.once('spawn', resolve); relay.once('error', reject); });
      relay.unref(); setImmediate(() => void shutdown());
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
  catch (error) { status.phase = 'failed'; status.error = error instanceof Error ? error.message : 'Recovery required'; return; }
  const installed = installedRuntime();
  if (installed) { repo = installed.repo; node = installed.node; process.env.RI_RUNTIME_REPO = repo; process.env.NEXT_DIST_DIR = '.next-desktop'; process.chdir(repo); }
  await refreshRole();
  startTimers();
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
    if (role.role === 'worker') {
      worker = new ServiceWorker({ repo, node, onChild: pid => {
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
  let saved: { version: number; port: number; privatePort?: number };
  if (fs.existsSync(paths.settings)) saved = JSON.parse(fs.readFileSync(paths.settings, 'utf8'));
  else saved = { version: 1, port: await getPort({ host: '127.0.0.1', port: 42242 }) };
  if (saved.version !== 1 || !Number.isInteger(saved.port) || saved.port < 1024 || saved.port > 65535) throw new Error('Invalid local service endpoint configuration');
  if (!saved.privatePort) saved.privatePort = await getPort({ host: '127.0.0.1', port: 42243, exclude: [saved.port] });
  if (!Number.isInteger(saved.privatePort) || saved.privatePort < 1024 || saved.privatePort > 65535 || saved.privatePort === saved.port) throw new Error('Invalid private service endpoint configuration');
  atomicWriteFile(paths.settings, JSON.stringify(saved));
  publicPort = saved.port; privatePort = saved.privatePort;
  status.origin = `https://localhost:${publicPort}`;
  const tls = await ensureGeneratedTls(); certificate = tls.cert;
  gateway = await startHttp2Gateway({ publicPort, publicBaseUrl: status.origin, upstreamHost: '127.0.0.1', upstreamPort: privatePort, tls });
  process.env[PUBLIC_BASE_URL_ENV] = status.origin; process.env.PORT = String(privatePort);
  // Consume the first-install permit before any database opener. A later lost
  // database must never be mistaken for an installation that has not begun.
  consumeDesktopInitialization();
  const { ensureLocalToken } = await import('@/lib/auth/bootstrap');
  const { resetDb } = await import('@/lib/db');
  token = ensureLocalToken().plaintext; resetDb();
  if (stopping) return;
  await startBackend();
  const probe = await gateway.probe();
  if (!probe.ok) throw new Error(`HTTP/2 readiness failed: ${probe.detail ?? probe.status}`);
  publish(); console.info(`[service] Ready at ${status.origin}`);
  await awake.start();
}

function startTimers() {
  const renewal = setInterval(() => {
    if (!servesHome(role) || updater.status().busy || coordination.handingOff) return;
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
  // Checking/downloading never approves activation. Metered mode suppresses
  // automatic downloads, while an explicit Download remains available.
  const check = async () => {
    const policy = releasePolicy(); if (!policy || updater.status().busy || coordination.handingOff || roleChange || ['first-run', 'retired', 'conflict'].includes(role.role)) return;
    try {
      await updater.check();
      if (!coordination.handingOff && policy.automaticDownload && !policy.metered && updater.status().phase === 'available') await updater.download();
    } catch (error) { console.warn('[update] Automatic check unavailable:', error instanceof Error ? error.message : 'Offline'); }
  };
  const initial = setTimeout(() => void check(), 60_000 + Math.random() * 60_000); initial.unref();
  const checks = setInterval(() => void check(), (6 + Math.random()) * 60 * 60_000); checks.unref();
}
process.once('SIGTERM', () => void shutdown()); process.once('SIGINT', () => void shutdown());
void start().catch(async error => {
  console.error('[service]', error instanceof Error ? error.message : 'Startup failed');
  status.phase = 'failed'; status.error = error instanceof Error ? error.message : 'Startup failed';
  if (!control.listening) { releaseOwner?.(); process.exit(1); }
  // Keep diagnostics/recovery available. Repeated startup failures must not
  // create a launchd restart loop or restore data written after an upgrade.
  await stopBackend();
  await awake.stop();
  await gateway?.close(1000).catch(() => {});
  updater?.startupFailed(error);
});
