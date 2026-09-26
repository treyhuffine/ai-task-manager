/** Real signed HTTPS download, SQLite migration and ordinary-Node handoff.
 * Uses only a disposable home. No OS trust store or login service is changed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { once } from 'node:events';
import { generateKeyPairSync, sign } from 'node:crypto';
import Database from 'better-sqlite3';
import { _electron, type ElectronApplication } from 'playwright-core';
import * as tar from 'tar';
import { generateCaPair, generateLeafPair } from '../src/lib/config/tls-x509';
import { getCaCertPath } from '../src/lib/config/tls';
import { createRuntimeManifest, getRuntimeInstallDir, stageRuntime, installedRuntime } from '../src/lib/service/runtime';
import { ensureService, serviceRequest, serviceStatus, stopService, type ServiceSession } from '../src/lib/service/client';
import { fileDigest, verifyCheckpoint } from '../src/lib/service/checkpoint';
import type { UpdateRecord } from '../src/lib/service/update';

const source = path.resolve(process.argv[2] ?? `release/ri-runtime-0.1.0-${process.platform}-${process.arch}`);
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-update-smoke-')));
for (const name of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR', 'RI_MAINTENANCE_TOKEN', 'RI_SERVICE_VALIDATING']) delete process.env[name];
Object.assign(process.env, { RI_ROOT: path.join(temporary, 'home'), RI_INSTALL_ROOT: path.join(temporary, 'installed'), RI_DESKTOP: '1', RI_DESKTOP_MODE: 'production', NEXT_DIST_DIR: '.next-desktop' });
let server: https.Server | undefined;
let envelope: object;
let archive: string;
let gui: ElectronApplication | undefined;
async function waitFor<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string, timeout = 240_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await read(); if (ready(value)) return value; }
    catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out: ${label}. See ${temporary}`);
}
async function update() { return (await serviceRequest<{ update: UpdateRecord }>('/update')).update; }
async function action(action: string) { await serviceRequest('/update', 'POST', 30_000, { action }); }
async function request(session: ServiceSession, route: string, body?: object, method = body ? 'POST' : 'GET') {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const request = https.request(`${session.origin}${route}`, { ca: fs.readFileSync(getCaCertPath()), method, headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' } }, response => {
      let data = ''; response.on('data', chunk => { data += chunk; }); response.on('end', () => { try { resolve({ status: response.statusCode!, body: JSON.parse(data) }); } catch (error) { reject(error); } });
    }); request.on('error', reject); request.end(body && JSON.stringify(body));
  });
}
async function main() {
try {
  console.info('Staging the first runtime');
  const first = stageRuntime(source);
  console.info('Preparing the candidate runtime and appended migration');
  const candidate = path.join(temporary, 'candidate');
  fs.cpSync(source, candidate, { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
  const pkg = path.join(candidate, 'server/package.json');
  fs.writeFileSync(pkg, JSON.stringify({ ...JSON.parse(fs.readFileSync(pkg, 'utf8')), version: '0.1.1' }));
  const journalFile = path.join(candidate, 'server/drizzle/meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
  const last = journal.entries.at(-1);
  const tag = `${String(last.idx + 1).padStart(4, '0')}_desktop_update_smoke`;
  journal.entries.push({ idx: last.idx + 1, version: last.version, when: last.when + 1000, tag, breakpoints: true });
  fs.writeFileSync(journalFile, JSON.stringify(journal));
  fs.writeFileSync(path.join(candidate, 'server/drizzle', `${tag}.sql`), 'CREATE TABLE desktop_update_smoke (id INTEGER PRIMARY KEY, value TEXT NOT NULL);\n');
  const manifest = createRuntimeManifest(candidate);
  archive = path.join(temporary, 'runtime.tar.gz');
  console.info('Compressing the signed update fixture');
  await tar.c({ file: archive, cwd: candidate, gzip: true, portable: true, noMtime: true }, ['node', 'server', 'runtime-manifest.json']);
  const ca = await generateCaPair({ years: 1, clockSkewMs: 1000 });
  const leaf = await generateLeafPair({ caCertPem: ca.certPem, caKeyPem: ca.keyPem, sans: [{ type: 'dns', value: 'localhost' }], days: 1, clockSkewMs: 1000 });
  const caFile = path.join(temporary, 'fixture-ca.pem'); fs.writeFileSync(caFile, ca.certPem);
  server = https.createServer({ key: leaf.keyPem, cert: leaf.certPem }, (req, res) => {
    if (req.url === '/release.json') res.end(JSON.stringify(envelope));
    else if (req.url === '/runtime.tar.gz') fs.createReadStream(archive).pipe(res);
    else { res.statusCode = 404; res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `https://localhost:${(server.address() as { port: number }).port}`;
  const keys = generateKeyPairSync('ed25519');
  const release = { format: 1, sequence: 1, version: manifest.version, channel: 'stable', publishedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), platform: process.platform, arch: process.arch, minimumUpdater: 1, apiProtocol: 1, configFormat: 1, withdrawn: false, notes: 'Isolated updater smoke', migrationHistory: fileDigest(journalFile), runtime: { id: manifest.id, url: `${origin}/runtime.tar.gz`, sha256: fileDigest(archive), size: fs.statSync(archive).size, unpackedSize: manifest.files.reduce((sum, file) => sum + (file.sha256 ? fs.statSync(path.join(candidate, file.name)).size : 0), 0) + fs.statSync(path.join(candidate, 'runtime-manifest.json')).size } };
  const payload = Buffer.from(JSON.stringify(release));
  envelope = { payload: payload.toString('base64'), signature: sign(null, payload, keys.privateKey).toString('base64') };
  fs.writeFileSync(path.join(getRuntimeInstallDir(), 'release-policy.json'), JSON.stringify({ format: 1, feed: `${origin}/release.json`, publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), channel: 'stable', automaticDownload: false, metered: true }));
  console.info('Starting the standalone service');
  const initial = await ensureService({ repo: first.repo, node: first.node, env: { ...process.env, NODE_EXTRA_CA_CERTS: caFile } });
  const created = await request(initial, '/api/notes', { body: 'Keep this note across the update.' });
  assert.equal(created.status, 201);
  const noteId = created.body.id;
  assert.equal(typeof noteId, 'string');
  if (process.env.RI_UPDATE_SMOKE_GUI) {
    console.info('Attaching the packaged GUI to the same service');
    await request(initial, '/api/user-state', { onboardedAt: new Date().toISOString() }, 'PATCH');
    gui = await _electron.launch({ executablePath: path.join(path.resolve(process.env.RI_UPDATE_SMOKE_GUI), 'Contents/MacOS/Ri'), env: { ...process.env, RI_DESKTOP_ROOT: process.env.RI_ROOT!, RI_DESKTOP_SMOKE: '1' }, timeout: 240_000 });
    const page = await gui.firstWindow();
    await page.waitForURL(url => url.origin === initial.origin, { timeout: 240_000 });
    await page.goto(`${initial.origin}/?settings=updates`);
  }
  const unpublished = path.join(process.env.RI_ROOT!, 'unpublished.txt'); fs.writeFileSync(unpublished, 'unpublished work');
  console.info('Downloading a publisher-verified release');
  if (gui) await (await gui.firstWindow()).getByRole('button', { name: 'Check for updates', exact: true }).click();
  else await action('check');
  await waitFor(update, v => ['available', 'failed'].includes(v.phase), 'release discovery');
  assert.equal((await update()).phase, 'available');
  if (gui) await (await gui.firstWindow()).getByRole('button', { name: 'Download update', exact: true }).click();
  else await action('download');
  const downloaded = await waitFor(update, v => ['ready', 'failed'].includes(v.phase), 'verified download', 600_000);
  assert.equal(downloaded.phase, 'ready', downloaded.error);
  if (gui) {
    const page = await gui.firstWindow();
    await page.goto(`${initial.origin}/note/${noteId}`);
    const title = page.locator('textarea.note-title');
    await title.waitFor(); await title.fill('An open desktop survives this update');
    await page.evaluate(() => { (window as unknown as { riUpdateSmokeMarker?: boolean }).riUpdateSmokeMarker = true; });
  }
  console.info('Applying the SQLite migration and handing off the controller');
  await action('apply');
  await waitFor(serviceStatus, v => !!v && v.phase === 'running' && v.runId !== initial.runId, 'new controller', 240_000);
  const current = await serviceRequest<ServiceSession>('/session');
  assert.equal(current.version, '0.1.1'); assert.equal(current.origin, initial.origin); assert.notEqual(current.pid, initial.pid);
  assert.equal(installedRuntime()?.id, manifest.id);
  const record = await update(); assert.equal(record.phase, 'committed'); assert(record.checkpoint); verifyCheckpoint(record.checkpoint);
  const db = new Database(path.join(process.env.RI_ROOT!, 'data.db'), { readonly: true });
  try { assert(db.prepare("SELECT name FROM sqlite_master WHERE name='desktop_update_smoke'").get()); }
  finally { db.close(); }
  const note = await request(current, `/api/notes/${noteId}`);
  assert.equal(note.status, 200); assert.equal(note.body.body, 'Keep this note across the update.');
  if (gui) {
    assert.equal(note.body.title, 'An open desktop survives this update');
    const page = await gui.firstWindow();
    await page.waitForFunction(() => !(window as unknown as { riUpdateSmokeMarker?: boolean }).riUpdateSmokeMarker, undefined, { timeout: 60_000 });
    await page.waitForURL(url => url.origin === current.origin && url.pathname === `/note/${noteId}`, { timeout: 60_000 });
    await page.locator('textarea.note-title').waitFor();
    assert.equal(await page.locator('textarea.note-title').inputValue(), note.body.title);
  }
  const after = await request(current, '/api/notes', { body: 'New data after upgrade.' }); assert.equal(after.status, 201);
  assert.equal(fs.readFileSync(unpublished, 'utf8'), 'unpublished work');
  assert(fs.existsSync(first.repo));
  console.info(JSON.stringify({ passed: true, guiAttached: !!gui, originStable: true, publisherVerified: true, migrated: true, controllerReplaced: true, priorRuntimeRetained: true, newWritesAccepted: true, checkpointVerified: true, temporary }));
} finally {
  if (gui) {
    await Promise.all([
      gui.waitForEvent('close', { timeout: 30_000 }),
      gui.evaluate(({ app }) => { app.quit(); }),
    ]).catch(() => { gui?.process().kill('SIGKILL'); });
  }
  await stopService().catch(error => console.error('Isolated service cleanup:', error.message));
  server?.closeAllConnections(); await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
}

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
