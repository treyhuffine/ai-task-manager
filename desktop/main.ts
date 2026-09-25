import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell } from 'electron';
import { fork, execFile, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline';
import { APP_NAME, PAIRING_TOKEN_FRAGMENT_KEY } from '../src/constants/app';
import { getConfigDir } from '../src/lib/config/paths';
import { demoEnvironment, type BackendMessage, type BackendReady } from './config';
import { certificateDecision, externalWebUrl, sameOrigin } from './trust';
import { installTerminalCommand, removeTerminalCommand, type CliInstallation } from './cli-install';
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
const oauthAbort = new AbortController();
const pendingLinks: string[] = [];

async function handleDeepLink(raw: string) {
  const params = parseDeepLink(raw);
  if (!params) return;
  if (!appOrigin || !window) { if (pendingLinks.length < 8) pendingLinks.push(raw); return; }
  try {
    const response = await window.webContents.session.fetch(`${appOrigin}/api/desktop/oauth/complete`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString(), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) console.info('[desktop] Sign-in link expired or belongs to another app instance. Start the connection again.');
  } catch { console.info('[desktop] Could not finish sign-in. Start the connection again.'); }
}

function cliInstallation(): CliInstallation {
  return { node: process.env.RI_DESKTOP_NODE!, cli: path.join(repo, 'dist/cli/index.mjs'), root: env.RI_DESKTOP_ROOT!, server: repo };
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

function stopTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}

async function quit() {
  if (quitting) return;
  quitting = true;
  oauthAbort.abort();
  clearTimeout(startupTimer);
  window?.destroy();
  if (backend && backend.exitCode === null && backend.signalCode === null) {
    const exited = once(backend, 'exit');
    if (backend.connected) backend.send({ type: 'stop' });
    const force = setTimeout(() => stopTree(backend!), 10_000);
    await exited.catch(() => {});
    clearTimeout(force);
  }
  finished = true;
  app.exit(exitCode);
}

function fail(message: string) {
  if (quitting) return;
  console.error(`[desktop] ${message}`);
  // Automation must report failure instead of hanging on a modal dialog.
  if (!process.env.RI_DESKTOP_SMOKE) dialog.showErrorBox(`${APP_NAME} could not start`, message);
  exitCode = 1;
  void quit();
}

async function openApp(ready: BackendReady) {
  clearTimeout(startupTimer);
  const ses = window!.webContents.session;
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
    if (sameOrigin(url, ready.origin)) void window?.loadURL(url);
    else openExternal(url);
    return { action: 'deny' };
  });
  window!.webContents.on('will-navigate', (event, url) => {
    if (!sameOrigin(url, ready.origin)) { event.preventDefault(); openExternal(url); }
  });
  // Establish the existing cookie before the first page mounts SSE/images.
  const response = await ses.fetch(`${ready.origin}/api/session`, { method: 'POST', headers: { authorization: `Bearer ${ready.token}` } });
  if (!response.ok) throw new Error('The local app rejected its desktop session.');
  await response.text();
  appOrigin = ready.origin;
  void watchOAuthResults(ses, ready.origin, oauthAbort.signal, (result) => {
    if (quitting || !window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    void window.loadURL(resultLocation(ready.origin, result)).catch(() => {});
  });
  await window!.loadURL(`${ready.origin}/#${PAIRING_TOKEN_FRAGMENT_KEY}=${encodeURIComponent(ready.token)}`);
  for (const raw of pendingLinks.splice(0)) void handleDeepLink(raw);
  console.info('[desktop] App loaded. The local certificate is pinned inside this Electron session only.');
}

async function start() {
  await app.whenReady();
  const icon = nativeImage.createFromPath(path.join(repo, 'public/brand/ri-desktop-icon.png'));
  app.dock?.setIcon(icon);
  const ses = session.fromPartition('persist:ri-desktop-demo');
  window = new BrowserWindow({ width: 1440, height: 980, minWidth: 800, minHeight: 600, title: APP_NAME, icon,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 12 } } : {}),
    backgroundColor: '#181a18', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false } });
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
