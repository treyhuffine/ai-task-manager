/**
 * A team in its own window (docs/homes-spec.md §3.1, §9.1, P6.2/P6.3).
 *
 * Each team gets a cookie and storage partition of its own, so its member
 * session, caches and drafts never mix with the personal Ri or another team.
 * Its pages get no preload and no bridge: a team's member or owner never
 * reaches this computer's native capabilities, local service or worker,
 * even when the team is hosted here. Navigation stays on the team's origin,
 * other links open in the browser, and a team hosted here is trusted only by
 * its own pinned certificate.
 */

import { BrowserWindow, dialog, session, shell } from 'electron';
import { PAIRING_TOKEN_FRAGMENT_KEY } from '../src/constants/app';
import { signInDesktopSession } from './session-auth';
import { certificateDecision, externalWebUrl, sameOrigin } from './trust';
import type { SavedTeam } from './teams';

export interface TeamWindowOptions {
  icon?: Electron.NativeImage;
  background: () => string;
}

export function teamPartition(teamId: string): string {
  return `persist:ri-team-${teamId.replace(/[^A-Za-z0-9-]/g, '')}`;
}

export function teamWindows(options: TeamWindowOptions) {
  const windows = new Map<string, BrowserWindow>();

  function openExternal(url: string) {
    const safe = externalWebUrl(url);
    if (safe) void shell.openExternal(safe);
  }

  return {
    has(id: string) {
      const win = windows.get(id);
      return !!win && !win.isDestroyed();
    },
    focus(id: string) {
      const win = windows.get(id);
      if (!win || win.isDestroyed()) return false;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return true;
    },
    /** Open a team, signed in as this desktop's member. A team hosted here passes its pinned certificate. */
    async open(team: SavedTeam, local?: { certificate: string }) {
      if (this.focus(team.id)) return;
      const ses = session.fromPartition(teamPartition(team.id));
      if (local) {
        ses.setCertificateVerifyProc((request, callback) =>
          callback(certificateDecision(request.hostname, request.certificate.data, { origin: team.origin, certificate: local.certificate })));
      }
      // A team page asks for nothing native.
      ses.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
      ses.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write');
      const win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 640,
        minHeight: 480,
        title: team.name,
        show: false,
        backgroundColor: options.background(),
        ...(options.icon ? { icon: options.icon } : {}),
        // A standard title bar: a team page has no desktop chrome to make
        // room for inset window controls, and the title names the space.
        webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
      });
      windows.set(team.id, win);
      win.on('closed', () => windows.delete(team.id));
      win.on('page-title-updated', (event) => event.preventDefault());
      win.webContents.setWindowOpenHandler(({ url }) => {
        openExternal(url);
        return { action: 'deny' };
      });
      win.webContents.on('will-navigate', (event, url) => {
        if (sameOrigin(url, team.origin)) return;
        event.preventDefault();
        openExternal(url);
      });
      // A page holding unsaved shared text asks before it closes, as a browser would.
      win.webContents.on('will-prevent-unload', (event) => {
        const choice = dialog.showMessageBoxSync(win, {
          type: 'question',
          message: 'Leave with unsaved changes?',
          detail: 'Your text is kept on this computer and offered again when you reopen it.',
          buttons: ['Stay', 'Leave'],
          defaultId: 0,
          cancelId: 0,
        });
        if (choice === 1) event.preventDefault();
      });
      win.once('ready-to-show', () => win.show());
      try {
        await signInDesktopSession({ origin: team.origin, token: team.token, local: !!local, fetch: (url, init) => ses.fetch(url, init) });
        await win.loadURL(`${team.origin}/#${PAIRING_TOKEN_FRAGMENT_KEY}=${encodeURIComponent(team.token)}`);
      } catch (error) {
        if (!win.isDestroyed()) win.destroy();
        const code = (error as { code?: string }).code;
        if (code === 'credential') {
          throw Object.assign(new Error(`${team.name} signed this computer out. To use it again, paste a new invitation or sign-in link in Connect to Ri.`), { code: 'signed_out' });
        }
        throw new Error(`Couldn't reach ${team.name}. ${local ? 'Its service on this computer may still be starting.' : 'The computer hosting it may be asleep or offline.'} Try again.`);
      }
    },
    closeAll() {
      for (const win of windows.values()) if (!win.isDestroyed()) win.destroy();
      windows.clear();
    },
  };
}
