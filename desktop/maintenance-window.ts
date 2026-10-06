import { ipcMain, dialog } from 'electron';
import { randomBytes } from 'node:crypto';
import { maintenancePage } from './maintenance-page';
import { createLocalWindow, type LocalWindow } from './local-window';

export interface MaintenanceActions {
  status(): Promise<unknown>;
  retry(): Promise<unknown>;
  recover(): Promise<unknown>;
  logs(): Promise<unknown>;
  copy(): Promise<unknown>;
  inspect(value: unknown): Promise<unknown>;
  use(value: unknown): Promise<unknown>;
  default(): Promise<unknown>;
  back?(): Promise<unknown>;
}

/** A separate local window never inherits the authenticated app session. */
export function maintenanceWindow(actions: MaintenanceActions, host: LocalWindow = createLocalWindow()) {
  let busy = false;
  ipcMain.handle('desktop:maintenance', async (event, action: unknown, value?: unknown) => {
    if (!host.owns('maintenance', event)) throw new Error('Untrusted maintenance window');
    let acquired = false;
    try {
      if (action === 'status') return await actions.status();
      if (busy) throw new Error('Wait for the current action to finish.');
      busy = true;
      acquired = true;
      if (action === 'browse') {
        if (!['root', 'database', 'config', 'work'].includes(String(value))) throw new Error('Unknown installation path.');
        const result = await dialog.showOpenDialog(host.get('maintenance')!, { title: value === 'database' ? 'Choose the existing SQLite database' : 'Choose the existing installation folder', properties: [value === 'database' ? 'openFile' : 'openDirectory'] });
        return { path: result.canceled ? undefined : result.filePaths[0] };
      }
      if (typeof action !== 'string' || !['retry', 'recover', 'logs', 'copy', 'inspect', 'use', 'default', 'back'].includes(action)) throw new Error('Unknown maintenance action.');
      const operation = actions[action as keyof MaintenanceActions];
      if (!operation) throw new Error('Unknown maintenance action.');
      return await operation(value) ?? {};
    } catch (error) { return { error: error instanceof Error ? error.message : 'Maintenance action failed.' }; }
    finally { if (acquired) busy = false; }
  });
  return {
    async show() {
      if (host.get('maintenance')) { host.reveal(); return; }
      await host.show({ id: 'maintenance', title: 'Ri settings', width: 800, height: 850,
        html: maintenancePage(randomBytes(24).toString('hex')) });
    },
    close() { host.close('maintenance'); },
  };
}
