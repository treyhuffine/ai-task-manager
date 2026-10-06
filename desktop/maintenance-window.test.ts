import type { BrowserWindow } from 'electron';
import { createLocalWindow } from './local-window';
import { beforeEach, expect, it, vi } from 'vitest';
import { maintenanceWindow } from './maintenance-window';
import { maintenancePage } from './maintenance-page';

const mocks = vi.hoisted(() => ({ handler: vi.fn(), window: undefined as unknown, options: undefined as unknown, showOpenDialog: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: (_name: string, handler: unknown) => { mocks.handler = handler as typeof mocks.handler; } },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  WebContentsView: class {
    webContents = {
      mainFrame: { url: '' }, setWindowOpenHandler: vi.fn(), on: vi.fn(),
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
      loadURL: (url: string) => { this.webContents.mainFrame.url = url; return Promise.resolve(); },
      isDestroyed: () => false, focus: vi.fn(), close: vi.fn(),
    };
    constructor(options: unknown) { mocks.window = this; mocks.options = options; }
    setBounds() {} setVisible() {}
  },
}));
const parent = {
  contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  webContents: { focus: vi.fn(), isDestroyed: () => false },
  on: vi.fn(), removeListener: vi.fn(), getContentBounds: () => ({ x: 30, y: 40, width: 1000, height: 800 }),
  isDestroyed: () => false, isMinimized: () => false, isVisible: () => true,
};
function localHost() { return createLocalWindow({ window: () => parent as unknown as BrowserWindow }); }

const actions = { status: vi.fn(), retry: vi.fn(), recover: vi.fn(), logs: vi.fn(), copy: vi.fn(), inspect: vi.fn(), use: vi.fn(), default: vi.fn() };
function trustedEvent() {
  const window = mocks.window as { webContents: { mainFrame: { url: string } } };
  return { sender: window.webContents, senderFrame: window.webContents.mainFrame };
}
beforeEach(async () => { vi.clearAllMocks(); actions.status.mockResolvedValue({ phase: 'stopped' }); await maintenanceWindow(actions, localHost()).show(); });
it('isolates the maintenance renderer and permits only its exact main frame', async () => {
  expect(mocks.options).toMatchObject({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
  await expect(mocks.handler(trustedEvent(), 'status')).resolves.toEqual({ phase: 'stopped' });
  const event = trustedEvent();
  await expect(mocks.handler({ ...event, sender: {} }, 'recover')).rejects.toThrow('Untrusted');
  await expect(mocks.handler({ ...event, senderFrame: { url: event.senderFrame.url } }, 'recover')).rejects.toThrow('Untrusted');
  event.senderFrame.url = 'https://untrusted.example';
  await expect(mocks.handler(event, 'recover')).rejects.toThrow('Untrusted');
  expect(actions.recover).not.toHaveBeenCalled();
});
it('refuses arbitrary commands and paths without invoking a native dialog', async () => {
  expect(await mocks.handler(trustedEvent(), 'execute', 'sh')).toMatchObject({ error: 'Unknown maintenance action.' });
  expect(await mocks.handler(trustedEvent(), 'back')).toMatchObject({ error: 'Unknown maintenance action.' });
  expect(await mocks.handler(trustedEvent(), 'browse', '/etc/passwd')).toMatchObject({ error: 'Unknown installation path.' });
  expect(mocks.showOpenDialog).not.toHaveBeenCalled();
});
it('keeps mutation exclusion while status polls during a long recovery', async () => {
  let finish!: () => void;
  actions.recover.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  const recovering = mocks.handler(trustedEvent(), 'recover');
  await mocks.handler(trustedEvent(), 'status');
  expect(await mocks.handler(trustedEvent(), 'retry')).toMatchObject({ error: 'Wait for the current action to finish.' });
  expect(actions.retry).not.toHaveBeenCalled();
  finish(); await recovering;
  await mocks.handler(trustedEvent(), 'retry');
  expect(actions.retry).toHaveBeenCalledOnce();
});
it('uses a non-network page with nonce scripts and text-only diagnostic rendering', () => {
  const html = maintenancePage('abc123');
  expect(html).toContain("default-src 'none'");
  expect(html).toContain("script-src 'nonce-abc123'");
  expect(html).not.toContain('innerHTML');
  expect(html).not.toContain('unsafe-inline');
  expect(() => maintenancePage('\" onload=alert(1)')).toThrow('Invalid');
});

it('parents folder selection to the existing native app window', async () => {
  mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/chosen/install'] });
  expect(await mocks.handler(trustedEvent(), 'browse', 'root')).toEqual({ path: '/chosen/install' });
  expect(mocks.showOpenDialog).toHaveBeenCalledWith(parent, expect.objectContaining({ properties: ['openDirectory'] }));
});
