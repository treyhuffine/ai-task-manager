/** Plain bundled Node and the packaged setup helper against real Home routes.
 * All databases, connection records and enrollments are disposable. --gui
 * also boots an isolated packaged app. No real installation is changed. */
import '../src/test/setup-env';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestHome } from '../src/test/fixtures/home';
import { startHomeServer } from '../src/test/fixtures/home-server';
import { desktopPackageLayout } from './package-layout';
import type { ConnectionSetupReply, ConnectionSetupRequest } from './connection-setup';
import { EventJournal } from '../src/lib/worker/event-journal';
import { CommandJournal } from '../src/lib/worker/command-journal';

async function main() {
  const resources = process.env.RI_DESKTOP_PACKAGE ? desktopPackageLayout(process.env.RI_DESKTOP_PACKAGE).resources : null;
  const repo = path.resolve(__dirname, '..');
  const helper = path.join(resources ? path.join(resources, 'server') : repo, 'dist/desktop/connection-setup-entry.cjs');
  const node = resources ? path.join(resources, 'node/bin/node') : process.execPath;
  assert(fs.existsSync(helper), 'Build the desktop before running this check.');
  const home = await createTestHome({ prefix: 'ri-reconnect-home-' });
  const laptop = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-reconnect-laptop-'));
  const identity = await import('../src/lib/home/identity');
  identity.resetHomeIdentityCache();
  const { home: homeRecord } = identity.ensureHomeIdentity();
  const q = await import('../src/lib/db/queries');
  const server = await startHomeServer();
  const report = { packaged: !!resources, runtimeId: resources ? JSON.parse(fs.readFileSync(path.join(resources, 'runtime-manifest.json'), 'utf8')).id : null,
    helperSha256: createHash('sha256').update(fs.readFileSync(helper)).digest('hex'), checks: [] as string[] };
  const passed = (check: string) => { report.checks.push(check); console.info(`[reconnect] ${check}`); };
  const config = path.join(laptop, '.config');
  const saved = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(config, name), 'utf8')) as T;
  const env = { ...process.env, RI_ROOT: laptop, RI_CONFIG_DIR: '', RI_DB_PATH: '', RI_WORK_DIR: '', RI_DESKTOP_SETUP_DEVELOPMENT: '1', RI_RUNTIME_REPO: resources ? path.join(resources, 'server') : repo };

  async function setup(request: ConnectionSetupRequest): Promise<unknown> {
    const reply = await new Promise<ConnectionSetupReply>((resolve, reject) => {
      const child = spawn(node, [helper], { cwd: laptop, env, stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Desktop setup timed out.')); }, 30_000);
      child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
      // Never print child output: it carries the connection/session secrets.
      child.stderr.resume();
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`Desktop setup exited with status ${code}.`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as ConnectionSetupReply); }
        catch { reject(new Error('Desktop setup returned an invalid reply.')); }
      });
      child.stdin.end(JSON.stringify(request));
    });
    if (!reply.ok) throw new Error(reply.error);
    return reply.result;
  }
  const connect = (token: string) => setup({ action: 'connect', pairingLink: `${server.url}/#token=${token}` });
  try {
    const first = q.pairDevice({ name: 'Disposable laptop', kind: 'computer' });
    await connect(first.token.plaintext);
    await setup({ action: 'enable-worker', consent: true });
    const original = saved<{ deviceId: string; connectedAt: string }>('connection.json');
    const oldEnrollment = fs.readFileSync(path.join(config, 'worker.json'), 'utf8');
    const repaired = q.pairDevice({ name: 'New link for same laptop', kind: 'computer' });
    await connect(repaired.token.plaintext);
    assert.equal(saved<{ deviceId: string }>('connection.json').deviceId, first.device.id);
    assert.equal(fs.readFileSync(path.join(config, 'worker.json'), 'utf8'), oldEnrollment);
    assert.equal(q.getDevice(repaired.device.id)?.status, 'revoked');
    passed('A fresh link preserves an active device and its local enrollment.');

    const eventPath = path.join(laptop, '.work/journal', `${homeRecord.id}.jsonl`);
    const commandPath = path.join(laptop, '.work/commands', `${homeRecord.id}.jsonl`);
    new EventJournal(homeRecord.id, eventPath).append({ kind: 'chat_event', eventId: 'old-output', chatSessionId: 'old-chat', occurredAt: new Date().toISOString(), generation: null, cumulative: false, chatEvent: { role: 'assistant', source: 'agent', content: 'Retained local output' } });
    new CommandJournal(homeRecord.id, commandPath).received({ id: 'old-command', seq: 20, kind: 'send', target: { executionId: null, chatSessionId: 'old-chat', generation: null }, actor: { source: 'human' }, issuedAt: new Date().toISOString(), payload: { turnId: 'old-turn' } });
    q.removeDevice(first.device.id, 'Removed in the reconnect fixture');
    const replacement = q.pairDevice({ name: 'Replacement laptop', kind: 'computer' });
    const connected = await connect(replacement.token.plaintext);
    assert.equal((connected as { role: string }).role, 'viewer');
    assert.equal(saved<{ deviceId: string }>('connection.json').deviceId, replacement.device.id);
    assert.equal(saved<{ connectedAt: string }>('connection.json').connectedAt, original.connectedAt);
    assert.equal(fs.existsSync(path.join(laptop, 'data.db')), false);
    assert.equal(fs.existsSync(path.join(config, 'worker.json')), false);
    assert.equal(fs.existsSync(eventPath), false);
    assert.equal(fs.existsSync(commandPath), false);
    const retained = path.join(laptop, '.work/retired-workers');
    const archive = path.join(retained, fs.readdirSync(retained)[0]);
    assert.equal(fs.readFileSync(path.join(archive, 'worker.json'), 'utf8'), oldEnrollment);
    assert(fs.readFileSync(path.join(archive, 'events.jsonl'), 'utf8').includes('Retained local output'));
    assert(fs.readFileSync(path.join(archive, 'commands.jsonl'), 'utf8').includes('old-command'));
    passed('Deleting and pairing again accepts the new valid link and retains old local work separately.');

    assert.equal((await setup({ action: 'session' }) as { deviceId: string }).deviceId, replacement.device.id);
    assert.equal(q.getDevice(first.device.id)?.status, 'revoked');
    assert(q.getApiKey(first.key.id)?.revokedAt);
    assert.equal(q.getWorkerKeyId(first.device.id), null);
    passed('The replacement opens an authenticated session while the deleted identity stays revoked.');

    await setup({ action: 'enable-worker', consent: true });
    assert.equal(saved<{ deviceId: string }>('worker.json').deviceId, replacement.device.id);
    assert.equal(new EventJournal(homeRecord.id, eventPath).lastPosition(), 0);
    assert.equal(new CommandJournal(homeRecord.id, commandPath).cursor(), 0);
    passed('Explicit local execution enrolls the replacement without replaying old events or commands.');

    const output = path.join(repo, '.electron-demo/device-reconnect-report.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.info(`[reconnect] Report: ${output}`);
  } finally {
    await server.close();
    identity.resetHomeIdentityCache();
    await home.cleanup();
    fs.rmSync(laptop, { recursive: true, force: true });
  }
}
async function checkPackagedStartup() {
  assert(process.env.RI_DESKTOP_PACKAGE, '--gui requires RI_DESKTOP_PACKAGE.');
  const { acceptance, api } = await import('./acceptance-fixture');
  const { makePdf } = await import('../src/test/fixtures/pdf');
  await acceptance('device-reconnect-package', async fixture => {
    // Test attaching the shell to an existing Home. Starting that isolated
    // Home from the same packaged resources avoids an unrelated full runtime
    // copy during Electron's launch handshake.
    const resources = desktopPackageLayout(process.env.RI_DESKTOP_PACKAGE!).resources;
    const repo = path.join(resources, 'server');
    const { ensureServiceStatus } = await import('../src/lib/service/client');
    await ensureServiceStatus({ repo, node: path.join(resources, 'node/bin/node'),
      env: { ...fixture.env, NODE_ENV: 'production', RI_RUNTIME_REPO: repo, NEXT_DIST_DIR: '.next-desktop' } });
    const page = await fixture.launch();
    const home = await api<{ id: string }>(page, '/api/home');
    assert(home.id);
    const note = await api<{ id: string; body: string }>(page, '/api/notes', 'POST', { title: 'Disposable package check', body: 'Saved by the rebuilt app.' });
    assert.equal((await api<{ body: string }>(page, `/api/notes/${note.id}`)).body, note.body);
    fixture.check('The packaged app opens its isolated Home and saves and reads content.');
    // Exercise the runtime-owned Node resolver through its packaged route.
    const preview = await page.evaluate(async bytes => {
      const form = new FormData();
      form.set('file', new File([new Uint8Array(bytes)], 'Package check.pdf', { type: 'application/pdf' }));
      const upload = await fetch('/api/attachments', { method: 'POST', body: form });
      if (!upload.ok) throw new Error(`Attachment upload failed: ${upload.status}`);
      const attachment = await upload.json() as { fileName: string };
      const response = await fetch(`/api/attachments/${attachment.fileName}?thumbnail=1`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) return { status: response.status, type: response.headers.get('content-type'), bytes: 0, error: await response.text() };
      return { status: response.status, type: response.headers.get('content-type'), bytes: (await response.arrayBuffer()).byteLength, error: '' };
    }, Array.from(makePdf(['Packaged preview check'])));
    assert.equal(preview.status, 200, preview.error);
    assert.equal(preview.type, 'image/webp');
    assert(preview.bytes > 100);
    fixture.check('The packaged PDF preview uses the installation’s Node resolver.');
  });
}
void main().then(async () => { if (process.argv.includes('--gui')) await checkPackagedStartup(); })
  .catch(error => { console.error(error instanceof Error ? error.message : 'Reconnect check failed.'); process.exitCode = 1; });
