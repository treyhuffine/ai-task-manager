/** Ordinary Node connection helper. Its IPC lifetime is independent of the
 * background service, which belongs to the selected data root. */
import { demoEnvironment, bundledCliCommand, type BackendMessage, type BackendReady } from './config';
import { getAppRoot } from '../src/lib/config/paths';
import { serviceIdentity } from '../src/lib/service/paths';
import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { InstallationInspection } from './installation';
import { ensureServiceStatus, serviceStatus, serviceRequest, type ServiceSession, type ServiceStatus } from '../src/lib/service/client';
import { attachExistingOwner, runtimeForOwner } from './backend-selection';
import { installedRuntime } from '../src/lib/service/runtime';
import { stageFirstDesktopRuntime } from '../src/lib/service/initialization';
import { connectionSetup, type ConnectionSetupStatus, type ConnectedViewerSession } from './connection-setup';
import { assertLocalBridge, remoteViewerOrigin } from './viewer-trust';

const repo = process.env.RI_DESKTOP_REPO!;
const mode = process.env.RI_DESKTOP_MODE === 'development' ? 'development' : 'production';
const env = demoEnvironment(repo, process.env, mode);
Object.assign(process.env, env);
const send = (message: BackendMessage) => { if (process.connected) process.send?.(message); };
process.on('message', message => { if ((message as { type?: string }).type === 'stop') process.exit(0); });
process.once('disconnect', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
process.once('SIGINT', () => process.exit(0));

void (async () => {
  // Read role before inspecting or initializing a database. A connected viewer
  // owns credentials and worker journals, never a local tasks database.
  const setup = await connectionSetup({ action: 'inspect' }, { development: mode === 'development' }) as ConnectionSetupStatus;
  const running = await serviceStatus();
  if ((setup.role === 'first-run' && !setup.homeSelected) || ['retired', 'conflict'].includes(setup.role)) {
    send({ type: 'setup', status: setup });
    return;
  }
  const remote = setup.role === 'worker' || setup.role === 'viewer';
  const existingInstallation = process.env.RI_DESKTOP_ASSOCIATED === '1' || fs.existsSync(serviceIdentity().database) || (!running && !!installedRuntime());
  if (!remote && !running && existingInstallation) {
    const inspection = await new Promise<InstallationInspection>((resolve, reject) => execFile(process.execPath,
      [path.join(repo, 'dist/desktop/inspect-installation.cjs')], { env: process.env, timeout: 15_000, maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid installation inspection.')); } }
      }));
    if (!inspection.canUse) throw new Error(inspection.reason ?? 'This installation cannot be started safely.');
  }
  let status: ServiceStatus;
  if (running) {
    status = await attachExistingOwner({ status: serviceStatus, session: async () => {
      const current = await serviceStatus();
      if (!current) throw new Error('The service stopped while connecting. Retry.');
      return current;
    } });
  } else {
    const active = installedRuntime();
    // A development launch runs its own checkout, the way `pnpm dev` does, so
    // it starts the dev home's service itself (the inspection above passed).
    if (!remote && existingInstallation && !active && mode !== 'development') throw new Error('Start this installation with its existing CLI service before connecting.');
    const runtime = active ?? (process.env.RI_DESKTOP_RESOURCES ? stageFirstDesktopRuntime(process.env.RI_DESKTOP_RESOURCES) : undefined);
    const serviceRepo = runtime?.repo ?? repo;
    status = await ensureServiceStatus({ repo: serviceRepo, node: runtime?.node ?? process.execPath,
      env: { ...process.env, RI_RUNTIME_REPO: serviceRepo, RI_DESKTOP_REPO: serviceRepo } });
  }
  const ownerRuntime = (owner: ServiceStatus) => {
    let active: ReturnType<typeof installedRuntime> = null;
    try { active = installedRuntime(); } catch { /* A bad selection cannot replace a live owner. */ }
    return runtimeForOwner(owner, active);
  };
  async function ready(owner: ServiceStatus): Promise<BackendReady> {
    const runtime = ownerRuntime(owner);
    if (runtime) process.env.RI_CLI_COMMAND = bundledCliCommand(runtime.node, runtime.repo, getAppRoot(), serviceIdentity());
    if (owner.role === 'worker' || owner.role === 'viewer') {
      const connected = await connectionSetup({ action: 'session' }, { development: mode === 'development' }) as ConnectedViewerSession;
      return { type: 'ready', connection: 'remote', serviceRunId: owner.runId, runtime,
        origin: remoteViewerOrigin(connected.homeUrl, mode === 'development'), certificate: '', token: connected.signInKey,
        homeId: connected.homeId, homeName: connected.homeName, deviceId: connected.deviceId };
    }
    assertLocalBridge(owner.release);
    const local = await serviceRequest<ServiceSession>('/session');
    return { type: 'ready', connection: 'home', serviceRunId: local.runId, desktopClient: local.desktopClient, runtime,
      origin: local.origin, certificate: local.certificate, token: local.token };
  }
  let last: BackendReady | undefined;
  let checking = false;
  let reportedFailure: string | undefined;
  async function connect(owner: ServiceStatus) {
    send({ type: 'status', status: owner });
    const next = await ready(owner);
    if (!last || reportedFailure || next.serviceRunId !== last.serviceRunId || next.origin !== last.origin || next.token !== last.token || next.connection !== last.connection) send(next);
    else if (next.certificate !== last.certificate) send({ type: 'certificate', origin: next.origin, certificate: next.certificate });
    last = next; reportedFailure = undefined;
  }
  // An unavailable Home does not stop its local worker/controller. Retry the
  // verified connection while retaining the existing renderer and its drafts.
  try { await connect(status); }
  catch (error) { reportedFailure = error instanceof Error ? error.message : 'Cannot reach your Home.'; send({ type: 'error', message: reportedFailure }); }
  const monitor = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const current = await serviceStatus();
      if (current?.phase === 'running') {
        if (last && current.runId === last.serviceRunId && current.role !== 'worker' && current.role !== 'viewer') {
          send({ type: 'status', status: current });
          const local = await serviceRequest<ServiceSession>('/session');
          if (local.certificate !== last.certificate) { last.certificate = local.certificate; send({ type: 'certificate', origin: local.origin, certificate: local.certificate }); }
        } else await connect(current);
      } else if (current?.phase === 'failed') throw new Error(current.error ?? 'The background service needs recovery.');
      else if (!current) throw new Error('This device’s background service stopped. Open Ri on This Device and retry after restarting it.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cannot reach your Home.';
      if (message !== reportedFailure) send({ type: 'error', message });
      reportedFailure = message;
    } finally { checking = false; }
  }, remote ? 5000 : 2000);
  monitor.unref();
})().catch(error => {
  send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
  process.disconnect?.();
});
