/** Ordinary Node connection helper. Its IPC lifetime is independent of the
 * background service, which belongs to the selected data root. */
import { demoEnvironment, bundledCliCommand, type BackendMessage } from './config';
import { getAppRoot } from '../src/lib/config/paths';
import { ensureService, serviceStatus, serviceRequest, type ServiceSession } from '../src/lib/service/client';
import { stageRuntime, installedRuntime } from '../src/lib/service/runtime';

const repo = process.env.RI_DESKTOP_REPO!;
const mode = process.env.RI_DESKTOP_MODE === 'development' ? 'development' : 'production';
const env = demoEnvironment(repo, process.env, mode);
Object.assign(process.env, env);
process.env.RI_CLI_COMMAND = bundledCliCommand(process.execPath, repo, getAppRoot());
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
  const active = process.env.RI_DESKTOP_RESOURCES ? installedRuntime() : null;
  const runtime = process.env.RI_DESKTOP_RESOURCES
    ? running?.phase === 'running' && active?.repo === running.repo
      ? active : stageRuntime(process.env.RI_DESKTOP_RESOURCES)
    : undefined;
  const serviceRepo = runtime?.repo ?? repo;
  const node = runtime?.node ?? process.execPath;
  process.env.RI_CLI_COMMAND = bundledCliCommand(node, serviceRepo, getAppRoot());
  const ready = await ensureService({ repo: serviceRepo, node,
    env: { ...process.env, RI_RUNTIME_REPO: serviceRepo, RI_DESKTOP_REPO: serviceRepo } });
  send({ type: 'ready', serviceRunId: ready.runId, desktopClient: ready.desktopClient, runtime, origin: ready.origin, certificate: ready.certificate, token: ready.token });
  let runId = ready.runId;
  let certificate = ready.certificate;
  let checking = false;
  const monitor = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const status = await serviceStatus();
      if (status?.phase === 'running') {
        const session = await serviceRequest<ServiceSession>('/session');
        if (status.runId === runId) {
          if (session.certificate !== certificate) { certificate = session.certificate; send({ type: 'certificate', origin: session.origin, certificate }); }
          return;
        }
        runId = session.runId; certificate = session.certificate;
        send({ type: 'ready', serviceRunId: session.runId, desktopClient: session.desktopClient, runtime: installedRuntime() ?? runtime, origin: session.origin, certificate: session.certificate, token: session.token });
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
