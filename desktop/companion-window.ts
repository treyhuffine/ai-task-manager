import { ipcMain } from 'electron';
import { randomBytes } from 'node:crypto';
import { companionPage } from './companion-page';
import { createLocalWindow, type LocalWindow } from './local-window';

export const companionActions = ['status', 'preferences', 'create-home', 'use-detected', 'connect', 'enable-worker', 'stop-worker', 'resume-worker', 'login', 'open', 'updates', 'update-check', 'update-download', 'update-apply', 'update-later', 'recovery', 'notification-enable', 'notification-disable', 'notification-test'] as const;
export type CompanionAction = typeof companionActions[number];
export interface CompanionViewOptions { view?: 'auto' | 'settings' | 'connect' | 'help'; logoDataUrl?: string }

/** Only this local window may operate on this computer. A Home page never
 * receives this bridge or shares the companion's cookie/session partition. */
export function companionWindow(action: (name: CompanionAction, value?: unknown) => Promise<unknown>, host: LocalWindow = createLocalWindow()) {
  let shownOptions: string | undefined;
  let busy = false;
  ipcMain.handle('desktop:companion', async (event, name: unknown, value?: unknown) => {
    if (!host.owns('companion', event)) throw new Error('Untrusted companion window');
    if (typeof name !== 'string' || !(companionActions as readonly string[]).includes(name)) throw new Error('Unknown companion action');
    if (busy && name !== 'status') return { error: 'Wait for the current action to finish.' };
    const mutating = name !== 'status';
    if (mutating) busy = true;
    try { return await action(name as CompanionAction, value) ?? {}; }
    catch (error) { return { error: error instanceof Error ? error.message : 'The action could not finish. Try again.' }; }
    finally { if (mutating) busy = false; }
  });
  return {
    async show(options: CompanionViewOptions = {}) {
      const key = JSON.stringify({ view: options.view ?? 'auto', logoDataUrl: options.logoDataUrl });
      if (host.get('companion') && shownOptions === key) { host.reveal(); return; }
      shownOptions = key;
      try {
        await host.show({ id: 'companion', title: 'Ri', width: 640, height: 820,
          html: companionPage(randomBytes(24).toString('hex'), options) });
      } catch (error) { if (shownOptions === key) shownOptions = undefined; throw error; }
    },
    close() { host.close('companion'); },
  };
}
