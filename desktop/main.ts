import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, session, shell, screen, clipboard, globalShortcut } from 'electron';
import { fork, execFile, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline';
import { APP_NAME, PAIRING_TOKEN_FRAGMENT_KEY } from '../src/constants/app';
import { getConfigDir, getProductionAppRoot } from '../src/lib/config/paths';
import { demoEnvironment, demoRoot, type BackendMessage, type BackendReady } from './config';
import { certificateDecision, desktopRequestHeaders, externalWebUrl, sameOrigin } from './trust';
import { installTerminalCommand, removeTerminalCommand, type CliInstallation } from './cli-install';
import { updateDesktop } from './shell-update';
import { parseDeepLink, resultLocation, watchOAuthResults } from './oauth-client';
import { servicePaths } from '../src/lib/service/paths';
import { serviceRequest, serviceStatus, type ServiceStatus } from '../src/lib/service/client';
import { redactServiceLine } from '../src/lib/service/logging';
import { assertExistingInstallation, installationEnvironment, localInstallation, readInstallation, saveInstallation, type InstallationInspection } from './installation';
import { maintenanceWindow } from './maintenance-window';
import { RemoteNotificationPermission } from './notification-permission';
import { DesktopNotifications } from './notifications';
import { backgroundWindow, revealWindow } from './window-visibility';
import { createDesktopTray, desktopMenuCommands, activityMenuItems, updateDesktopTray } from './tray';
import { CaptureShortcut } from './shortcut';
import { ensureDesktopPortalIdentity } from './portal';
import { createDesktopLogin } from './login';
import { desktopSettingsAction } from './settings';
import { DesktopActivity } from './activity';
import { desktopActivityPath, type DesktopActivitySnapshot } from '../src/lib/sessions/desktop-activity-contract';
import { companionWindow } from './companion-window';
import { createLocalWindow } from './local-window';
import { createStartupVisibility } from './startup-visibility';
import { discoverInstallation, type DiscoveredInstallation } from './discover-installation';
import { setupRequest } from './setup-client';
import type { ConnectionSetupStatus, ConnectionSetupRequest } from './connection-setup';
import { hasLoginSupervision } from '../src/lib/service/supervision-state';
import { localDeviceMenu } from './local-device-menu';
import { isLocalViewer, isViewerReload, trustedViewerFrame, viewerPermission } from './viewer-trust';
import { ViewerTransitions } from './viewer-transitions';
import { signInDesktopSession } from './session-auth';
import type { DesktopNotificationAction } from '../src/lib/notifications/desktop-contract';

const repo = app.isPackaged ? path.join(process.resourcesPath, 'server') : process.env.RI_DESKTOP_REPO || path.resolve(__dirname, '../..');
// An explicit state directory isolates saved installation choices as well as
// the default home. Useful for portable/test launches without OS-global state.
const desktopState = path.resolve(process.env.RI_DESKTOP_STATE_DIR || (app.isPackaged ? path.join(app.getPath('appData'), APP_NAME) : path.join(repo, '.electron-demo')));
const installationFile = path.join(desktopState, app.isPackaged ? 'desktop-installation.json' : 'installation.json');
// A packaged app's own home, else a source launch's (`demoRoot`: the dev
// home in development, a throwaway one for the production demo).
const defaultDesktopRoot = app.isPackaged ? path.join(desktopState, 'home')
  : demoRoot(repo, { RI_DESKTOP_STATE_DIR: process.env.RI_DESKTOP_STATE_DIR }, process.env.RI_DESKTOP_MODE === 'development' ? 'development' : 'production');
const macLoginLaunch = (() => {
  try { return app.isPackaged && process.platform === 'darwin' && app.getLoginItemSettings({ type: 'mainAppService' }).wasOpenedAtLogin; }
  catch { return false; }
})();
// A genuine OS login uses the saved choice. A caller's --ri-background flag
// only affects visibility and must retain an explicitly selected data root.
const useSavedInstallation = process.argv.includes('--ri-use-saved-installation') || macLoginLaunch;
const useDefaultInstallation = process.argv.includes('--ri-default-installation');
let selectionError: string | undefined;
let selectionInvalid = false;
let connecting = false;
let connectionNeedsRefresh = false;
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
let localViewer = false;
const viewerTransitions = new ViewerTransitions<BackendReady>();
let localService: ServiceStatus | undefined;
let installedRuntime: BackendReady['runtime'];
let preparingClose = false;
let closeGuard: { nonce: string; resolve: (ok: boolean) => void } | undefined;
let preparation: Promise<boolean> | undefined;
let backgroundGuard: { nonce: string; resolve: (ok: boolean) => void } | undefined;
let backgroundPending = false;
let visibilityRevision = 0;
let oauthAbort = new AbortController();
let notifications: DesktopNotifications | undefined;
let notificationPermission: RemoteNotificationPermission | undefined;
let notificationAbort = new AbortController();
let navigating = false;
let tray: ReturnType<typeof createDesktopTray>;
let updatingShell = false;
const desktopLogin = createDesktopLogin({ app });
let captureShortcut: CaptureShortcut | undefined;
let captureReady = false;
let capturePending = false;
let activity: DesktopActivity | undefined;
let activityState: DesktopActivitySnapshot = { connection: 'connecting' };
let menuActions: Parameters<typeof desktopMenuCommands>[0] | undefined;
let refreshApplicationMenu: (() => void) | undefined;
let activityPresentation = '';
const pendingLinks: string[] = [];

// Local controls keep a separate, privileged renderer. They share one native
// window and temporarily replace the viewer without unloading its drafts.
const localSurface = createLocalWindow({
  onShow: () => {
    if (quitting) { localSurface.close(); return; }
    visibilityRevision++; window?.hide();
  },
  onUserClose: () => {
    if (quitting) return;
    if (appOrigin) startupVisibility.showViewer();
    else void quit();
  },
});
const startupVisibility = createStartupVisibility({
  viewer: () => window, local: localSurface, quitting: () => quitting,
  revealViewer: () => { visibilityRevision++; revealWindow(window); },
  prepareViewerForBackground,
});
function dialogWindow() {
  return localSurface.get('companion') ?? localSurface.get('maintenance') ?? window!;
}
function showAppWindow() {
  if (appOrigin) startupVisibility.showViewer();
  else showWindow();
}
let discovered: DiscoveredInstallation | null = null;
let discovery: { expires: number; result: Promise<DiscoveredInstallation | null> } | undefined;
function detectedInstallation() {
  // Source/demo launches never discover or offer to adopt a production Home.
  if (!app.isPackaged) return Promise.resolve(null);
  if (!discovery || discovery.expires < Date.now()) discovery = {
    expires: Date.now() + 30_000,
    result: discoverInstallation({ currentRoot: identity.root, candidateRoot: getProductionAppRoot(), inspect: inspectInstallation }).then(result => { discovered = result; return result; }),
  };
  return discovery.result;
}
function setupPageOptions(view: 'auto' | 'settings' = 'auto') {
  const logo = fs.readFileSync(path.join(repo, 'public/brand/ri-mark-white.svg'));
  return { view, logoDataUrl: `data:image/svg+xml;base64,${logo.toString('base64')}` };
}

async function showSetup(view: 'auto' | 'settings' = 'auto') {
  await startupVisibility.showLocal(() => companion.show(setupPageOptions(view)));
}
async function showRecovery() {
  await startupVisibility.showLocal(() => maintenance.show());
}

function requestQuickCapture() {
  if (quitting || preparation || preparingClose || navigating || updatingShell) return;
  if (appOrigin && !selectionError) showAppWindow(); else showWindow();
  capturePending = true;
  deliverCapture();
}

function deliverCapture() {
  if (!capturePending || !captureReady || !window || window.isDestroyed() || quitting || preparation || preparingClose || navigating || updatingShell) return;
  capturePending = false;
  window.webContents.send('desktop:quick-capture');
}

function openActivity(sessionId: string) {
  if (!appOrigin || quitting || !activityState.activity?.targets.some(target => target.sessionId === sessionId)) return;
  showAppWindow(); void navigateSafely(`${appOrigin}${desktopActivityPath(sessionId)}`);
}

function updateActivity(snapshot: DesktopActivitySnapshot) {
  activityState = snapshot;
  if (quitting) return;
  const presentation = JSON.stringify({ connection: snapshot.connection, activity: snapshot.activity });
  if (presentation === activityPresentation) return;
  activityPresentation = presentation;
  if (tray && !tray.isDestroyed() && menuActions) updateDesktopTray(tray, menuActions, snapshot, openActivity, localDeviceMenu(localService, action => void localWorkerCommand(action).catch(error => dialog.showErrorBox('Local execution', error.message))));
  // Electron makes MenuItem.submenu read-only. Rebuild from the template only
  // when visible activity changes, keeping ordinary polls from replacing menus.
  refreshApplicationMenu?.();
  app.dock?.setBadge(snapshot.connection === 'connected' && snapshot.activity?.attention ? String(snapshot.activity.attention) : '');
}

function showWindow() {
  visibilityRevision++;
  startupVisibility.show();
}

async function hideWindow() {
  await startupVisibility.hide();
}

async function prepareViewerForBackground() {
  if (quitting || preparingClose || navigating || updatingShell || preparation || backgroundPending || !window || window.isDestroyed()) return;
  backgroundPending = true;
  const current = window;
  const revision = visibilityRevision;
  try {
    let ready = true;
    if (appOrigin && sameOrigin(current.webContents.getURL(), appOrigin)) {
      ready = await new Promise<boolean>(resolve => {
        const nonce = randomUUID();
        const timer = setTimeout(() => { backgroundGuard = undefined; resolve(false); }, 3000);
        backgroundGuard = { nonce, resolve: ok => { clearTimeout(timer); backgroundGuard = undefined; resolve(ok); } };
        current.webContents.send('desktop:prepare-background', nonce);
      });
    }
    if (quitting || preparingClose || navigating || updatingShell || preparation || current.isDestroyed() || revision !== visibilityRevision) return;
    if (!ready) {
      showWindow();
      await dialog.showMessageBox(current, { type: 'info', message: 'Keep Ri visible while voice input is active',
        detail: 'Finish or cancel voice input before closing this window. If Ri is still loading, try again shortly.', buttons: ['Keep open'] });
      return;
    }
    backgroundWindow(current, process.platform, !!tray && !tray.isDestroyed());
  } finally { backgroundPending = false; }
}

async function checkDesktopUpdate() {
  if (!window || quitting || updatingShell) return;
  updatingShell = true;
  showAppWindow();
  try {
    await updateDesktop(dialogWindow(), prepareClose, () => {
      quitting = true; finished = true; oauthAbort.abort(); notifications?.stop(); notificationAbort.abort();
      activity?.stop(); captureShortcut?.stop();
      tray?.destroy(); tray = undefined;
      if (backend?.connected) backend.send({ type: 'stop' });
    });
  } finally { updatingShell = false; }
}

async function handleDeepLink(raw: string) {
  // Native OAuth completes only for our pinned local Home. Remote Home
  // authorization uses its ordinary web callback and never our native channel.
  if (appOrigin && !localViewer) return;
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
  connecting = true;
  try {
    await detachConnection();
    startConnection();
  } catch (error) {
    connecting = false;
    selectionError = error instanceof Error ? error.message : 'Could not reconnect. Try again.';
    throw error;
  }
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
  back: async () => {
    if (appOrigin && !selectionError) showAppWindow();
    else await showSetup();
  },
}, localSurface);

function connectionRequest<T>(request: ConnectionSetupRequest) {
  return setupRequest<T>(process.env.RI_DESKTOP_NODE!, repo, { ...env, RI_DESKTOP_SETUP_DEVELOPMENT: !app.isPackaged && mode === 'development' ? '1' : '' }, request);
}

async function runLocalServiceCommand(action: 'install' | 'uninstall') {
  const options = cliInstallation();
  if (!options.launcher) throw new Error('Start at login requires the packaged app and a staged runtime.');
  await new Promise<void>((resolve, reject) => execFile(options.launcher!, ['cli', 'service', action], { env, timeout: 240_000, maxBuffer: 128 * 1024 },
    error => error ? reject(new Error('Could not change login startup. Check this device’s service log and retry.')) : resolve()));
}

async function refreshRole() {
  connecting = true;
  try {
    const status = await serviceStatus();
    if (status) await serviceRequest('/role/refresh', 'POST', 200_000);
    await detachConnection();
    selectionError = undefined;
    startConnection();
    connectionNeedsRefresh = false;
  } catch (error) {
    // The choice may already be saved. Keep it and offer Retry instead of
    // leaving first-run setup on an indefinite Starting screen.
    connecting = false;
    selectionError = error instanceof Error ? error.message : 'Could not start this connection. Try again.';
    throw error;
  }
}

async function localWorkerCommand(action: 'stop' | 'resume') {
  if (action === 'stop') {
    const choice = await dialog.showMessageBox({ type: 'question', message: 'Stop execution on this device?',
      detail: 'Local agent sessions stop. Your Home and work on other devices keep running. Local execution stays stopped until you resume it.',
      buttons: ['Keep running', 'Stop local execution'], defaultId: 0, cancelId: 0 });
    if (choice.response !== 1) return;
  }
  await serviceRequest('/worker/' + action, 'POST', 60_000);
}

function changeDesktopPreferences(raw: unknown) {
  if (quitting || preparingClose || updatingShell) throw new Error('Ri is restarting. Try again after it reconnects.');
  const action = desktopSettingsAction(raw);
  if (!captureShortcut) throw new Error('Desktop settings are still loading.');
  if (action.type === 'shortcut') captureShortcut.configure(action);
  const login = action.type === 'login' ? desktopLogin.setEnabled(action.enabled) : desktopLogin.status();
  return { shortcut: captureShortcut.status(), login };
}

const companion = companionWindow(async (action, value) => {
  if (action === 'status') {
    const setup = await connectionRequest<ConnectionSetupStatus>({ action: 'inspect' }).catch(error => ({
      role: 'conflict' as const, homeSelected: false, home: null, deviceId: null, workerEnrolled: false,
      reason: error instanceof Error ? error.message : 'This installation needs attention.',
    }));
    const service = await serviceStatus().catch(() => null);
    const discover = setup.role === 'first-run' && !setup.homeSelected;
    if (discover) void detectedInstallation();
    const update = service ? await serviceRequest<{ update: unknown }>('/update').catch(() => null) : null;
    return { ...setup, desktop: app.getVersion(), service, worker: service?.worker, update: update?.update, connectionError: selectionError, connecting, hasViewer: !!appOrigin,
      detectedInstallation: discover ? discovered : null,
      login: { enabled: hasLoginSupervision() }, preferences: captureShortcut ? { shortcut: captureShortcut.status(), login: desktopLogin.status() } : null,
      notifications: notifications ? await notifications.action('status').catch(() => ({ supported: Notification.isSupported(), enabled: notificationPermission?.enabled() ?? false, error: 'Waiting for your Home to reconnect.' })) : null };
  }
  if (action === 'preferences') return changeDesktopPreferences(value);
  if (action === 'use-detected') {
    const setup = await connectionRequest<ConnectionSetupStatus>({ action: 'inspect' });
    if (setup.role !== 'first-run' || setup.homeSelected) throw new Error('This device already has a selected Ri. Use Advanced settings to change it.');
    discovery = undefined;
    const detected = await detectedInstallation();
    if (!detected?.canUse) throw new Error(detected?.reason ?? 'The existing Ri is no longer available. Open Advanced settings to choose it.');
    return switchInstallation({ root: detected.root });
  }
  if (action === 'create-home') {
    await connectionRequest({ action: 'create-home' });
    await refreshRole();
    return {};
  }
  if (action === 'connect') {
    if (!value || typeof value !== 'object' || typeof (value as { pairingLink?: unknown }).pairingLink !== 'string' || typeof (value as { runWork?: unknown }).runWork !== 'boolean') throw new Error('Enter a pairing link and choose whether to run work here.');
    const input = value as { pairingLink: string; runWork: boolean };
    await connectionRequest({ action: 'connect', pairingLink: input.pairingLink });
    // If enrollment fails, the valid connection remains and Enable local
    // execution is a retry, never an implicit new Home or duplicate device.
    if (input.runWork) {
      try { await connectionRequest({ action: 'enable-worker', consent: true }); }
      catch (error) {
        // Pairing succeeded. Let the user retry execution or open this Ri as a
        // viewer without submitting another invitation or losing the consent.
        connecting = false;
        connectionNeedsRefresh = true;
        selectionError = undefined;
        return { executionError: error instanceof Error ? error.message : 'Local agents could not be enabled.' };
      }
    }
    await refreshRole();
    return {};
  }
  if (action === 'enable-worker') {
    const choice = await dialog.showMessageBox({ type: 'question', message: 'Run agents on this device?',
      detail: 'Your Home will be able to run work in the agent folders you set up here, using this device’s tools and harness sign-ins.',
      buttons: ['Cancel', 'Enable local execution'], defaultId: 0, cancelId: 0 });
    if (choice.response === 1) { await connectionRequest({ action: 'enable-worker', consent: true }); await refreshRole(); }
    return {};
  }
  if (action === 'stop-worker' || action === 'resume-worker') { await localWorkerCommand(action === 'stop-worker' ? 'stop' : 'resume'); return {}; }
  if (action === 'login') {
    if (!value || typeof value !== 'object' || typeof (value as { enabled?: unknown }).enabled !== 'boolean') throw new Error('Choose whether to start at login.');
    await runLocalServiceCommand((value as { enabled: boolean }).enabled ? 'install' : 'uninstall');
    return {};
  }
  if (action === 'open') { if (connectionNeedsRefresh) { await refreshRole(); return {}; } if (connecting) return {}; if (viewerTransitions.pending) { await openApp(viewerTransitions.pending); return {}; } if (selectionError) { await retryConnection(); return {}; } if (appOrigin) { showAppWindow(); } else await retryConnection(); return {}; }
  if (action === 'notification-enable' || action === 'notification-disable' || action === 'notification-test') {
    if (!notifications) throw new Error('Open your Home before configuring notifications.');
    const kind = action.slice(13) as 'enable' | 'disable' | 'test';
    if (kind !== 'test') notificationPermission?.set(kind === 'enable');
    try { return await notifications.action(kind); }
    catch (error) { if (kind === 'enable') notificationPermission?.set(false); throw error; }
  }
  if (action === 'recovery') { await showRecovery(); return {}; }
  if (action === 'updates') return serviceRequest('/update');
  if (action.startsWith('update-')) {
    const guarded = action === 'update-apply' && localViewer;
    if (guarded && !(await prepareClose())) return {};
    try { return await serviceRequest('/update', 'POST', 30_000, { action: action === 'update-apply' ? 'when-idle' : action.slice(7) }); }
    finally { if (guarded && !quitting && window && !window.isDestroyed()) window.webContents.send('desktop:resume'); }
  }
  throw new Error('Unknown companion action.');
}, localSurface);

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
  if (!window || quitting) return;
  showAppWindow();
  if (action !== 'status' && !(await prepareClose())) return;
  try {
    if (action === 'status') {
      const output = JSON.stringify(await diagnostics(), null, 2);
      const result = await dialog.showMessageBox(dialogWindow(), { message: 'Ri service', detail: output, buttons: ['Close', 'Copy diagnostics'] });
      if (result.response === 1) clipboard.writeText(output);
      return;
    }
    const options = cliInstallation();
    if (action === 'install' && !options.launcher) throw new Error('Start at login requires an explicitly staged managed runtime. Use this installation’s existing CLI to adopt one first.');
    const command = options.launcher ?? options.node;
    const args = options.launcher ? ['cli', 'service', action] : [options.cli, 'service', action];
    const output = await new Promise<string>((resolve, reject) => execFile(command, args, { env, timeout: 240_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout)));
    await dialog.showMessageBox(dialogWindow(), { message: action === 'install' ? 'Start at login enabled' : action === 'uninstall' ? 'Start at login disabled' : action === 'start' ? 'Service started' : 'Service stopped', detail: output.trim() });
  } catch (error) { dialog.showErrorBox('Ri service', error instanceof Error ? error.message : String(error)); }
  finally { window?.webContents.send('desktop:resume'); }
}

function stopTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}

function prepareClose(intent: 'quit' | 'continue' = 'continue'): Promise<boolean> {
  preparation ??= prepareCloseOnce(intent).finally(() => { preparation = undefined; });
  return preparation;
}

async function prepareCloseOnce(intent: 'quit' | 'continue'): Promise<boolean> {
  if (!window || window.isDestroyed() || !appOrigin || !sameOrigin(window.webContents.getURL(), appOrigin)) return true;
  const ok = await new Promise<boolean>(resolve => {
    const nonce = randomUUID();
    const timer = setTimeout(() => { closeGuard = undefined; resolve(false); }, 15_000);
    closeGuard = { nonce, resolve: result => { clearTimeout(timer); closeGuard = undefined; resolve(result); } };
    window!.webContents.send('desktop:prepare-close', nonce);
  });
  if (ok) return true;
  // A Quit from the menu bar must not leave its save/recording dialog attached
  // to a hidden window. Reopening alone never resumes a guarded renderer.
  showAppWindow();
  const result = await dialog.showMessageBox(window, {
    type: 'warning', message: 'Some changes have not finished saving',
    detail: 'Keep Ri open to finish your recording or upload and retry pending saves. Saved document, chat and capture drafts can be recovered. Content that could not be saved on this device may be lost if you continue.',
    buttons: ['Keep open', intent === 'quit' ? 'Quit anyway' : 'Continue without saving'], defaultId: 0, cancelId: 0,
  });
  if (result.response !== 1) window?.webContents.send('desktop:resume');
  return result.response === 1;
}

async function quit(skipGuard = false) {
  if (quitting || preparingClose) return;
  preparingClose = true;
  if (!skipGuard && !(await prepareClose('quit'))) { preparingClose = false; return; }
  preparingClose = false;
  quitting = true;
  activity?.stop(); captureShortcut?.stop();
  tray?.destroy(); tray = undefined;
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
  localSurface.close();
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
  connecting = false;
  updateActivity({ connection: 'disconnected' });
  if (process.env.RI_DESKTOP_SMOKE && !process.env.RI_DESKTOP_RECOVERY_SMOKE) { exitCode = 1; void quit(true); return; }
  void showSetup();
}

async function navigateSafely(url: string) {
  if (navigating || quitting || !window) return;
  navigating = true;
  try {
    if (await prepareClose() && !quitting && !preparingClose) await loadPreparedPage(url);
  } catch { window?.webContents.send('desktop:resume'); }
  finally { navigating = false; }
}

/** Only a completed save/discard decision may override beforeunload for the
 * single navigation it approved. Ordinary renderer reloads keep their guard. */
async function loadPreparedPage(url: string) {
  if (!window || window.isDestroyed()) return;
  const contents = window.webContents;
  const approved = (event: Electron.Event) => event.preventDefault();
  contents.once('will-prevent-unload', approved);
  try { await window.loadURL(url); }
  finally { if (!contents.isDestroyed()) contents.removeListener('will-prevent-unload', approved); }
}

function configureViewerSession(ready: BackendReady | undefined) {
  if (!window || window.isDestroyed()) return;
  if (!ready) {
    const ses = window.webContents.session;
    ses.webRequest.onBeforeSendHeaders(null);
    ses.setCertificateVerifyProc((_request, callback) => callback(-3));
    ses.setPermissionCheckHandler(() => false);
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.removeAllListeners('will-navigate');
    window.webContents.on('will-navigate', event => event.preventDefault());
    return;
  }
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
    callback(isLocalViewer(ready) ? certificateDecision(request.hostname, request.certificate.data, ready) : -3);
  });
  // Both hooks enforce actual main-frame ownership. OS notifications only
  // use the separate native pipeline and its trusted local permission.
  ses.setPermissionCheckHandler((contents, permission, _origin, details) => viewerPermission({
    permission, senderId: contents?.id, windowId: window?.webContents.id,
    isMainFrame: details.isMainFrame, requestingUrl: details.requestingUrl, origin: ready.origin,
  }));
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(viewerPermission({ permission, senderId: contents.id, windowId: window?.webContents.id,
      isMainFrame: details.isMainFrame, requestingUrl: details.requestingUrl, origin: ready.origin }));
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
    if (isViewerReload(url, window!.webContents.getURL(), ready.origin)) return;
    event.preventDefault();
    if (sameOrigin(url, ready.origin)) void navigateSafely(url);
    else openExternal(url);
  });
}

function publishViewerIdentity(ready: BackendReady | undefined) {
  appOrigin = ready?.origin;
  appToken = ready?.token;
  localViewer = !!ready && isLocalViewer(ready);
  installedRuntime = ready?.runtime;
}

async function openApp(ready: BackendReady) {
  await viewerTransitions.run(ready, {
    prepare: async previous => {
      if (quitting || preparingClose || !window || window.isDestroyed()) return false;
      if (previous && (previous.origin !== ready.origin || previous.token !== ready.token) && !(await prepareClose())) {
        selectionError = 'Your connection is ready. Finish saving, then choose Open Ri to use the new sign-in.';
        connecting = false;
        void showSetup(); return false;
      }
      return !quitting && !preparingClose && !!window && !window.isDestroyed();
    },
    stage: async () => {
      configureViewerSession(ready);
      // The existing renderer and its monitors stay alive until the candidate
      // session has been accepted. A failed sign-in never strands a frozen view.
      await signInDesktopSession({ origin: ready.origin, token: ready.token, local: isLocalViewer(ready),
        fetch: (url, init) => window!.webContents.session.fetch(url, init),
      });
    },
    open: async previous => {
      if (quitting || preparingClose || !window || window.isDestroyed()) throw new Error('Ri stopped opening this connection.');
      const reconnecting = previous?.origin === ready.origin;
      const reload = !reconnecting || previous?.token !== ready.token;
      const oldUrl = reconnecting ? new URL(window.webContents.getURL()) : null;
      // Preload must see the candidate's privilege level on the new document.
      // A failed navigation restores the last accepted identity below.
      publishViewerIdentity(ready);
      if (reload) await loadPreparedPage(`${ready.origin}${oldUrl ? oldUrl.pathname + oldUrl.search : '/'}#${PAIRING_TOKEN_FRAGMENT_KEY}=${encodeURIComponent(ready.token)}`);
    },
    rollback: previous => {
      publishViewerIdentity(previous);
      configureViewerSession(previous);
      if (window && !window.isDestroyed()) window.webContents.send('desktop:resume');
    },
    commit: () => {
      selectionError = undefined;
      connecting = false;
      clearTimeout(startupTimer);
      activateViewerMonitors(ready);
    },
  });
}

function activateViewerMonitors(ready: BackendReady) {
  if (quitting || preparingClose || !window || window.isDestroyed()) return;
  oauthAbort.abort(); oauthAbort = new AbortController();
  notifications?.stop(); notificationAbort.abort(); notificationAbort = new AbortController();
  activity?.stop();
  const ses = window.webContents.session;
  if (ready.desktopClient) {
    activity = new DesktopActivity({
      request: async signal => {
        const response = await ses.fetch(`${ready.origin}/api/desktop/activity`, { signal, headers: { authorization: `Bearer ${ready.token}`, 'x-ri-desktop-client': ready.desktopClient! } });
        if (!response.ok) throw new Error('Activity is unavailable.');
        return response.json();
      },
      onChange: updateActivity,
    });
    activity.start();
  }
  notificationPermission = !localViewer && ready.homeId && ready.deviceId ? new RemoteNotificationPermission(path.join(profile, 'remote-notifications.json'), ready.homeId, ready.deviceId) : undefined;
  if (localViewer || notificationPermission) {
    const endpoint = localViewer ? '/api/desktop/notifications' : '/api/devices/me/desktop-notifications';
    const signal = notificationAbort.signal;
    notifications = new DesktopNotifications({
      supported: () => Notification.isSupported(),
      permitted: () => localViewer || !!notificationPermission?.enabled(),
      request: async <T>(body?: object): Promise<T> => {
        const response = await ses.fetch(`${ready.origin}${endpoint}`, {
          method: body ? 'POST' : 'GET', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          headers: { authorization: `Bearer ${ready.token}`, ...(localViewer ? { 'x-ri-desktop-client': ready.desktopClient! } : {}), 'content-type': 'application/json' },
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
        showAppWindow(); void navigateSafely(`${ready.origin}${target}`);
      },
    });
    notifications.start();
  }
  const cursorFile = path.join(profile, 'oauth-cursor.json');
  let cursor = 0;
  try {
    const saved = JSON.parse(fs.readFileSync(cursorFile, 'utf8'));
    if (ready.serviceRunId && saved.runId === ready.serviceRunId && Number.isSafeInteger(saved.sequence)) cursor = saved.sequence;
  } catch { /* first connection to this service */ }
  if (localViewer) void watchOAuthResults(ses, ready.origin, oauthAbort.signal, (result) => {
    if (quitting || !window) return;
    fs.writeFileSync(`${cursorFile}.tmp`, JSON.stringify({ runId: ready.serviceRunId, sequence: result.sequence }), { mode: 0o600 });
    fs.renameSync(`${cursorFile}.tmp`, cursorFile);
    showAppWindow();
    void navigateSafely(resultLocation(ready.origin, result));
  }, cursor);
  for (const raw of pendingLinks.splice(0)) void handleDeepLink(raw);
  if (!localViewer) updateActivity({ connection: 'connected' });
  // A login launch stays in the menu bar. A visible setup/recovery window
  // hands its place back to the authenticated viewer after a successful retry.
  startupVisibility.connected();
  console.info(localViewer ? '[desktop] Local Home connected with a pinned certificate.' : '[desktop] Remote Home connected with standard TLS and no local native capability.');
}

async function start() {
  await app.whenReady();
  if (process.platform === 'linux') app.setDesktopName('app.ri.desktop.desktop');
  const backgroundLaunch = desktopLogin.launchedInBackground();
  const icon = nativeImage.createFromPath(path.join(repo, 'public/brand/ri-desktop-icon.png'));
  app.dock?.setIcon(icon);
  const ses = session.fromPartition('persist:ri-desktop-demo');
  let bounds: { x?: number; y?: number; width: number; height: number } = { width: 1440, height: 980 };
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'window.json'), 'utf8'));
    if (['x', 'y', 'width', 'height'].every(key => Number.isFinite(saved[key])) && saved.width >= 800 && saved.height >= 600 &&
        screen.getAllDisplays().some(display => saved.x + 100 > display.workArea.x && saved.x < display.workArea.x + display.workArea.width && saved.y + 50 > display.workArea.y && saved.y < display.workArea.y + display.workArea.height)) bounds = saved;
  } catch { /* first window or disconnected display */ }
  window = new BrowserWindow({ ...bounds, show: false, minWidth: 800, minHeight: 600, title: APP_NAME, icon,
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
    showWindow();
    const result = await dialog.showMessageBox({ type: 'error', message: 'Ri’s window stopped responding', detail: 'The background service is still independent. Reload to recover retained drafts.', buttons: ['Reload', 'Quit Ri'], defaultId: 0 });
    if (result.response === 0 && appOrigin) await window?.loadURL(appOrigin);
    else void quit(true);
  });
  window.on('close', event => { if (!quitting) { event.preventDefault(); void hideWindow(); } });
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) captureReady = false; });
  ipcMain.on('desktop:capture-ready', event => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !appOrigin || !sameOrigin(event.senderFrame.url, appOrigin)) return;
    captureReady = true; deliverCapture();
  });
  ipcMain.on('desktop:bridge-mode', event => {
    event.returnValue = localViewer && trustedViewerFrame({ senderId: event.sender.id, windowId: window?.webContents.id, mainFrame: event.senderFrame === window?.webContents.mainFrame, url: event.senderFrame?.url ?? '', origin: appOrigin }) ? 'local' : 'viewer';
  });
  ipcMain.handle('desktop:settings', (event, raw: unknown) => {
    if (!localViewer) throw new Error('Use Ri on this device in the application menu to change local settings.');
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !appOrigin || !sameOrigin(event.senderFrame.url, appOrigin)) throw new Error('Untrusted window');
    return changeDesktopPreferences(raw);
  });
  ipcMain.on('desktop:background-ready', (event, message: unknown) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !appOrigin || !sameOrigin(event.senderFrame.url, appOrigin)) return;
    if (!message || typeof message !== 'object') return;
    const reply = message as { nonce?: unknown; ok?: unknown };
    if (reply.nonce === backgroundGuard?.nonce) backgroundGuard?.resolve(reply.ok === true);
  });
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
    if (!localViewer) throw new Error('This remote Home uses browser notifications.');
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !appOrigin || !sameOrigin(event.senderFrame.url, appOrigin)) throw new Error('Untrusted window');
    if (typeof action !== 'string' || !['status', 'enable', 'disable', 'test'].includes(action)) throw new Error('Invalid notification action');
    if (!notifications) throw new Error('The local service has not connected yet.');
    return notifications.action(action as DesktopNotificationAction);
  });
  const logo = fs.readFileSync(path.join(repo, 'public/brand/ri-mark-white.svg'), 'utf8');
  const loading = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"></head><body style="margin:0;background:#181a18;color:#f5f2ea;display:grid;place-items:center;height:100vh;font:15px system-ui"><div style="text-align:center"><img alt="${APP_NAME}" width="64" src="data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}"><p>Starting ${APP_NAME}</p><p style="color:#aeb3aa">Opening your Ri…</p></div></body></html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loading)}`);
  const actions = {
    show: showWindow, hide: hideWindow, quit: () => { void quit(); },
    capture: requestQuickCapture,
    preferences: () => { void showSetup('settings'); },
    notifications: () => { if (appOrigin) showAppWindow(); else showWindow(); if (appOrigin) void navigateSafely(`${appOrigin}/?settings=notifications`); },
    update: () => { void checkDesktopUpdate(); }, status: () => { void serviceCommand('status'); },
    recovery: () => { if (!quitting) void showRecovery(); },
  };
  menuActions = actions;
  const commands = desktopMenuCommands(actions);
  tray = createDesktopTray(repo, actions);
  const wayland = process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);
  captureShortcut = new CaptureShortcut(path.join(profile, 'capture-shortcut.json'), globalShortcut, requestQuickCapture, wayland, () => {
    if (!wayland) return;
    if (!app.isPackaged) throw new Error('Install the packaged Ri app before enabling its Wayland global shortcut.');
    ensureDesktopPortalIdentity();
  });
  captureShortcut.start();
  refreshApplicationMenu = () => Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: APP_NAME, submenu: [
      ...(process.platform === 'darwin' ? [
        { role: 'about' as const }, { type: 'separator' as const }, { role: 'services' as const },
        { type: 'separator' as const }, { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const }, { type: 'separator' as const },
      ] : []),
      { ...commands.quit, accelerator: 'CmdOrCtrl+Q' },
    ] },
    { role: 'editMenu' }, { role: 'viewMenu' },
    { label: 'Window', role: 'windowMenu', submenu: [
      { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, commands.show,
      { ...commands.hide, accelerator: 'CmdOrCtrl+W', click: (_item, focused) => (focused ?? BrowserWindow.getFocusedWindow() ?? window)?.close() },
      ...(process.platform === 'darwin' ? [{ type: 'separator' as const }, { role: 'front' as const }] : []),
    ] },
    { label: 'Tools', submenu: [
      commands.capture, { id: 'ri-activity-menu', label: 'Activity', submenu: activityMenuItems(activityState, openActivity) }, commands.preferences,
      commands.notifications, commands.update, commands.status, commands.recovery,
      ...(localService?.role === 'worker' ? [{ label: localService.worker?.enabled === false ? 'Resume Local Execution' : 'Stop Local Execution', click: () => void localWorkerCommand(localService?.worker?.enabled === false ? 'resume' : 'stop').catch(error => dialog.showErrorBox('Local execution', error.message)) }] : []),
      { label: 'Start at Login…', click: () => void serviceCommand('install') },
      { label: 'Disable Start at Login…', click: () => void serviceCommand('uninstall') },
      { label: 'Start This Device’s Service', click: () => void serviceCommand('start') },
      { label: 'Stop This Device’s Service', click: () => void serviceCommand('stop') },
      { type: 'separator' },
      { label: 'Install Terminal Command…', click: () => void manageTerminalCommand() },
      { label: 'Remove Terminal Command…', click: () => void manageTerminalCommand(true) },
    ] },
  ]));
  refreshApplicationMenu();
  updateActivity(activityState);
  if (!backgroundLaunch || !tray || process.platform !== 'darwin') {
    showWindow();
    if (backgroundLaunch && process.platform !== 'darwin') backgroundWindow(window, process.platform, !!tray);
  }
  if (!process.env.RI_DESKTOP_NODE || process.env.RI_DESKTOP_NODE === process.execPath) {
    throw new Error('Launch with pnpm desktop:demo or pnpm desktop:dev so the backend uses ordinary Node.');
  }
  if (selectionError) { fail(selectionError); return; }
  startConnection();
}

function startConnection() {
  connecting = true;
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
    if (message.type === 'setup') { connecting = false; clearTimeout(startupTimer); void showSetup(); }
    if (message.type === 'status') {
      const changed = JSON.stringify(localService) !== JSON.stringify(message.status);
      localService = message.status;
      if (changed) { refreshApplicationMenu?.(); if (tray && !tray.isDestroyed() && menuActions) updateDesktopTray(tray, menuActions, activityState, openActivity, localDeviceMenu(localService, action => void localWorkerCommand(action).catch(error => dialog.showErrorBox('Local execution', error.message)))); }
    }
    if (message.type === 'certificate' && localViewer && window && message.origin === appOrigin) window.webContents.session.setCertificateVerifyProc((request, callback) => callback(certificateDecision(request.hostname, request.certificate.data, message)));
    if (message.type === 'error') fail(message.message);
    if (message.type === 'ready') void openApp(message).catch(error => fail(error instanceof Error ? error.message : 'Could not open your Home. Retry when it is reachable.'));
  });
  child.once('error', (error) => { if (backend === child) fail(error.message); });
  child.once('exit', (code) => { if (!quitting && backend === child && !selectionError) fail(`The desktop connection helper stopped (${code ?? 'signal'}). Inspect the service and retry.`); });
  startupTimer = setTimeout(() => fail('The app did not finish starting within four minutes. Check the backend output and retry.'), 240_000);
}

app.on('before-quit', (event) => { if (!finished) { event.preventDefault(); void quit(); } });
app.on('window-all-closed', () => void quit());
app.on('activate', showWindow);
process.once('SIGINT', () => void quit());
process.once('SIGTERM', () => void quit());
app.on('open-url', (event, url) => { event.preventDefault(); void handleDeepLink(url); });
if (app.isPackaged && process.platform !== 'darwin') app.setAsDefaultProtocolClient('ri');
for (const arg of process.argv) if (arg.startsWith('ri://')) void handleDeepLink(arg);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    for (const arg of argv) if (arg.startsWith('ri://')) void handleDeepLink(arg);
    showWindow();
  });
  void start().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
