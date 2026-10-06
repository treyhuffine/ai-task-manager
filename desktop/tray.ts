import { Menu, Tray, type MenuItemConstructorOptions } from 'electron';
import { APP_NAME } from '../src/constants/app';
import { createTrayIcon } from './tray-icon';
import type { DesktopActivitySnapshot } from '../src/lib/sessions/desktop-activity-contract';

export interface DesktopMenuActions {
  show(): void;
  hide(): void;
  notifications(): void;
  update(): void;
  status(): void;
  recovery(): void;
  quit(): void;
  capture(): void;
  preferences(): void;
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
    capture: { id: 'ri-quick-capture', label: 'Quick Capture', click: actions.capture },
    preferences: { id: 'ri-desktop-preferences', label: 'Desktop Settings…', click: actions.preferences },
  } satisfies Record<keyof DesktopMenuActions, MenuItemConstructorOptions>;
}

export function activitySummary(snapshot: DesktopActivitySnapshot) {
  if (snapshot.connection === 'connected' && !snapshot.activity) return 'Connected to your Home';
  if (snapshot.connection !== 'connected' || !snapshot.activity) return snapshot.connection === 'connecting' ? 'Connecting to Ri…' : 'Ri service is unreachable';
  const { running, needsInput, unread } = snapshot.activity;
  if (!running && !needsInput && !unread) return 'No sessions need attention';
  return `${running} running · ${needsInput} ${needsInput === 1 ? 'needs' : 'need'} input · ${unread} unread`;
}

export function activityMenuItems(snapshot: DesktopActivitySnapshot, open: (sessionId: string) => void): MenuItemConstructorOptions[] {
  return [
    { id: 'ri-activity-status', label: activitySummary(snapshot), enabled: false },
    ...(snapshot.connection === 'connected' ? snapshot.activity?.targets ?? [] : []).map(target => ({
      id: `ri-activity-${target.sessionId}`,
      label: `${target.state === 'needsInput' ? 'Needs input' : target.state === 'unread' ? 'Unread' : 'Running'}: ${process.platform === 'darwin' ? target.label : target.label.replaceAll('&', '&&')}`,
      click: () => open(target.sessionId),
    })),
  ];
}

export function updateDesktopTray(tray: Tray, actions: DesktopMenuActions, snapshot: DesktopActivitySnapshot, open: (sessionId: string) => void, localItems: MenuItemConstructorOptions[] = []) {
  const commands = desktopMenuCommands(actions);
  tray.setToolTip(`${APP_NAME}: ${activitySummary(snapshot)}`);
  if (process.platform === 'darwin') tray.setTitle(snapshot.connection === 'connected' && snapshot.activity?.attention ? String(snapshot.activity.attention) : '');
  tray.setContextMenu(Menu.buildFromTemplate([
    ...localItems, ...activityMenuItems(snapshot, open), { type: 'separator' },
    commands.capture, commands.show, commands.hide, { type: 'separator' }, commands.preferences, commands.notifications,
    commands.update, commands.status, commands.recovery, { type: 'separator' }, commands.quit,
  ]));
}

export function createDesktopTray(repo: string, actions: DesktopMenuActions): Tray | undefined {
  let tray: Tray | undefined;
  try {
    tray = new Tray(createTrayIcon(repo));
    const commands = desktopMenuCommands(actions);
    tray.setToolTip(APP_NAME);
    tray.setContextMenu(Menu.buildFromTemplate([
      commands.show, commands.hide, commands.capture, commands.preferences, { type: 'separator' }, commands.notifications,
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
