import { Menu, Tray, type MenuItemConstructorOptions } from 'electron';
import { APP_NAME } from '../src/constants/app';
import { createTrayIcon } from './tray-icon';

export interface DesktopMenuActions {
  show(): void;
  hide(): void;
  notifications(): void;
  update(): void;
  status(): void;
  recovery(): void;
  quit(): void;
}

/** The tray and application menu share commands, including the guarded Quit. */
export function desktopMenuCommands(actions: DesktopMenuActions) {
  return {
    show: { id: 'ri-show-window', label: `Show ${APP_NAME}`, click: actions.show },
    hide: { id: 'ri-hide-window', label: 'Close Window', click: actions.hide },
    notifications: { id: 'ri-notifications', label: 'Notifications…', click: actions.notifications },
    update: { id: 'ri-desktop-update', label: 'Check for Desktop Update…', click: actions.update },
    status: { id: 'ri-service-status', label: 'Service Status…', click: actions.status },
    recovery: { id: 'ri-recovery', label: 'Local Installation and Recovery…', click: actions.recovery },
    quit: { id: 'ri-quit', label: `Quit ${APP_NAME}`, click: actions.quit },
  } satisfies Record<keyof DesktopMenuActions, MenuItemConstructorOptions>;
}

export function createDesktopTray(repo: string, actions: DesktopMenuActions): Tray | undefined {
  let tray: Tray | undefined;
  try {
    tray = new Tray(createTrayIcon(repo));
    const commands = desktopMenuCommands(actions);
    tray.setToolTip(APP_NAME);
    tray.setContextMenu(Menu.buildFromTemplate([
      commands.show, commands.hide, { type: 'separator' }, commands.notifications,
      commands.update, commands.status, commands.recovery, { type: 'separator' }, commands.quit,
    ]));
    // On macOS the primary click opens the native menu. Linux activation varies
    // by desktop environment, while its context menu also retains Show Ri.
    if (process.platform !== 'darwin') tray.on('click', actions.show);
    tray.on('double-click', actions.show);
    return tray;
  } catch {
    tray?.destroy();
    console.warn('[desktop] The menu bar or tray is unavailable. Closing will minimize the window.');
    return undefined;
  }
}
