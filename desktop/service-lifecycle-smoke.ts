import { writeDesktopHomeIntent } from '../src/lib/service/desktop-role-intent';
/** Ordinary-Node lifecycle qualification using only disposable application
 * data. Default mode never changes login jobs. --os-supervisor additionally
 * exercises real launchd/systemd adapters on an opted-in hosted CI account. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { stageRuntime } from '../src/lib/service/runtime';
import { servicePaths } from '../src/lib/service/paths';
import { ensureService, serviceRequest, serviceStatus, stopService, type ServiceSession } from '../src/lib/service/client';
import { hasLoginSupervision, installService, uninstallService } from '../src/lib/service/install';
import { assertDisposableSupervisorAccount, fixtureEnvironment } from './platform-qualification';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'os-supervisor': { type: 'boolean' }, report: { type: 'string' } } });
assert(positionals.length <= 1, 'Supply at most one unpacked runtime directory');
const packageVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).version as string;
const source = fs.realpathSync(path.resolve(positionals[0] ?? path.join(__dirname, '../release', `ri-runtime-${packageVersion}-${process.platform}-${process.arch}`)));
const reportFile = values.report ? path.resolve(values.report) : undefined;
const native = values['os-supervisor'] === true;
const parent = native ? process.env.RUNNER_TEMP : os.tmpdir();
assert(parent, 'OS supervision requires RUNNER_TEMP');
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(parent, 'ri-service-lifecycle-')));
if (native) assertDisposableSupervisorAccount(process.env, temporary, os.userInfo().homedir);
const environment = fixtureEnvironment(process.env, { temporary, ...(native ? { accountHome: os.userInfo().homedir } : {}) });
// Helpers discover the same isolated identity as child processes. Deliberately
// remove every inherited app override and provider credential first.
for (const name of Object.keys(process.env)) delete process.env[name];
Object.assign(process.env, environment);
writeDesktopHomeIntent();
fs.mkdirSync(process.env.HOME!, { recursive: true });
const paths = servicePaths();
const observed = new Set<number>();
const checks: string[] = [];
let runtime: ReturnType<typeof stageRuntime> | undefined;
let job: Awaited<ReturnType<typeof installService>> | undefined;
let failure: unknown;
let clean = false;

function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}
async function waitFor<T>(read: () => T | Promise<T>, ready: (value: T) => boolean, label: string, timeout = 180_000): Promise<T> {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (ready(value)) return value;
    await delay(200);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}. Inspect ${paths.log}`);
}
function track(session: ServiceSession) {
  assert.deepEqual(session.identity, paths.identity);
  assert.equal(session.phase, 'running');
  observed.add(session.pid);
  const child = JSON.parse(fs.readFileSync(path.join(paths.identity.work, 'service-child.json'), 'utf8')) as { pid: number; runId: string };
  assert.equal(child.runId, session.runId, 'Only signal a backend identified by this controller');
  assert(Number.isInteger(child.pid) && child.pid > 1 && child.pid !== process.pid && child.pid !== session.pid);
  observed.add(child.pid);
  return child.pid;
}
async function start() {
  assert(runtime);
  const session = await ensureService({ repo: runtime.repo, node: runtime.node, env: environment });
  track(session);
  return session;
}
async function api(session: ServiceSession, route: string, body?: object, authenticated = true) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const request = https.request(new URL(route, session.origin), {
      ca: session.certificate, allowPartialTrustChain: true, agent: false,
      method: body ? 'POST' : 'GET', headers: { ...(authenticated ? { authorization: `Bearer ${session.token}` } : {}), 'content-type': 'application/json' },
    }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; if (data.length > 1024 * 1024) request.destroy(new Error('Oversized fixture response')); });
      response.on('error', reject);
      response.on('end', () => { try { resolve({ status: response.statusCode!, body: data ? JSON.parse(data) : {} }); } catch (error) { reject(error); } });
    });
    request.setTimeout(15_000, () => request.destroy(new Error('Fixture HTTPS request timed out')));
    request.on('error', reject); request.end(body && JSON.stringify(body));
  });
}
async function reconnect(previous: ServiceSession) {
  if (native) {
    // Do not call ensureService here: qualification must prove the OS itself
    // relaunches a failed controller without help from an open GUI or CLI.
    await waitFor(serviceStatus, status => status?.phase === 'running' && status.runId !== previous.runId, 'automatic supervisor restart');
  } else {
    await waitFor(serviceStatus, status => status === null, 'failed controller exit');
  }
  const next = native ? await serviceRequest<ServiceSession>('/session') : await start();
  track(next);
  assert.notEqual(next.pid, previous.pid); assert.notEqual(next.runId, previous.runId);
  assert.equal(next.origin, previous.origin, 'Stable origin must survive reconnect');
  assert.equal(next.certificate, previous.certificate, 'Reconnection must keep the pinned local certificate');
  assert.equal((await api(next, '/api/health')).status, 200);
  return next;
}
function passed(check: string) { checks.push(check); console.info(`Passed: ${check}`); }

async function main() {
  try {
    assert.equal(await serviceStatus(), null, 'Fixture must not attach to an existing home');
    runtime = stageRuntime(source);
    job = await installService(true);
    assert(!fs.existsSync(job.file), 'The random fixture identity must not have an existing login job');
    let session = await start();
    const initial = session;
    const clients = await Promise.all([start(), start(), start()]);
    assert(clients.every(client => client.pid === session.pid && client.runId === session.runId && client.origin === session.origin));
    const cliStatus = JSON.parse(execFileSync(runtime.launcher, ['cli', 'service', 'status'], { env: environment, encoding: 'utf8', timeout: 30_000 }));
    assert.equal(cliStatus.runId, session.runId); assert.deepEqual(cliStatus.identity, paths.identity);
    passed('desktop/CLI clients attach to one identity and ordinary-Node owner');
    assert.equal((await api(session, '/api/notes', undefined, false)).status, 401);
    const note = await api(session, '/api/notes', { body: 'Retain this disposable note through service failures and uninstall.' });
    assert.equal(note.status, 201); assert.equal(typeof note.body.id, 'string');
    const noteRoute = `/api/notes/${note.body.id}`;
    passed('pinned HTTPS works without installing trust and unauthenticated data requests fail');

    if (native) {
      await installService();
      session = await start();
      assert.notEqual(session.runId, initial.runId, 'Installing supervision must transfer ownership');
      assert.equal(session.origin, initial.origin);
      assert(hasLoginSupervision());
      await installService();
      assert.equal((await serviceStatus())?.runId, session.runId, 'Repeated installation must leave the healthy controller running');
      passed('native install transfers the idle backend and is idempotent');
    } else {
      assert(!fs.existsSync(job.file)); assert(!hasLoginSupervision());
      passed('local qualification never installs a login job');
    }

    const stopped = session;
    await stopService();
    await waitFor(() => !alive(stopped.pid), value => value, 'stopped controller exit', 30_000);
    // A successful exit must remain stopped beyond the adapter's 30s backoff.
    await delay(native ? 32_000 : 1000);
    assert.equal(await serviceStatus(), null);
    session = await start();
    assert.notEqual(session.runId, stopped.runId); assert.equal(session.origin, initial.origin);
    assert.equal((await api(session, noteRoute)).body.body, note.body.body);
    passed('explicit stop remains stopped, restart retains data and origin');

    const failedBackend = track(session);
    console.info('Fault injection: terminating only the fixture backend');
    process.kill(failedBackend, 'SIGKILL');
    session = await reconnect(session);
    await waitFor(() => !alive(failedBackend), value => value, 'failed backend reaped', 30_000);
    assert.equal((await api(session, noteRoute)).body.body, note.body.body);
    passed(native ? 'OS supervisor recovers a failed backend without a client launch' : 'backend failure releases ownership and clients reconnect after restart');

    const orphan = track(session);
    const failedController = session.pid;
    console.info('Fault injection: terminating only the fixture controller');
    process.kill(failedController, 'SIGKILL');
    await waitFor(() => !alive(orphan), value => value, 'parent-disconnect watchdog reaps backend', 30_000);
    session = await reconnect(session);
    assert.equal((await api(session, noteRoute)).body.body, note.body.body);
    passed('controller failure leaves no orphan backend and reconnect retains data');

    if (native) {
      await uninstallService();
      assert(!hasLoginSupervision()); assert(!fs.existsSync(job.file));
      assert(fs.existsSync(paths.identity.database)); assert(fs.existsSync(runtime.launcher));
      assert.equal(await serviceStatus(), null);
      session = await start();
      assert.equal((await api(session, noteRoute)).body.body, note.body.body);
      passed('uninstall removes only supervision, preserving usable data and runtime');
    }
    await stopService();
    await waitFor(() => [...observed].every(pid => !alive(pid)), value => value, 'all fixture processes exited', 30_000);
    assert(!fs.existsSync(path.join(paths.identity.work, 'service-child.json')));
    assert(!fs.existsSync(job.file));
    passed('all observed controllers and backend children exit cleanly');
  } catch (error) { failure = error; }
  finally {
    try {
      if (native && job && fs.existsSync(job.file)) await uninstallService();
      await stopService();
      await waitFor(() => [...observed].every(pid => !alive(pid)), value => value, 'fixture cleanup', 30_000);
      clean = true;
    } catch (error) { console.error('Fixture cleanup failed:', error); failure ??= error; }
    const result = { passed: !failure, platform: process.platform, arch: process.arch, node: process.versions.node,
      runtime: runtime?.id, nativeSupervisor: native, checks, cleanupComplete: clean,
      ...(failure ? { error: failure instanceof Error ? failure.message : String(failure), artifacts: temporary } : {}) };
    if (reportFile) { fs.mkdirSync(path.dirname(reportFile), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(result, null, 2)); }
    console.info(JSON.stringify(result, null, 2));
    // Failed runs preserve private fixture logs. Never remove live process data.
    if (!failure && clean) { fs.rmSync(paths.socket, { force: true }); fs.rmSync(temporary, { recursive: true, force: true }); }
  }
  if (failure) throw failure;
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
