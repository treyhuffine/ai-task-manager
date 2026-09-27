/** Ordinary Node connection helper. Its IPC lifetime is independent of the
 * background service, which belongs to the selected data root. */
import { demoEnvironment, bundledCliCommand, type BackendMessage } from './config';
import { getAppRoot } from '../src/lib/config/paths';
import { serviceIdentity } from '../src/lib/service/paths';
import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { InstallationInspection } from './installation';
import { ensureService, serviceStatus, serviceRequest, type ServiceSession, type ServiceStatus } from '../src/lib/service/client';
import { attachExistingOwner, runtimeForOwner } from './backend-selection';
import { installedRuntime } from '../src/lib/service/runtime';
import { stageFirstDesktopRuntime } from '../src/lib/service/initialization';

const repo = process.env.RI_DESKTOP_REPO!;
const mode = process.env.RI_DESKTOP_MODE === 'development' ? 'development' : 'production';
const env = demoEnvironment(repo, process.env, mode);
Object.assign(process.env, env);
const send = (message: BackendMessage) => { if (process.connected) process.send?.(message); };

// Closing Electron stops only this helper. Stop Service is a separate action.
process.on('message', message => { if ((message as { type?: string }).type === 'stop') process.exit(0); });
process.once('disconnect', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
process.once('SIGINT', () => process.exit(0));

void (async () => {
  // A verified live owner already serves this exact installation. Attaching
  // must not hash/copy the entire app again just to reopen its viewer.
  const running = await serviceStatus();
  const existingInstallation = process.env.RI_DESKTOP_ASSOCIATED === '1' || fs.existsSync(serviceIdentity().database) || (!running && !!installedRuntime());
  if (!running && existingInstallation) {
    const inspection = await new Promise<InstallationInspection>((resolve, reject) => execFile(process.execPath,
      [path.join(repo, 'dist/desktop/inspect-installation.cjs')], { env: process.env, timeout: 15_000, maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid installation inspection.')); } }
      }));
    if (!inspection.canUse) throw new Error(inspection.reason ?? 'This installation cannot be started safely.');
  }
  let ready: ServiceSession;
  if (running) {
    ready = await attachExistingOwner({ status: serviceStatus, session: () => serviceRequest<ServiceSession>('/session') });
  } else {
    // An existing data home may restart only its previously selected managed
    // runtime. It never adopts the currently opened shell's bundled binaries.
    const active = installedRuntime();
    if (existingInstallation && !active) throw new Error('Start this installation with its existing CLI service before connecting.');
    const runtime = existingInstallation ? active
      : process.env.RI_DESKTOP_RESOURCES ? stageFirstDesktopRuntime(process.env.RI_DESKTOP_RESOURCES) : undefined;
    const serviceRepo = runtime?.repo ?? repo;
    const node = runtime?.node ?? process.execPath;
    ready = await ensureService({ repo: serviceRepo, node,
      env: { ...process.env, RI_RUNTIME_REPO: serviceRepo, RI_DESKTOP_REPO: serviceRepo } });
  }
  const ownerRuntime = (owner: ServiceStatus) => {
    let active: ReturnType<typeof installedRuntime> = null;
    try { active = installedRuntime(); } catch { /* Invalid local selection cannot replace a verified live owner. */ }
    return runtimeForOwner(owner, active);
  };
  const runtime = ownerRuntime(ready);
  if (runtime) process.env.RI_CLI_COMMAND = bundledCliCommand(runtime.node, runtime.repo, getAppRoot(), serviceIdentity());
  send({ type: 'ready', serviceRunId: ready.runId, desktopClient: ready.desktopClient, runtime, origin: ready.origin, certificate: ready.certificate, token: ready.token });
  let runId = ready.runId;
  let certificate = ready.certificate;
  let checking = false;
  let reportedFailure: string | undefined;
  const monitor = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const status = await serviceStatus();
      if (status?.phase === 'failed') {
        const failure = status.error ?? 'The background service needs recovery.';
        if (failure !== reportedFailure) send({ type: 'error', message: failure });
        reportedFailure = failure;
        return;
      }
      if (status?.phase === 'running') {
        reportedFailure = undefined;
        const session = await serviceRequest<ServiceSession>('/session');
        if (status.runId === runId) {
          if (session.certificate !== certificate) { certificate = session.certificate; send({ type: 'certificate', origin: session.origin, certificate }); }
          return;
        }
        runId = session.runId; certificate = session.certificate;
        send({ type: 'ready', serviceRunId: session.runId, desktopClient: session.desktopClient, runtime: ownerRuntime(session), origin: session.origin, certificate: session.certificate, token: session.token });
      }
    } catch { /* status is unavailable briefly during a service-manager restart */ }
    finally { checking = false; }
  }, 2000);
  monitor.unref();

})().catch(error => {
  send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
  process.disconnect?.();
});
