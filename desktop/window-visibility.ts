import type { BrowserWindow } from 'electron';

type Window = Pick<BrowserWindow, 'isDestroyed' | 'isMinimized' | 'restore' | 'show' | 'focus' | 'hide' | 'minimize'>;

/** Retain the renderer and its pending work. Linux has no reliable Electron
 * API for detecting an actual tray host, so keep its taskbar entry reachable. */
export function backgroundWindow(window: Window | undefined, platform: NodeJS.Platform, trayAvailable: boolean) {
  if (!window || window.isDestroyed()) return;
  if (platform === 'darwin' && trayAvailable) window.hide();
  else window.minimize();
}

export function revealWindow(window: Window | undefined) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
