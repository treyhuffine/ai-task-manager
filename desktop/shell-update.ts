import { app, autoUpdater as nativeUpdater, dialog, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { checkRelease, releasePolicy } from '../src/lib/service/release-trust';

import { assertSameShellRelease, eligibleShellFile } from './shell-trust';
import { installShellUpdate, stageMacUpdate } from './shell-install';

let updating = false;
export async function updateDesktop(window: BrowserWindow, prepare: () => Promise<boolean>, install: () => void) {
  if (updating) return;
  if (!app.isPackaged || !releasePolicy()) { await dialog.showMessageBox(window, { message: 'Desktop updates are not configured', detail: 'This build needs a signed release and a publisher feed.' }); return; }
  updating = true;
  let handedOff = false;
  try {
    const release = await checkRelease();
    if (release.version === app.getVersion()) { await dialog.showMessageBox(window, { message: 'This desktop app is up to date' }); return; }
    if (!release.shell) throw new Error('This publisher has not provided a desktop artifact for the release');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.channel = release.channel === 'beta' ? 'beta' : 'latest';
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = release.channel === 'beta';
    autoUpdater.setFeedURL({ provider: 'generic', url: new URL('.', release.shell.url).href });
    const found = await autoUpdater.checkForUpdates();
    if (!found || found.updateInfo.version !== release.version) throw new Error('Desktop update metadata does not match the eligible release');
    if (!found.isUpdateAvailable) { await dialog.showMessageBox(window, { message: 'This desktop app is up to date' }); return; }
    // In pinned electron-updater 6.8.9, this is the same updateInfo object its
    // downloader retains. Constrain what it can resolve, not merely one entry
    // in an otherwise untrusted multi-artifact channel response.
    Object.assign(found.updateInfo, { files: [eligibleShellFile(release, found.updateInfo.files)] });
    delete (found.updateInfo as { packages?: unknown }).packages;
    const choice = await dialog.showMessageBox(window, { message: `Update the desktop app to ${release.version}?`, detail: `${release.notes}\n\nThe background service keeps running. The desktop download may apply on the next launch if you close the app.`, buttons: ['Update', 'Later'], defaultId: 0, cancelId: 1 });
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
