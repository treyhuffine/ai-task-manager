/** Ordinary Node process. Native app modules never load in Electron's Node ABI. */
import { once } from 'node:events';
import { type ChildProcess } from 'node:child_process';
import getPort from 'get-port';
import { demoEnvironment, bundledCliCommand, type BackendMessage } from './config';
import { getAppRoot } from '../src/lib/config/paths';
import { startNextServer, waitForServer } from '../src/cli/lib/server';
import { startHttp2Gateway, type Http2GatewayHandle } from '../src/cli/http2-gateway';
import { ensureGeneratedTls } from '../src/lib/config/tls';
import { clearServerRuntimeIfOwned, newRunId, publishServerRuntime, readLiveServerRuntime, PUBLIC_BASE_URL_ENV } from '../src/lib/server-runtime/record';

const repo = process.env.RI_DESKTOP_REPO!;
const mode = process.env.RI_DESKTOP_MODE === 'development' ? 'development' : 'production';
const env = demoEnvironment(repo, process.env, mode);
for (const key of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']) delete process.env[key];
Object.assign(process.env, env);
process.chdir(repo);
Object.assign(process.env, { NODE_ENV: mode });
process.env.RI_CLI_COMMAND = bundledCliCommand(process.execPath, repo, getAppRoot());

let next: ChildProcess | undefined;
let gateway: Http2GatewayHandle | undefined;
let stopping = false;
const runId = newRunId();
const send = (message: BackendMessage) => { if (process.connected) process.send?.(message); };

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearServerRuntimeIfOwned(runId);
  await gateway?.close(500).catch(() => {});
  if (next && next.exitCode === null && next.signalCode === null) {
    const exited = once(next, 'exit');
    next.kill('SIGTERM');
    const force = setTimeout(() => next?.kill('SIGKILL'), 6000);
    await exited.catch(() => {});
    clearTimeout(force);
  }
  process.exit(code);
}
process.on('message', (message) => { if ((message as { type?: string })?.type === 'stop') void shutdown(); });
process.once('disconnect', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

async function start() {
  if (readLiveServerRuntime()) throw new Error('This demo home already has a running server. Quit it before starting the demo.');
  const tls = await ensureGeneratedTls(); // Generates files only. Never calls OS trust tools.
  const privatePort = await getPort({ host: '127.0.0.1' });
  let origin = '';
  // Binding the gateway before Next also reserves the public port during startup.
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await getPort({ host: '127.0.0.1', port: attempt === 0 ? 42242 : undefined, exclude: [privatePort] });
    origin = `https://localhost:${port}`;
    try {
      gateway = await startHttp2Gateway({ publicPort: port, publicBaseUrl: origin, upstreamHost: '127.0.0.1', upstreamPort: privatePort, tls });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt === 4) throw error;
    }
  }
  if (stopping) return;
  process.env[PUBLIC_BASE_URL_ENV] = origin;
  process.env.PORT = String(privatePort);
  const { ensureLocalToken } = await import('../src/lib/auth/bootstrap');
  const { resetDb } = await import('../src/lib/db');
  const token = ensureLocalToken().plaintext;
  resetDb();
  next = startNextServer({ port: privatePort, dev: mode === 'development', hostname: '127.0.0.1' });
  next.on('error', (error) => { send({ type: 'error', message: error.message }); void shutdown(1); });
  next.on('exit', (code) => {
    if (!stopping) { send({ type: 'error', message: `The app server stopped (${code ?? 'signal'}). Relaunch the demo.` }); void shutdown(1); }
  });
  await waitForServer(`http://127.0.0.1:${privatePort}`, 180_000);
  if (stopping) return;
  const probe = await gateway!.probe();
  if (!probe.ok) throw new Error(`HTTP/2 readiness failed: ${probe.detail || probe.negotiatedProtocol || 'no response'}`);
  publishServerRuntime({ version: 1, runId, launcherPid: process.pid, startedAt: new Date().toISOString(), mode: 'https', http2: true,
    publicBaseUrl: origin, publicPort: gateway!.port, privateUpstreams: { next: `http://127.0.0.1:${privatePort}` } });
  console.info(`[desktop] HTTP/2 ready at ${origin}. Data: ${getAppRoot()}`);
  send({ type: 'ready', origin, certificate: tls.cert, token });
}

start().catch((error) => { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); void shutdown(1); });
