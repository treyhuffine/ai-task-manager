/** Disposable, local-only desktop audit. Prints outcomes, never credentials. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { demoEnvironment } from './config';
import { ensureGeneratedTls } from '../src/lib/config/tls';

const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(repo, '.electron-demo/audit-'));
const packaged = path.resolve(process.env.RI_DESKTOP_PACKAGE ?? 'release/Ri-darwin-arm64/Ri.app');
const env = demoEnvironment(repo, { ...process.env, RI_DESKTOP_ROOT: root }, 'production');
Object.assign(process.env, env);
const results: Record<string, unknown> = { root, packaged };
let app: ElectronApplication | undefined;
const servers: net.Server[] = [];
async function start() {
  app = await _electron.launch({ executablePath: path.join(packaged, 'Contents/MacOS/Ri'), args: [], cwd: os.tmpdir(),
    env: { ...env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', RI_DESKTOP_SMOKE: '1' }, timeout: 240_000 });
  const page = await app.firstWindow();
  await page.waitForURL(url => url.protocol === 'https:' && url.pathname === '/welcome', { timeout: 240_000 });
  await page.getByText('Welcome to Ri', { exact: true }).waitFor();
  return page;
}
async function listen(server: net.Server) {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as net.AddressInfo).port;
}
async function embed(page: Page, url: string) {
  await page.evaluate(url => new Promise<void>((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.id = 'audit-preview';
    frame.sandbox.value = 'allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-same-origin';
    const timer = setTimeout(() => reject(new Error('Preview load timeout')), 15_000);
    frame.onload = () => { clearTimeout(timer); resolve(); };
    frame.src = url;
    document.body.append(frame);
  }), url);
}
async function main() {
  try {
    let page = await start();
    const origin = new URL(page.url()).origin;
    results.initialOrigin = origin;
    results.webCapabilities = await page.evaluate(() => ({ serviceWorker: 'serviceWorker' in navigator,
      pushManager: 'PushManager' in window, notification: 'Notification' in window,
      mediaDevices: !!navigator.mediaDevices, webmOpus: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') }));
    const note = await page.evaluate(async () => {
      const response = await fetch('/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Audit original title', body: 'Audit original body' }) });
      return (await response.json()).id as string;
    });
    assert(note);
    let plainCookie = false;
    let plainDone = false;
    const plainPort = await listen(http.createServer((req, res) => {
      plainCookie ||= /(?:^|;\s*)ri_session=/.test(req.headers.cookie ?? '');
      if (req.url === '/done') { plainDone = true; res.end('ok'); return; }
      res.setHeader('content-type', 'text/html');
      res.end(`<script>fetch(${JSON.stringify(origin + '/api/notes')},{method:'POST',mode:'no-cors',credentials:'include',headers:{'Content-Type':'text/plain'},body:JSON.stringify({body:'AUDIT plain HTTP cross-origin fixture'})}).then(()=>fetch('/done')).catch(()=>fetch('/done'))</script>`);
    }));
    await embed(page, `http://localhost:${plainPort}/`);
    for (let i = 0; i < 100 && !plainDone; i++) await new Promise(resolve => setTimeout(resolve, 50));
    results.httpPreviewReceivedSessionCookie = plainCookie;
    results.httpPreviewCrossOriginMutationSucceeded = await page.evaluate(async () => JSON.stringify(await (await fetch('/api/notes')).json()).includes('AUDIT plain HTTP cross-origin fixture'));
    await page.locator('#audit-preview').evaluate(el => el.remove());
    const tls = await ensureGeneratedTls();
    let tlsCookie = false;
    let csrfDone = false;
    const tlsPort = await listen(https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
      tlsCookie ||= /(?:^|;\s*)ri_session=/.test(req.headers.cookie ?? '');
      if (req.url === '/done') { csrfDone = true; res.end('ok'); return; }
      res.setHeader('content-type', 'text/html');
      res.end(`<script>fetch(${JSON.stringify(origin + '/api/notes')},{method:'POST',mode:'no-cors',credentials:'include',headers:{'Content-Type':'text/plain'},body:JSON.stringify({body:'AUDIT cross-origin fixture'})}).then(()=>fetch('/done'))</script>`);
    }));
    await embed(page, `https://localhost:${tlsPort}/`);
    for (let i = 0; i < 100 && !csrfDone; i++) await new Promise(resolve => setTimeout(resolve, 50));
    results.httpsPreviewReceivedSessionCookie = tlsCookie;
    results.crossOriginMutationSucceeded = await page.evaluate(async () => {
      const notes = await (await fetch('/api/notes')).json();
      return JSON.stringify(notes).includes('AUDIT cross-origin fixture');
    });
    await page.locator('#audit-preview').evaluate(el => el.remove());
    // A benign SVG marker demonstrates script execution without reading secrets.
    const attachment = await page.evaluate(async () => {
      const form = new FormData();
      form.append('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>document.documentElement.setAttribute("data-audit-script", "executed");fetch("/api/user-state").then(r=>document.documentElement.setAttribute("data-audit-api",String(r.status)))</script></svg>'], { type: 'image/svg+xml' }), 'audit.svg');
      return (await (await fetch('/api/attachments', { method: 'POST', body: form })).json()).fileName as string;
    });
    assert(attachment);
    await page.goto(`${origin}/api/attachments/${attachment}`);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-audit-api'), undefined, { timeout: 10_000 });
    results.uploadedSvgScriptRan = await page.locator('svg').getAttribute('data-audit-script');
    results.uploadedSvgAuthenticatedApiStatus = await page.locator('svg').getAttribute('data-audit-api');
    await page.goto(`${origin}/welcome`);
    // Exercise real packaged Git folder endpoints under a Finder-like PATH.
    const folder = path.join(root, 'fixture-git'); fs.mkdirSync(folder);
    const git = (args: string[]) => execFileSync('/usr/bin/git', args, { cwd: folder, env: { ...process.env,
      GIT_AUTHOR_NAME: 'Audit', GIT_AUTHOR_EMAIL: 'audit@example.invalid', GIT_COMMITTER_NAME: 'Audit', GIT_COMMITTER_EMAIL: 'audit@example.invalid' }, stdio: 'pipe' });
    git(['init', '-b', 'main']); fs.writeFileSync(path.join(folder, 'tracked.txt'), 'committed\n');
    git(['add', '.']); git(['commit', '-m', 'Audit fixture']); fs.writeFileSync(path.join(folder, 'tracked.txt'), 'edited\n');
    results.packagedGit = await page.evaluate(async cwd => {
      const response = await fetch('/api/workspaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Audit Git', cwd }) });
      const workspace = await response.json();
      const tree = await fetch(`/api/workspaces/${workspace.id}/tree`);
      const file = await fetch(`/api/workspaces/${workspace.id}/file?path=tracked.txt`);
      return { createStatus: response.status, treeStatus: tree.status, fileStatus: file.status, file: await file.json() };
    }, folder);
    await page.evaluate(async () => fetch('/api/user-state', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ onboardedAt: new Date().toISOString() }) }));
    await page.goto(`${origin}/note/${note}`);
    const noteWrites: unknown[] = [];
    page.on('request', request => {
      if (request.url().includes(`/api/notes/${note}`) && request.method() === 'PATCH') noteWrites.push(request.postDataJSON());
    });
    results.noteWrites = noteWrites;
    const title = page.locator('textarea.note-title');
    if (!await title.count()) {
      const editorButton = page.getByRole('button', { name: /document|editor/i });
      if (await editorButton.count()) await editorButton.first().click();
    }
    await title.waitFor();
    // Verify the editor does persist given enough time, before testing quick quit.
    await title.fill('Audit persisted control');
    for (let i = 0; i < 50; i++) {
      if (await page.evaluate(async id => (await (await fetch(`/api/notes/${id}`, { cache: 'no-store' })).json()).title === 'Audit persisted control', note)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    results.titleBeforeQuitTest = await page.evaluate(async id => (await (await fetch(`/api/notes/${id}`)).json()).title, note);
    assert.equal(results.titleBeforeQuitTest, 'Audit persisted control', 'Editor control did not persist');
    await page.evaluate(async () => {
      localStorage.setItem('desktop-audit-origin-marker', 'present');
      await fetch('/api/user-state', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ onboardedAt: null }) });
    });
    const before = Date.now();
    await title.fill('Audit last keystrokes before quit');
    await app!.evaluate(({ app }) => app.quit());
    if (app!.process().exitCode === null) await once(app!.process(), 'exit');
    results.quitMilliseconds = Date.now() - before;
    app = undefined;
    // Force the app's fallback port. No production listener is touched.
    const occupied = net.createServer(socket => socket.destroy());
    servers.push(occupied); occupied.listen(Number(new URL(origin).port), '127.0.0.1'); await once(occupied, 'listening');
    page = await start();
    results.relaunchOrigin = new URL(page.url()).origin;
    results.localStorageMarkerAfterPortChange = await page.evaluate(() => localStorage.getItem('desktop-audit-origin-marker'));
    results.titleAfterImmediateQuit = await page.evaluate(async id => (await (await fetch(`/api/notes/${id}`)).json()).title, note);
    fs.writeFileSync(path.join(repo, '.electron-demo/audit-results.json'), JSON.stringify(results, null, 2));
    console.info(JSON.stringify(results, null, 2));
  } finally {
    await app?.close().catch(() => {});
    for (const server of servers) { if ('closeAllConnections' in server) (server as http.Server).closeAllConnections(); server.close(); }
  }
}
void main().catch(error => { console.error(error); console.info(JSON.stringify(results, null, 2)); process.exitCode = 1; });
