import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { companionPage } from './companion-page';

export const companionActions = ['status', 'preferences', 'create-home', 'connect', 'enable-worker', 'stop-worker', 'resume-worker', 'login', 'open', 'updates', 'update-check', 'update-download', 'update-apply', 'update-later', 'recovery', 'notification-enable', 'notification-disable', 'notification-test'] as const;
export type CompanionAction = typeof companionActions[number];

/** Only this local window may operate on this computer. A Home page never
 * receives this bridge or shares the companion's cookie/session partition. */
export function companionWindow(action: (name: CompanionAction, value?: unknown) => Promise<unknown>) {
  let window: BrowserWindow | undefined;
  let trustedUrl = '';
  let busy = false;
  ipcMain.handle('desktop:companion', async (event, name: unknown, value?: unknown) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== trustedUrl) throw new Error('Untrusted companion window');
    if (typeof name !== 'string' || !(companionActions as readonly string[]).includes(name)) throw new Error('Unknown companion action');
    if (busy && name !== 'status') return { error: 'Wait for the current action to finish.' };
    const mutating = name !== 'status';
    if (mutating) busy = true;
    try { return await action(name as CompanionAction, value) ?? {}; }
    catch (error) { return { error: error instanceof Error ? error.message : 'The action could not finish. Try again.' }; }
    finally { if (mutating) busy = false; }
  });
  return {
    async show() {
      if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
      window = new BrowserWindow({ width: 640, height: 820, minWidth: 520, minHeight: 520, title: 'Ri on this device', backgroundColor: '#181a18',
        webPreferences: { preload: path.join(__dirname, 'companion-preload.cjs'), partition: `ri-companion-${randomBytes(16).toString('hex')}`, nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false } });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window.webContents.session.setPermissionCheckHandler(() => false);
      window.on('closed', () => { window = undefined; });
      trustedUrl = `data:text/html;charset=utf-8,${encodeURIComponent(companionPage(randomBytes(24).toString('hex')))}`;
      await window.loadURL(trustedUrl);
    },
    close() { window?.destroy(); window = undefined; },
  };
}
