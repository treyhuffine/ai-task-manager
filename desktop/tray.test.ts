import { beforeEach, expect, it, vi } from 'vitest';
import { createDesktopTray, desktopMenuCommands, activityMenuItems, updateDesktopTray, type DesktopMenuActions } from './tray';

const mocks = vi.hoisted(() => ({
  icon: vi.fn(() => ({})), menu: vi.fn(value => value), tooltip: vi.fn(), context: vi.fn(), title: vi.fn(), on: vi.fn(), destroy: vi.fn(),
}));
vi.mock('./tray-icon', () => ({ createTrayIcon: mocks.icon }));
vi.mock('electron', () => ({ Menu: { buildFromTemplate: mocks.menu }, Tray: class {
  setToolTip = mocks.tooltip; setContextMenu = mocks.context; setTitle = mocks.title; on = mocks.on; destroy = mocks.destroy;
} }));
beforeEach(() => { vi.clearAllMocks(); });
const actions = (): DesktopMenuActions => ({ show: vi.fn(), hide: vi.fn(), notifications: vi.fn(), update: vi.fn(), status: vi.fn(), recovery: vi.fn(), quit: vi.fn(), capture: vi.fn(), preferences: vi.fn() });

it('routes tray and application commands to the same guarded callbacks', () => {
  const callbacks = actions(); const commands = desktopMenuCommands(callbacks);
  expect(new Set(Object.values(commands).map(item => item.id)).size).toBe(9);
  for (const key of Object.keys(callbacks) as (keyof DesktopMenuActions)[]) {
    commands[key].click(); expect(callbacks[key]).toHaveBeenCalledOnce();
  }
  expect(commands.quit).toMatchObject({ id: 'ri-quit', label: 'Quit Ri' });
  expect(commands.hide.label).toBe('Close Window');
});

it('projects activity to reachable session callbacks and clears stale targets on disconnect', () => {
  const open = vi.fn();
  const activity = { running: 2, needsInput: 1, unread: 1, attention: 2, targets: [{ sessionId: 'session-1', label: 'Plan', state: 'needsInput' as const }] };
  const items = activityMenuItems({ connection: 'connected', activity }, open);
  expect(items[0]).toMatchObject({ label: '2 running · 1 needs input · 1 unread', enabled: false });
  items[1].click!({} as never, undefined, {} as never); expect(open).toHaveBeenCalledWith('session-1');
  expect(activityMenuItems({ connection: 'disconnected', activity }, open)).toEqual([{ id: 'ri-activity-status', label: 'Ri service is unreachable', enabled: false }]);
  const callbacks = actions(); const tray = createDesktopTray('/fixture', callbacks)!;
  updateDesktopTray(tray, callbacks, { connection: 'connected', activity }, open);
  expect(mocks.tooltip).toHaveBeenLastCalledWith('Ri: 2 running · 1 needs input · 1 unread');
  updateDesktopTray(tray, callbacks, { connection: 'disconnected' }, open);
  expect(mocks.context.mock.calls.at(-1)![0].some((item: { id?: string }) => item.id === 'ri-activity-session-1')).toBe(false);
});

it('creates the native menu with reachable Show and explicit Quit actions', () => {
  const callbacks = actions(); const tray = createDesktopTray('/fixture', callbacks);
  expect(tray).toBeDefined();
  expect(mocks.icon).toHaveBeenCalledWith('/fixture');
  const menu = mocks.context.mock.calls[0][0];
  expect(menu[0]).toMatchObject({ id: 'ri-show-window', click: callbacks.show });
  expect(menu.at(-1)).toMatchObject({ id: 'ri-quit', click: callbacks.quit });
  expect(mocks.on).toHaveBeenCalledWith('double-click', callbacks.show);
});

it('falls back without terminating the app when icon creation fails', () => {
  mocks.icon.mockImplementationOnce(() => { throw new Error('Missing asset'); });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try { expect(createDesktopTray('/fixture', actions())).toBeUndefined(); expect(warning).toHaveBeenCalledOnce(); }
  finally { warning.mockRestore(); }
});

it('destroys a partially initialized tray if its menu fails', () => {
  mocks.context.mockImplementationOnce(() => { throw new Error('Missing tray host'); });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try { expect(createDesktopTray('/fixture', actions())).toBeUndefined(); expect(mocks.destroy).toHaveBeenCalledOnce(); }
  finally { warning.mockRestore(); }
});
