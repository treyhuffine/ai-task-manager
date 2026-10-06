import { beforeEach, expect, it, vi } from 'vitest';
import { companionWindow } from './companion-window';
import { companionPage } from './companion-page';

const mocks = vi.hoisted(() => ({ handler: vi.fn(), window: undefined as unknown, options: undefined as unknown }));
vi.mock('electron', () => ({
  ipcMain: { handle: (_name: string, handler: unknown) => { mocks.handler = handler as typeof mocks.handler; } },
  BrowserWindow: class {
    webContents = { mainFrame: { url: '' }, setWindowOpenHandler: vi.fn(), on: vi.fn(), session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() } };
    constructor(options: unknown) { mocks.window = this; mocks.options = options; }
    loadURL(url: string) { this.webContents.mainFrame.url = url; return Promise.resolve(); }
    on() {} show() {} focus() {} restore() {} destroy() {} isDestroyed() { return false; } isMinimized() { return false; }
  },
}));
const action = vi.fn();
function event() { const window = mocks.window as { webContents: { mainFrame: { url: string } } }; return { sender: window.webContents, senderFrame: window.webContents.mainFrame }; }
beforeEach(async () => { vi.clearAllMocks(); action.mockResolvedValue({ role: 'first-run' }); await companionWindow(action).show(); });
it('keeps setup and service control inaccessible to remote Home pages and subframes', async () => {
  expect(mocks.options).toMatchObject({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
  await expect(mocks.handler(event(), 'status')).resolves.toEqual({ role: 'first-run' });
  action.mockClear(); const good = event();
  await expect(mocks.handler({ ...good, sender: {} }, 'create-home')).rejects.toThrow('Untrusted');
  await expect(mocks.handler({ ...good, senderFrame: { url: good.senderFrame.url } }, 'stop-worker')).rejects.toThrow('Untrusted');
  good.senderFrame.url = 'https://mini.example';
  await expect(mocks.handler(good, 'update-apply')).rejects.toThrow('Untrusted');
  expect(action).not.toHaveBeenCalled();
});
it('serializes mutations while allowing status without releasing the mutation lock', async () => {
  let finish!: () => void;
  action.mockImplementation(name => name === 'connect' ? new Promise<void>(resolve => { finish = resolve; }) : {});
  const pending = mocks.handler(event(), 'connect', { pairingLink: 'secret' });
  await mocks.handler(event(), 'status');
  expect(await mocks.handler(event(), 'create-home')).toMatchObject({ error: 'Wait for the current action to finish.' });
  finish(); await pending;
  await mocks.handler(event(), 'create-home');
  expect(action).toHaveBeenCalledWith('create-home', undefined);
});
it('rejects arbitrary native commands and uses a network-free page with text-only status rendering', async () => {
  await expect(mocks.handler(event(), 'exec', 'shell command')).rejects.toThrow('Unknown');
  const page = companionPage('abc123');
  expect(page).toContain("default-src 'none'"); expect(page).toContain("script-src 'nonce-abc123'");
  expect(page).not.toContain('innerHTML'); expect(page).not.toContain('unsafe-inline');
  expect(() => companionPage('" onload=alert(1)')).toThrow();
});
