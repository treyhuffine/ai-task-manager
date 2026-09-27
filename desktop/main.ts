import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, session, shell, screen, clipboard } from 'electron';
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
import { certificateDecision, desktopRequestHeaders, externalWebUrl, sameOrigin } from './trust';
import { installTerminalCommand, removeTerminalCommand, type CliInstallation } from './cli-install';
import { updateDesktop } from './shell-update';
import { parseDeepLink, resultLocation, watchOAuthResults } from './oauth-client';
import { servicePaths } from '../src/lib/service/paths';
import { serviceRequest, serviceStatus } from '../src/lib/service/client';
import { redactServiceLine } from '../src/lib/service/logging';
import { assertExistingInstallation, installationEnvironment, localInstallation, readInstallation, saveInstallation, type InstallationInspection } from './installation';
import { maintenanceWindow } from './maintenance-window';
import { DesktopNotifications } from './notifications';
import type { DesktopNotificationAction } from '../src/lib/notifications/desktop-contract';

const repo = app.isPackaged ? path.join(process.resourcesPath, 'server') : process.env.RI_DESKTOP_REPO || path.resolve(__dirname, '../..');
// An explicit state directory isolates saved installation choices as well as
// the default home. Useful for portable/test launches without OS-global state.
const desktopState = path.resolve(process.env.RI_DESKTOP_STATE_DIR || (app.isPackaged ? path.join(app.getPath('appData'), APP_NAME) : path.join(repo, '.electron-demo')));
const installationFile = path.join(desktopState, app.isPackaged ? 'desktop-installation.json' : 'installation.json');
const defaultDesktopRoot = path.join(desktopState, 'home');
const useSavedInstallation = process.argv.includes('--ri-use-saved-installation');
const useDefaultInstallation = process.argv.includes('--ri-default-installation');
let selectionError: string | undefined;
let selectionInvalid = false;
if (useSavedInstallation || useDefaultInstallation) {
  for (const key of ['RI_DESKTOP_ROOT', 'RI_DESKTOP_DATABASE', 'RI_DESKTOP_CONFIG', 'RI_DESKTOP_WORK', 'RI_DESKTOP_ASSOCIATED']) delete process.env[key];
}
if (!useDefaultInstallation && (!process.env.RI_DESKTOP_ROOT || useSavedInstallation)) {
  try { const selected = readInstallation(installationFile); if (selected) Object.assign(process.env, installationEnvironment(selected)); }
  catch (error) { selectionInvalid = true; selectionError = error instanceof Error ? error.message : 'Could not read the selected installation.'; }
}
if (app.isPackaged) {
  const configFile = path.join(process.resourcesPath, 'desktop-config.json');
  if (fs.existsSync(configFile)) {
    const defaults = JSON.parse(fs.readFileSync(configFile, 'utf8')) as { callbackUrl?: string; relayProviders?: string };
    if (defaults.callbackUrl) process.env.RI_DESKTOP_OAUTH_RELAY_URL ||= defaults.callbackUrl;
    if (defaults.relayProviders) process.env.RI_DESKTOP_OAUTH_RELAY_PROVIDERS ||= defaults.relayProviders;
  }
  process.env.RI_DESKTOP_NODE = path.join(process.resourcesPath, 'node', 'bin', 'node');
  process.env.RI_DESKTOP_RESOURCES = process.resourcesPath;
  process.env.RI_DESKTOP_ROOT ||= defaultDesktopRoot;
  process.env.RI_DESKTOP_MODE = 'production';
}
const mode = process.env.RI_DESKTOP_MODE === 'development' ? 'development' : 'production';
const env = demoEnvironment(repo, process.env, mode);
for (const key of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR']) delete process.env[key];
Object.assign(process.env, env);
const identity = servicePaths().identity;
const defaults = localInstallation({ root: identity.root });
const advanced = ['database', 'config', 'work'].some(key => identity[key as keyof typeof identity] !== defaults[key as keyof typeof defaults]);
let profile = path.join(getConfigDir(), 'electron-demo', ...(advanced ? [servicePaths().id] : []));
try {
  // The ordinary Node inspector decides whether a missing DB has a valid
  // first-initialization permit. This pass only establishes a safe profile.
  if (process.env.RI_DESKTOP_ASSOCIATED === '1') assertExistingInstallation(identity, { allowMissingDatabase: true });
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
} catch (error) {
  selectionInvalid = true;
  selectionError = error instanceof Error ? error.message : 'The selected installation profile cannot be opened.';
  profile = path.join(path.dirname(installationFile), 'recovery-profile');
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
}
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
let notifications: DesktopNotifications | undefined;
let notificationAbort = new AbortController();
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
  if (selectionInvalid || !installedRuntime) throw new Error('This service does not report its runtime executable. Use its existing CLI to manage it. No bundled runtime was adopted.');
  const runtimeRepo = installedRuntime.repo;
  return { node: installedRuntime.node, cli: path.join(runtimeRepo, 'dist/cli/index.mjs'), root: env.RI_DESKTOP_ROOT!, server: runtimeRepo, launcher: installedRuntime.launcher, locations: servicePaths().identity };
}

async function inspectInstallation(value: unknown): Promise<InstallationInspection> {
  const identity = localInstallation(value);
  const inspectEnv = demoEnvironment(repo, { ...env, ...installationEnvironment(identity) }, mode);
  return new Promise((resolve, reject) => execFile(process.env.RI_DESKTOP_NODE!, [path.join(repo, 'dist/desktop/inspect-installation.cjs')],
    { env: inspectEnv, timeout: 15_000, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Could not verify this installation.')); } }
    }));
}

async function diagnostics() {
  let connectionError: string | undefined;
  const status = await serviceStatus().catch(error => { connectionError = error instanceof Error ? error.message : 'Service status is unavailable.'; return null; });
  const safe = status as typeof status & { update?: { phase: string; reason?: string; error?: string; release?: { version: string } } };
  return { desktop: app.getVersion(), platform: process.platform, arch: process.arch, identity: servicePaths().identity,
    phase: status?.phase ?? (connectionError ? 'unreachable' : 'stopped'), version: status?.version,
    failure: redactServiceLine(selectionError ?? connectionError ?? status?.error ?? '', [appToken ?? '']),
    update: safe?.update && { phase: safe.update.phase, version: safe.update.release?.version,
      reason: redactServiceLine(safe.update.reason ?? '', [appToken ?? '']), error: redactServiceLine(safe.update.error ?? '', [appToken ?? '']) } };
}

async function detachConnection() {
  const child = backend;
  backend = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  if (child.connected) child.send({ type: 'stop' }); else child.kill('SIGTERM');
  const timeout = setTimeout(() => stopTree(child), 10_000);
  try { await exited; } finally { clearTimeout(timeout); }
}

async function retryConnection() {
  if (selectionInvalid) throw new Error('Choose and verify an installation before retrying. The saved selection could not be opened.');
  const status = await serviceStatus();
  if (status?.phase === 'failed') throw new Error('The service needs recovery before it can restart.');
  selectionError = undefined;
  await detachConnection();
  startConnection();
  return {};
}

async function switchInstallation(value?: unknown) {
  const inspected = value === undefined ? undefined : await inspectInstallation(value);
  if (inspected && !inspected.canUse) throw new Error(inspected.reason ?? 'This installation is not ready.');
  const identity = inspected?.identity ?? localInstallation({ root: defaultDesktopRoot });
  const choice = await dialog.showMessageBox({ type: 'question', message: 'Use this local installation?',
    detail: `Data: ${identity.root}\nDatabase: ${identity.database}\nConfiguration: ${identity.config}\nWork: ${identity.work}\n\nRi will save this window and restart it. Existing services and files stay in place.`,
    buttons: ['Cancel', 'Use installation'], defaultId: 0, cancelId: 0 });
  if (choice.response !== 1 || !(await prepareClose())) return {};
  try {
    // Recheck after the dialog, since a service or migration may have changed.
    if (inspected && !(await inspectInstallation(inspected.identity)).canUse) throw new Error('The installation changed. Verify it again before switching.');
    if (inspected) saveInstallation(installationFile, identity);
    else fs.rmSync(installationFile, { force: true });
    const args = process.argv.slice(1).filter(arg => !['--ri-use-saved-installation', '--ri-default-installation'].includes(arg));
    app.relaunch({ args: [...args, inspected ? '--ri-use-saved-installation' : '--ri-default-installation'] });
    await quit(true);
  } catch (error) { if (!quitting) window?.webContents.send('desktop:resume'); throw error; }
  return {};
}

const maintenance = maintenanceWindow({
  status: diagnostics,
  retry: retryConnection,
  recover: async () => {
    const status = await serviceStatus();
    if (status?.phase !== 'failed') throw new Error('Recovery is available only for a stopped, failed backend.');
    const choice = await dialog.showMessageBox({ type: 'warning', message: 'Recover the background service?',
      detail: 'Ri follows the saved update record and preserves any database that already accepted new writes. Recovery never forces active work to stop. If the problem remains, inspect the log before retrying.',
      buttons: ['Cancel', 'Recover'], defaultId: 0, cancelId: 0 });
    if (choice.response !== 1) return {};
    await serviceRequest('/recover', 'POST', 120_000);
    const deadline = Date.now() + 30_000;
    while (await serviceStatus()) {
      if (Date.now() >= deadline) throw new Error('The recovering service is still stopping. Refresh its status before retrying.');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return retryConnection();
  },
  logs: async () => {
    const log = servicePaths().log;
    if (!fs.existsSync(log)) throw new Error('No service log exists yet.');
    shell.showItemInFolder(log);
    return {};
  },
  copy: async () => { clipboard.writeText(JSON.stringify(await diagnostics(), null, 2)); return {}; },
  inspect: inspectInstallation,
  use: switchInstallation,
  default: () => switchInstallation(),
});

async function manageTerminalCommand(remove = false) {
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
    const options = cliInstallation();
    if (fs.existsSync(record)) throw new Error('Remove the existing desktop terminal command before installing another.');
    const selected = await dialog.showSaveDialog({ title: 'Install Ri terminal command', defaultPath: path.join(os.homedir(), '.local/bin/ri-desktop'), buttonLabel: 'Install command', nameFieldLabel: 'Command name' });
    if (selected.canceled || !selected.filePath) return;
    installTerminalCommand(selected.filePath, options);
    fs.writeFileSync(record, JSON.stringify({ target: selected.filePath, options }), { mode: 0o600 });
    await dialog.showMessageBox({ message: 'Terminal command installed', detail: `${selected.filePath}\n\nAdd ${path.dirname(selected.filePath)} to your shell PATH if it is not already there.` });
  } catch (error) { dialog.showErrorBox('Terminal command', error instanceof Error ? error.message : String(error)); }
}

async function serviceCommand(action: 'install' | 'uninstall' | 'start' | 'stop' | 'status') {
  if (!window) return;
  if (action !== 'status' && !(await prepareClose())) return;
  try {
    if (action === 'status') {
      const output = JSON.stringify(await diagnostics(), null, 2);
      const result = await dialog.showMessageBox(window, { message: 'Ri service', detail: output, buttons: ['Close', 'Copy diagnostics'] });
      if (result.response === 1) clipboard.writeText(output);
      return;
    }
    const options = cliInstallation();
    if (action === 'install' && !options.launcher) throw new Error('Start at login requires an explicitly staged managed runtime. Use this installation’s existing CLI to adopt one first.');
    const command = options.launcher ?? options.node;
    const args = options.launcher ? ['cli', 'service', action] : [options.cli, 'service', action];
    const output = await new Promise<string>((resolve, reject) => execFile(command, args, { env, timeout: 240_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout)));
    await dialog.showMessageBox(window, { message: action === 'install' ? 'Start at login enabled' : action === 'uninstall' ? 'Start at login disabled' : action === 'start' ? 'Service started' : 'Service stopped', detail: output.trim() });
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
  notifications?.stop(); notificationAbort.abort();
  clearTimeout(startupTimer);
  if (backend && backend.exitCode === null && backend.signalCode === null) {
    const exited = once(backend, 'exit');
    if (backend.connected) backend.send({ type: 'stop' });
    const force = setTimeout(() => stopTree(backend!), 10_000);
    await exited.catch(() => {});
    clearTimeout(force);
  }
  finished = true;
  maintenance.close();
  // Keep the native window alive until the helper exits. On macOS, destroying
  // the last window during app.quit can suspend delivery of child exit events.
  window?.destroy();
  app.exit(exitCode);
}

function fail(message: string) {
  if (quitting) return;
  console.error(`[desktop] ${message}`);
  // Automation must report failure instead of hanging on a modal dialog.
  clearTimeout(startupTimer);
  selectionError = message;
  if (process.env.RI_DESKTOP_SMOKE && !process.env.RI_DESKTOP_RECOVERY_SMOKE) { exitCode = 1; void quit(true); return; }
  void maintenance.show();
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
  notifications?.stop(); notificationAbort.abort(); notificationAbort = new AbortController();
  installedRuntime = ready.runtime;
  selectionError = undefined;
  appToken = ready.token;
  clearTimeout(startupTimer);
  const ses = window!.webContents.session;
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = desktopRequestHeaders({ headers: details.requestHeaders, url: details.url,
      origin: ready.origin, capability: ready.desktopClient,
      nativeRequest: !details.webContentsId || details.webContentsId === -1,
      trustedMainFrame: details.webContentsId === window?.webContents.id && details.frame === window?.webContents.mainFrame && details.initiatorOrigin === ready.origin,
    });
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
  if (ready.desktopClient) {
    const signal = notificationAbort.signal;
    notifications = new DesktopNotifications({
      supported: () => Notification.isSupported(),
      request: async <T>(body?: object): Promise<T> => {
        const response = await ses.fetch(`${ready.origin}/api/desktop/notifications`, {
          method: body ? 'POST' : 'GET', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          headers: { authorization: `Bearer ${ready.token}`, 'x-ri-desktop-client': ready.desktopClient!, 'content-type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Desktop notifications are unavailable.');
        return data as T;
      },
      create: (id, title, body) => new Notification({ id, title, body, icon: path.join(repo, 'public/brand/ri-desktop-icon.png') }),
      ...(process.platform === 'darwin' ? { history: () => Notification.getHistory() } : {}),
      navigate: target => {
        if (quitting || !window || appOrigin !== ready.origin) return;
        if (window.isMinimized()) window.restore();
        window.show(); window.focus(); void navigateSafely(`${ready.origin}${target}`);
      },
    });
    notifications.start();
  }
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
  ipcMain.handle('desktop:notifications', async (event, action: unknown) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !appOrigin || !sameOrigin(event.senderFrame.url, appOrigin)) throw new Error('Untrusted window');
    if (typeof action !== 'string' || !['status', 'enable', 'disable', 'test'].includes(action)) throw new Error('Invalid notification action');
    if (!notifications) throw new Error('The local service has not connected yet.');
    return notifications.action(action as DesktopNotificationAction);
  });
  const logo = fs.readFileSync(path.join(repo, 'public/brand/ri-mark-white.svg'), 'utf8');
  const loading = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"></head><body style="margin:0;background:#181a18;color:#f5f2ea;display:grid;place-items:center;height:100vh;font:15px system-ui"><div style="text-align:center"><img alt="${APP_NAME}" width="64" src="data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}"><p>Starting ${APP_NAME}</p><p style="color:#aeb3aa">Preparing your local app…</p></div></body></html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loading)}`);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : [{ label: 'App', submenu: [{ role: 'quit' as const }] }]),
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    { label: 'Tools', submenu: [
      { label: 'Check for Desktop Update…', click: () => { if (window) void updateDesktop(window, prepareClose, () => {
        quitting = true; finished = true; oauthAbort.abort(); notifications?.stop(); notificationAbort.abort();
        if (backend?.connected) backend.send({ type: 'stop' });
      }); } },
      { label: 'Service Status…', click: () => void serviceCommand('status') },
      { label: 'Local Installation and Recovery…', click: () => void maintenance.show() },
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
  if (selectionError) { fail(selectionError); return; }
  startConnection();
}

function startConnection() {
  clearTimeout(startupTimer);
  const child = fork(path.join(repo, 'dist/desktop/backend.cjs'), [], { cwd: repo, execPath: process.env.RI_DESKTOP_NODE,
    execArgv: [], env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  backend = child;
  // Next prints its browser pairing URL at boot. Desktop pairing happens over
  // private IPC, so avoid copying that credential into terminal/test logs.
  for (const [input, output] of [[backend.stdout, process.stdout], [backend.stderr, process.stderr]] as const) {
    if (input) createInterface({ input }).on('line', (line) => {
      output.write(line.replace(new RegExp(`#${PAIRING_TOKEN_FRAGMENT_KEY}=[^\\s]+`, 'g'), '#[pairing token redacted]') + '\n');
    });
  }
  backend.on('message', (message: BackendMessage) => {
    if (backend !== child || quitting) return;
    if (message.type === 'certificate' && window && message.origin === appOrigin) window.webContents.session.setCertificateVerifyProc((request, callback) => callback(certificateDecision(request.hostname, request.certificate.data, message)));
    if (message.type === 'error') fail(message.message);
    if (message.type === 'ready') void openApp(message).catch(() => fail('Could not load the local app. Check the backend output and relaunch the demo.'));
  });
  child.once('error', (error) => { if (backend === child) fail(error.message); });
  child.once('exit', (code) => { if (!quitting && backend === child && !selectionError) fail(`The desktop connection helper stopped (${code ?? 'signal'}). Inspect the service and retry.`); });
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
