import type { EventEmitter } from 'node:events';

type NativeUpdater = EventEmitter & { checkForUpdates(): void };
type ShellUpdater = EventEmitter & { quitAndInstall(): void };

/** With autoInstallOnAppQuit disabled, electron-updater 6.8.9 downloads the
 * ZIP but leaves Squirrel staging to the caller. Stage without registering
 * its deferred quitAndInstall listener, so a staging failure can safely return
 * to the editor without leaving a later update-downloaded event armed to quit. */
export function stageMacUpdate(native: NativeUpdater, timeoutMs = 180_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      native.off('update-downloaded', ready);
      native.off('error', failed);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = (error: Error) => { cleanup(); reject(error); };
    const timer = setTimeout(() => failed(new Error('Desktop update preparation timed out. The current app remains open.')), timeoutMs);
    native.once('update-downloaded', ready);
    native.once('error', failed);
    try { native.checkForUpdates(); } catch (error) { failed(error as Error); }
  });
}

/** Only mark the app as quitting when the native installer actually commits
 * to closing its windows. Installer errors must leave the connection helper
 * and the normal save-on-quit guard intact. */
export function installShellUpdate(updater: ShellUpdater, native: EventEmitter, commit: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      native.off('before-quit-for-update', beforeQuit);
      updater.off('error', failed);
    };
    const failed = (error: Error) => { cleanup(); reject(error); };
    const beforeQuit = () => {
      cleanup();
      try { commit(); resolve(); } catch (error) { reject(error); }
    };
    native.once('before-quit-for-update', beforeQuit);
    updater.once('error', failed);
    try { updater.quitAndInstall(); } catch (error) { failed(error as Error); }
  });
}
