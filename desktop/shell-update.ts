import fs from 'node:fs';
import path from 'node:path';
import { app, autoUpdater as nativeUpdater, dialog, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { checkRelease, releasePolicy } from '../src/lib/service/release-trust';
import { appleSigned } from './app-signature';
import { appPartChanged, assertSameShellRelease, eligibleShellFile } from './shell-trust';
import { installShellUpdate, stageMacUpdate } from './shell-install';

let updating = false;
let backgroundVersion: string | undefined;

/** macOS only lets an app with an Apple-issued signature replace itself. */
function canReplaceItself() {
  return process.platform !== 'darwin' || appleSigned(path.resolve(app.getPath('exe'), '../../..'));
}

function installedAppPart() {
  try { return (JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'desktop-config.json'), 'utf8')) as { appPart?: string }).appPart; }
  catch { return undefined; }
}

/**
 * The app's own part, downloaded in the background when it changed, following the
 * automatic updates switch (docs/always-on-spec.md 4.2 and 7.1). It takes effect
 * at the app's next start, the way Claude Code does, or when the Home on this
 * computer moves to the same version (relaunchWithHome).
 * Returns the version ready to install, if there is one.
 */
export async function downloadDesktopUpdateInBackground(): Promise<string | undefined> {
  const policy = releasePolicy();
  if (updating || !app.isPackaged || !policy?.auto || policy.metered || !(await canReplaceItself())) return backgroundVersion;
  updating = true;
  try {
    const release = await checkRelease();
    if (!release.shell || !appPartChanged(release, app.getVersion(), installedAppPart()) || release.version === backgroundVersion) return backgroundVersion;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.channel = process.arch;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.setFeedURL({ provider: 'generic', url: new URL('.', release.shell.url).href });
    const found = await autoUpdater.checkForUpdates();
    if (!found?.isUpdateAvailable || found.updateInfo.version !== release.version) return backgroundVersion;
    Object.assign(found.updateInfo, { files: [eligibleShellFile(release, found.updateInfo.files)] });
    delete (found.updateInfo as { packages?: unknown }).packages;
    await autoUpdater.downloadUpdate();
    backgroundVersion = release.version;
  } catch (error) { console.info('[desktop] Background app update unavailable:', error instanceof Error ? error.message : 'Failed'); }
  finally { updating = false; }
  return backgroundVersion;
}

/** The Home on this computer just moved to the version whose app part is waiting,
 * so the window relaunches with it, as part of the same restart (section 4.2). */
export async function relaunchWithHome(homeVersion: string, prepare: () => Promise<boolean>, install: () => void) {
  if (updating || homeVersion !== backgroundVersion) return;
  updating = true;
  try {
    const release = await checkRelease();
    if (release.version !== backgroundVersion || !(await prepare())) return;
    await installShellUpdate(autoUpdater, nativeUpdater, install);
  } catch (error) { console.info('[desktop] The app will update at its next start:', error instanceof Error ? error.message : 'Failed'); }
  finally { updating = false; }
}

export async function updateDesktop(window: BrowserWindow, prepare: () => Promise<boolean>, install: () => void) {
  if (updating) return;
  if (app.isPackaged && releasePolicy() && !(await canReplaceItself())) {
    await dialog.showMessageBox(window, { message: 'This copy of the app can\'t update itself', detail: 'macOS only lets an app signed by its developer replace itself. Ri itself still updates. To get a newer app, install a new copy from its dmg.' });
    return;
  }
  if (!app.isPackaged || !releasePolicy()) { await dialog.showMessageBox(window, { message: 'Desktop updates are not configured', detail: 'This build needs a signed release and a publisher feed.' }); return; }
  updating = true;
  let handedOff = false;
  try {
    const release = await checkRelease();
    if (release.version === app.getVersion() || (release.shell && !appPartChanged(release, app.getVersion(), installedAppPart()))) { await dialog.showMessageBox(window, { message: 'This desktop app is up to date' }); return; }
    if (!release.shell) throw new Error('This publisher has not provided a desktop artifact for the release');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    // Each release has its own folder, so a channel here only names the architecture's file.
    autoUpdater.channel = process.arch;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.setFeedURL({ provider: 'generic', url: new URL('.', release.shell.url).href });
    const found = await autoUpdater.checkForUpdates();
    if (!found || found.updateInfo.version !== release.version) throw new Error('Desktop update metadata does not match the eligible release');
    if (!found.isUpdateAvailable) { await dialog.showMessageBox(window, { message: 'This desktop app is up to date' }); return; }
    // In pinned electron-updater 6.8.9, this is the same updateInfo object its
    // downloader retains. Constrain what it can resolve, not merely one entry
    // in an otherwise untrusted multi-artifact channel response.
    Object.assign(found.updateInfo, { files: [eligibleShellFile(release, found.updateInfo.files)] });
    delete (found.updateInfo as { packages?: unknown }).packages;
    const choice = await dialog.showMessageBox(window, { message: `Update the desktop app to ${release.version}?`, detail: `${release.notes}\n\nThe background service keeps running. The desktop download may apply on the next launch after you quit Ri. Closing the window keeps Ri running.`, buttons: ['Update', 'Later'], defaultId: 0, cancelId: 1 });
    if (choice.response !== 0 || !(await prepare())) return;
    window.setProgressBar(0);
    const progress = (value: { percent: number }) => window.setProgressBar(value.percent / 100);
    autoUpdater.on('download-progress', progress);
    try { await autoUpdater.downloadUpdate(); }
    finally { autoUpdater.off('download-progress', progress); window.setProgressBar(-1); }
    if (process.platform === 'darwin') {
      // Staging hands the app to Squirrel and can arm next-launch installation.
      // Refresh publisher eligibility at this native activation boundary.
      assertSameShellRelease(release, await checkRelease());
      window.setProgressBar(2);
      try { await stageMacUpdate(nativeUpdater); }
      finally { window.setProgressBar(-1); }
    }
    // Recheck immediately before installation, including any input admitted
    // while another native dialog temporarily resumed the renderer.
    if (!(await prepare())) return;
    // The save handshake and native staging may themselves have taken time.
    // Refuse an explicit installation of stale, withdrawn, or replaced bytes.
    assertSameShellRelease(release, await checkRelease());
    await installShellUpdate(autoUpdater, nativeUpdater, () => { install(); handedOff = true; });
  } catch (error) { dialog.showErrorBox('Desktop update', error instanceof Error ? error.message : String(error)); }
  finally { updating = false; if (!handedOff && !window.isDestroyed()) window.webContents.send('desktop:resume'); }
}
