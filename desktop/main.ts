import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell, screen, clipboard } from 'electron';
import { fork, execFile, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline';
import { APP_NAME, PAIRING_TOKEN_FRAGMENT_KEY } from '../src/constants/app';
import { getConfigDir } from '../src/lib/config/paths';
import { demoEnvironment, type BackendMessage, type BackendReady } from './config';
import { certificateDecision, externalWebUrl, sameOrigin } from './trust';
import { installTerminalCommand, removeTerminalCommand, type CliInstallation } from './cli-install';
import { updateDesktop } from './shell-update';
import { parseDeepLink, resultLocation, watchOAuthResults } from './oauth-client';

const repo = app.isPackaged ? path.join(process.resourcesPath, 'server') : process.env.RI_DESKTOP_REPO || path.resolve(__dirname, '../..');
if (app.isPackaged) {
  const configFile = path.join(process.resourcesPath, 'desktop-config.json');
  if (fs.existsSync(configFile)) {
    const defaults = JSON.parse(fs.readFileSync(configFile, 'utf8')) as { callbackUrl?: string; relayProviders?: string };
    if (defaults.callbackUrl) process.env.RI_DESKTOP_OAUTH_RELAY_URL ||= defaults.callbackUrl;
    if (defaults.relayProviders) process.env.RI_DESKTOP_OAUTH_RELAY_PROVIDERS ||= defaults.relayProviders;
  }
  process.env.RI_DESKTOP_NODE = path.join(process.resourcesPath, 'node', 'bin', 'node');
  process.env.RI_DESKTOP_RESOURCES = process.resourcesPath;
  process.env.RI_DESKTOP_ROOT ||= path.join(app.getPath('appData'), APP_NAME, 'home');
  process.env.RI_DESKTOP_MODE = 'production';
}
const mode = process.env.RI_DESKTOP_MODE === 'development' ? 'development' : 'production';
const env = demoEnvironment(repo, process.env, mode);
for (const key of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR']) delete process.env[key];
Object.assign(process.env, env);
const profile = path.join(getConfigDir(), 'electron-demo');
fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
app.setName(app.isPackaged ? APP_NAME : `${APP_NAME} Demo`);
app.setPath('userData', profile);
let window: BrowserWindow | undefined;
let backend: ChildProcess | undefined;
let quitting = false;
let finished = false;
let exitCode = 0;
let startupTimer: ReturnType<typeof setTimeout> | undefined;
let appOrigin: string | undefined;
let appToken: string | undefined;
let installedRuntime: BackendReady['runtime'];
let preparingClose = false;
let closeGuard: { nonce: string; resolve: (ok: boolean) => void } | undefined;
let oauthAbort = new AbortController();
let navigating = false;
const pendingLinks: string[] = [];

async function handleDeepLink(raw: string) {
  const params = parseDeepLink(raw);
  if (!params) return;
  if (!appOrigin || !window) { if (pendingLinks.length < 8) pendingLinks.push(raw); return; }
  try {
    const response = await window.webContents.session.fetch(`${appOrigin}/api/desktop/oauth/complete`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${appToken}` }, body: params.toString(), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) console.info('[desktop] Sign-in link expired or belongs to another app instance. Start the connection again.');
  } catch { console.info('[desktop] Could not finish sign-in. Start the connection again.'); }
}

function cliInstallation(): CliInstallation {
  const runtimeRepo = installedRuntime?.repo ?? repo;
  return { node: installedRuntime?.node ?? process.env.RI_DESKTOP_NODE!, cli: path.join(runtimeRepo, 'dist/cli/index.mjs'), root: env.RI_DESKTOP_ROOT!, server: runtimeRepo, launcher: installedRuntime?.launcher };
}

async function manageTerminalCommand(remove = false) {
  const options = cliInstallation();
  const record = path.join(profile, 'terminal-command.json');
  try {
    if (remove) {
      if (!fs.existsSync(record)) throw new Error('No terminal command was installed by this app.');
      const installed = JSON.parse(fs.readFileSync(record, 'utf8')) as { target: string; options: CliInstallation };
      removeTerminalCommand(installed.target, installed.options);
      fs.unlinkSync(record);
      await dialog.showMessageBox({ message: 'Terminal command removed', detail: installed.target });
      return;
    }
    if (fs.existsSync(record)) throw new Error('Remove the existing desktop terminal command before installing another.');
    const selected = await dialog.showSaveDialog({ title: 'Install Ri terminal command', defaultPath: path.join(os.homedir(), '.local/bin/ri-desktop'), buttonLabel: 'Install command', nameFieldLabel: 'Command name' });
    if (selected.canceled || !selected.filePath) return;
    installTerminalCommand(selected.filePath, options);
    fs.writeFileSync(record, JSON.stringify({ target: selected.filePath, options }), { mode: 0o600 });
    await dialog.showMessageBox({ message: 'Terminal command installed', detail: `${selected.filePath}\n\nAdd ${path.dirname(selected.filePath)} to your shell PATH if it is not already there.` });
  } catch (error) { dialog.showErrorBox('Terminal command', error instanceof Error ? error.message : String(error)); }
}

async function serviceCommand(action: 'install' | 'uninstall' | 'start' | 'stop' | 'status') {
  if (!appOrigin || !window) return;
  const options = cliInstallation();
  if (action !== 'status' && !(await prepareClose())) return;
  try {
    const command = options.launcher ?? options.node;
    const args = options.launcher ? ['cli', 'service', action] : [options.cli, 'service', action];
    const output = await new Promise<string>((resolve, reject) => execFile(command, args, { env, timeout: 240_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout)));
    if (action === 'status') {
      const result = await dialog.showMessageBox(window, { message: 'Ri service', detail: output, buttons: ['Close', 'Copy diagnostics'] });
      if (result.response === 1) clipboard.writeText(JSON.stringify({ desktop: app.getVersion(), electron: process.versions.electron, platform: process.platform, arch: process.arch, service: JSON.parse(output) }, null, 2));
    } else await dialog.showMessageBox(window, { message: action === 'install' ? 'Start at login enabled' : action === 'uninstall' ? 'Start at login disabled' : action === 'start' ? 'Service started' : 'Service stopped', detail: output.trim() });
  } catch (error) { dialog.showErrorBox('Ri service', error instanceof Error ? error.message : String(error)); }
  finally { window?.webContents.send('desktop:resume'); }
}

function stopTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}

async function prepareClose(): Promise<boolean> {
  if (!window || window.isDestroyed() || !appOrigin || !sameOrigin(window.webContents.getURL(), appOrigin)) return true;
  const ok = await new Promise<boolean>(resolve => {
    const nonce = randomUUID();
    const timer = setTimeout(() => { closeGuard = undefined; resolve(false); }, 15_000);
    closeGuard = { nonce, resolve: result => { clearTimeout(timer); closeGuard = undefined; resolve(result); } };
    window!.webContents.send('desktop:prepare-close', nonce);
  });
  if (ok) return true;
  const result = await dialog.showMessageBox(window, {
    type: 'warning', message: 'Some changes have not finished saving',
    detail: 'Keep Ri open to retry. If you quit, retained text drafts can be recovered when you reopen. Finish any recording or upload before closing.',
    buttons: ['Keep open', 'Quit anyway'], defaultId: 0, cancelId: 0,
  });
  if (result.response !== 1) window?.webContents.send('desktop:resume');
  return result.response === 1;
}

async function quit(skipGuard = false) {
  if (quitting || preparingClose) return;
  preparingClose = true;
  if (!skipGuard && !(await prepareClose())) { preparingClose = false; return; }
  preparingClose = false;
  quitting = true;
  oauthAbort.abort();
  clearTimeout(startupTimer);
  if (backend && backend.exitCode === null && backend.signalCode === null) {
    const exited = once(backend, 'exit');
    if (backend.connected) backend.send({ type: 'stop' });
    const force = setTimeout(() => stopTree(backend!), 10_000);
    await exited.catch(() => {});
    clearTimeout(force);
  }
  finished = true;
  // Keep the native window alive until the helper exits. On macOS, destroying
  // the last window during app.quit can suspend delivery of child exit events.
  window?.destroy();
  app.exit(exitCode);
}

function fail(message: string) {
  if (quitting) return;
  console.error(`[desktop] ${message}`);
  // Automation must report failure instead of hanging on a modal dialog.
  if (!process.env.RI_DESKTOP_SMOKE) dialog.showErrorBox(`${APP_NAME} could not start`, message);
  exitCode = 1;
  void quit(true);
}

async function navigateSafely(url: string) {
  if (navigating || quitting || !window) return;
  navigating = true;
  try {
    if (await prepareClose()) await window.loadURL(url);
  } catch { window?.webContents.send('desktop:resume'); }
  finally { navigating = false; }
}

async function openApp(ready: BackendReady) {
  const reconnecting = appOrigin === ready.origin;
  if (appOrigin && !reconnecting && !(await prepareClose())) return;
  oauthAbort.abort(); oauthAbort = new AbortController();
  installedRuntime = ready.runtime;
  appToken = ready.token;
  clearTimeout(startupTimer);
  const ses = window!.webContents.session;
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    for (const key of Object.keys(headers)) if (key.toLowerCase() === 'x-ri-desktop-client') delete headers[key];
    if (ready.desktopClient && details.webContentsId === window?.webContents.id &&
        details.frame === window?.webContents.mainFrame && sameOrigin(details.url, ready.origin) &&
        details.initiatorOrigin === ready.origin) headers['x-ri-desktop-client'] = ready.desktopClient;
    callback({ requestHeaders: headers });
  });
  ses.setCertificateVerifyProc((request, callback) => {
    callback(certificateDecision(request.hostname, request.certificate.data, ready));
  });
  // Both hooks are needed. Frame URL validation prevents an embedded preview
  // from inheriting the main app's microphone or clipboard permission.
  const allowed = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen']);
  ses.setPermissionCheckHandler((_contents, permission, origin, details) =>
    allowed.has(permission) && sameOrigin(details?.requestingUrl || origin, ready.origin));
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(allowed.has(permission) && sameOrigin(details.requestingUrl, ready.origin));
  });
  const openExternal = (url: string) => {
    const safe = externalWebUrl(url);
    if (safe) void shell.openExternal(safe).catch(() => {});
  };
  window!.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url, ready.origin)) void navigateSafely(url);
    else openExternal(url);
    return { action: 'deny' };
  });
  window!.webContents.removeAllListeners('will-navigate');
  window!.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (sameOrigin(url, ready.origin)) void navigateSafely(url);
    else openExternal(url);
  });
  // Establish the existing cookie before the first page mounts SSE/images.
  const response = await ses.fetch(`${ready.origin}/api/session`, { method: 'POST', headers: { authorization: `Bearer ${ready.token}` } });
  if (!response.ok) throw new Error('The local app rejected its desktop session.');
  await response.text();
  appOrigin = ready.origin;
  // Refresh credentials immediately after controller replacement, even while
  // a recording or unsaved draft delays reload. The renderer's connection
  // observer reloads the current route only when its input is safe.
  if (!reconnecting) await window!.loadURL(`${ready.origin}/#${PAIRING_TOKEN_FRAGMENT_KEY}=${encodeURIComponent(ready.token)}`);
  const cursorFile = path.join(profile, 'oauth-cursor.json');
  let cursor = 0;
  try {
    const saved = JSON.parse(fs.readFileSync(cursorFile, 'utf8'));
    if (ready.serviceRunId && saved.runId === ready.serviceRunId && Number.isSafeInteger(saved.sequence)) cursor = saved.sequence;
  } catch { /* first connection to this service */ }
  void watchOAuthResults(ses, ready.origin, oauthAbort.signal, (result) => {
    if (quitting || !window) return;
    fs.writeFileSync(`${cursorFile}.tmp`, JSON.stringify({ runId: ready.serviceRunId, sequence: result.sequence }), { mode: 0o600 });
    fs.renameSync(`${cursorFile}.tmp`, cursorFile);
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    void navigateSafely(resultLocation(ready.origin, result));
  }, cursor);
  for (const raw of pendingLinks.splice(0)) void handleDeepLink(raw);
  console.info('[desktop] App loaded. The local certificate is pinned inside this Electron session only.');
}

async function start() {
  await app.whenReady();
  const icon = nativeImage.createFromPath(path.join(repo, 'public/brand/ri-desktop-icon.png'));
  app.dock?.setIcon(icon);
  const ses = session.fromPartition('persist:ri-desktop-demo');
  let bounds: { x?: number; y?: number; width: number; height: number } = { width: 1440, height: 980 };
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'window.json'), 'utf8'));
    if (['x', 'y', 'width', 'height'].every(key => Number.isFinite(saved[key])) && saved.width >= 800 && saved.height >= 600 &&
        screen.getAllDisplays().some(display => saved.x + 100 > display.workArea.x && saved.x < display.workArea.x + display.workArea.width && saved.y + 50 > display.workArea.y && saved.y < display.workArea.y + display.workArea.height)) bounds = saved;
  } catch { /* first window or disconnected display */ }
  window = new BrowserWindow({ ...bounds, minWidth: 800, minHeight: 600, title: APP_NAME, icon,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 12 } } : {}),
    backgroundColor: '#181a18', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false } });
  let boundsTimer: ReturnType<typeof setTimeout> | undefined;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!window || window.isDestroyed() || window.isMinimized() || window.isMaximized()) return;
      fs.writeFileSync(path.join(profile, 'window.json.tmp'), JSON.stringify(window.getBounds()), { mode: 0o600 });
      fs.renameSync(path.join(profile, 'window.json.tmp'), path.join(profile, 'window.json'));
    }, 500);
  };
  window.on('resize', saveBounds); window.on('move', saveBounds);
  window.webContents.on('render-process-gone', async (_event, details) => {
    if (quitting || details.reason === 'clean-exit') return;
    const result = await dialog.showMessageBox({ type: 'error', message: 'Ri’s window stopped responding', detail: 'The background service is still independent. Reload to recover retained drafts.', buttons: ['Reload', 'Close'], defaultId: 0 });
    if (result.response === 0 && appOrigin) await window?.loadURL(appOrigin);
    else void quit(true);
  });
  window.on('close', event => { if (!quitting) { event.preventDefault(); void quit(); } });
  ipcMain.on('desktop:prepared', (event, message: unknown) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !appOrigin || !sameOrigin(event.senderFrame.url, appOrigin)) return;
    if (!message || typeof message !== 'object') return;
    const reply = message as { nonce?: unknown; ok?: unknown };
    if (reply.nonce === closeGuard?.nonce) closeGuard?.resolve(reply.ok === true);
  });
  ipcMain.handle('desktop:open-external', async (event, raw: unknown) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !appOrigin || !sameOrigin(event.senderFrame.url, appOrigin)) throw new Error('Untrusted window');
    const url = typeof raw === 'string' ? externalWebUrl(raw) : null;
    if (!url) throw new Error('Invalid web address');
    await shell.openExternal(url);
  });
  const logo = fs.readFileSync(path.join(repo, 'public/brand/ri-mark-white.svg'), 'utf8');
  const loading = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"></head><body style="margin:0;background:#181a18;color:#f5f2ea;display:grid;place-items:center;height:100vh;font:15px system-ui"><div style="text-align:center"><img alt="${APP_NAME}" width="64" src="data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}"><p>Starting ${APP_NAME}</p><p style="color:#aeb3aa">Preparing your local app…</p></div></body></html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loading)}`);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : [{ label: 'App', submenu: [{ role: 'quit' as const }] }]),
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    { label: 'Tools', submenu: [
      { label: 'Check for Desktop Update…', click: () => { if (window) void updateDesktop(window, prepareClose, async () => {
        quitting = true; finished = true; oauthAbort.abort();
        if (backend?.connected) backend.send({ type: 'stop' });
      }); } },
      { label: 'Service Status…', click: () => void serviceCommand('status') },
      { label: 'Start at Login…', click: () => void serviceCommand('install') },
      { label: 'Disable Start at Login…', click: () => void serviceCommand('uninstall') },
      { label: 'Start Service', click: () => void serviceCommand('start') },
      { label: 'Stop Service', click: () => void serviceCommand('stop') },
      { type: 'separator' },
      { label: 'Install Terminal Command…', click: () => void manageTerminalCommand() },
      { label: 'Remove Terminal Command…', click: () => void manageTerminalCommand(true) },
    ] },
  ]));
  if (!process.env.RI_DESKTOP_NODE || process.env.RI_DESKTOP_NODE === process.execPath) {
    throw new Error('Launch with pnpm desktop:demo or pnpm desktop:dev so the backend uses ordinary Node.');
  }
  backend = fork(path.join(repo, 'dist/desktop/backend.cjs'), [], { cwd: repo, execPath: process.env.RI_DESKTOP_NODE,
    execArgv: [], env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  // Next prints its browser pairing URL at boot. Desktop pairing happens over
  // private IPC, so avoid copying that credential into terminal/test logs.
  for (const [input, output] of [[backend.stdout, process.stdout], [backend.stderr, process.stderr]] as const) {
    if (input) createInterface({ input }).on('line', (line) => {
      output.write(line.replace(new RegExp(`#${PAIRING_TOKEN_FRAGMENT_KEY}=[^\\s]+`, 'g'), '#[pairing token redacted]') + '\n');
    });
  }
  backend.on('message', (message: BackendMessage) => {
    if (message.type === 'certificate' && window && message.origin === appOrigin) window.webContents.session.setCertificateVerifyProc((request, callback) => callback(certificateDecision(request.hostname, request.certificate.data, message)));
    if (message.type === 'error') fail(message.message);
    if (message.type === 'ready') void openApp(message).catch(() => fail('Could not load the local app. Check the backend output and relaunch the demo.'));
  });
  backend.once('error', (error) => fail(error.message));
  backend.once('exit', (code) => { if (!quitting) fail(`The local backend stopped (${code ?? 'signal'}). Relaunch the demo.`); });
  startupTimer = setTimeout(() => fail('The app did not finish starting within four minutes. Check the backend output and retry.'), 240_000);
}

app.on('before-quit', (event) => { if (!finished) { event.preventDefault(); void quit(); } });
app.on('window-all-closed', () => void quit());
process.once('SIGINT', () => void quit());
process.once('SIGTERM', () => void quit());
app.on('open-url', (event, url) => { event.preventDefault(); void handleDeepLink(url); });
if (app.isPackaged && process.platform !== 'darwin') app.setAsDefaultProtocolClient('ri');
for (const arg of process.argv) if (arg.startsWith('ri://')) void handleDeepLink(arg);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    for (const arg of argv) if (arg.startsWith('ri://')) void handleDeepLink(arg);
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  void start().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
