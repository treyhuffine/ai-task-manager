import { BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { maintenancePage } from './maintenance-page';

export interface MaintenanceActions {
  status(): Promise<unknown>;
  retry(): Promise<unknown>;
  recover(): Promise<unknown>;
  logs(): Promise<unknown>;
  copy(): Promise<unknown>;
  inspect(value: unknown): Promise<unknown>;
  use(value: unknown): Promise<unknown>;
  default(): Promise<unknown>;
}

/** A separate local window never inherits the authenticated app session. */
export function maintenanceWindow(actions: MaintenanceActions) {
  let window: BrowserWindow | undefined;
  let trustedUrl = '';
  let busy = false;
  ipcMain.handle('desktop:maintenance', async (event, action: unknown, value?: unknown) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== trustedUrl) throw new Error('Untrusted maintenance window');
    let acquired = false;
    try {
      if (action === 'status') return await actions.status();
      if (busy) throw new Error('Wait for the current action to finish.');
      busy = true;
      acquired = true;
      if (action === 'browse') {
        if (!['root', 'database', 'config', 'work'].includes(String(value))) throw new Error('Unknown installation path.');
        const result = await dialog.showOpenDialog(window, { title: value === 'database' ? 'Choose the existing SQLite database' : 'Choose the existing installation folder', properties: [value === 'database' ? 'openFile' : 'openDirectory'] });
        return { path: result.canceled ? undefined : result.filePaths[0] };
      }
      if (typeof action !== 'string' || !['retry', 'recover', 'logs', 'copy', 'inspect', 'use', 'default'].includes(action)) throw new Error('Unknown maintenance action.');
      return await actions[action as keyof MaintenanceActions](value) ?? {};
    } catch (error) { return { error: error instanceof Error ? error.message : 'Maintenance action failed.' }; }
    finally { if (acquired) busy = false; }
  });
  return {
    async show() {
      if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
      window = new BrowserWindow({ width: 800, height: 850, minWidth: 600, minHeight: 500, title: 'Ri local installation', backgroundColor: '#181a18',
        webPreferences: { preload: path.join(__dirname, 'maintenance-preload.cjs'), partition: `ri-maintenance-${randomBytes(16).toString('hex')}`, nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false } });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window.webContents.session.setPermissionCheckHandler(() => false);
      window.on('closed', () => { window = undefined; });
      trustedUrl = `data:text/html;charset=utf-8,${encodeURIComponent(maintenancePage(randomBytes(24).toString('hex')))}`;
      await window.loadURL(trustedUrl);
    },
    close() { window?.destroy(); window = undefined; },
  };
}
