import { app, dialog, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { checkRelease, releasePolicy } from '../src/lib/service/release-trust';

import { eligibleShellFile } from './shell-trust';

let updating = false;
export async function updateDesktop(window: BrowserWindow, prepare: () => Promise<boolean>, install: () => Promise<void>) {
  if (updating) return;
  if (!app.isPackaged || !releasePolicy()) { await dialog.showMessageBox(window, { message: 'Desktop updates are not configured', detail: 'This build needs a signed release and a publisher feed.' }); return; }
  updating = true;
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
    eligibleShellFile(release, found.updateInfo.files);
    const choice = await dialog.showMessageBox(window, { message: `Update the desktop app to ${release.version}?`, detail: `${release.notes}\n\nThe background service keeps running. The desktop download may apply on the next launch if you close the app.`, buttons: ['Update', 'Later'], defaultId: 0, cancelId: 1 });
    if (choice.response !== 0 || !(await prepare())) return;
    window.setProgressBar(0);
    const progress = (value: { percent: number }) => window.setProgressBar(value.percent / 100);
    autoUpdater.on('download-progress', progress);
    try { await autoUpdater.downloadUpdate(); }
    finally { autoUpdater.off('download-progress', progress); window.setProgressBar(-1); }
    // Ri finishes saving BEFORE Squirrel/AppImage can close any window.
    await install();
    autoUpdater.quitAndInstall();
  } catch (error) { dialog.showErrorBox('Desktop update', error instanceof Error ? error.message : String(error)); }
  finally { updating = false; if (!window.isDestroyed()) window.webContents.send('desktop:resume'); }
}
