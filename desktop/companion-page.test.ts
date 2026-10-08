import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { describe, expect, it, vi } from 'vitest';
import { companionPage, type CompanionPageOptions } from './companion-page';
import { maintenancePage } from './maintenance-page';

const preferences = {
  login: { enabled: false, supported: false, detail: 'Requires the installed app.' },
  shortcut: { enabled: true, accelerator: 'CommandOrControl+Shift+Space', state: 'active' },
};
const fresh = { role: 'first-run', homeSelected: false, preferences, desktop: '1.0' };
const viewer = {
  role: 'viewer', home: { name: 'My Ri', hostName: 'Home computer' }, preferences,
  service: { phase: 'running' }, desktop: '1.0', login: { enabled: false },
};
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

async function renderPage(initial: Record<string, unknown>, options: CompanionPageOptions = {}, action?: (name: string, value?: unknown) => unknown) {
  let status = initial;
  const { document } = parseHTML(companionPage('test123', options));
  const request = vi.fn(async (name: string, value?: unknown) => name === 'status' ? status : action?.(name, value) ?? {});
  let poll!: () => Promise<void>;
  vm.runInNewContext(document.querySelector('script')!.textContent!, {
    document, window: { riCompanion: { request } }, setInterval: (callback: () => Promise<void>) => { poll = callback; },
  });
  await flush();
  const element = (id: string) => document.getElementById(id)!;
  const input = (id: string) => element(id) as HTMLInputElement;
  return {
    document, request, element, input,
    setStatus(next: Record<string, unknown>) { status = next; },
    async click(id: string) { await element(id).onclick!(new Event('click') as PointerEvent); await flush(); },
    async change(id: string, checked: boolean) { input(id).checked = checked; await input(id).onchange!(new Event('change')); await flush(); },
    async refresh(next = status) { status = next; await poll(); await flush(); },
    visible(id: string) {
      for (let node: HTMLElement | null = element(id); node; node = node.parentElement) if (node.hidden) return false;
      return true;
    },
  };
}

describe('desktop welcome and connection flow', () => {
  it('shows two choices with help, and keeps pairing and all configuration out of fresh welcome', async () => {
    const ui = await renderPage(fresh);
    expect(ui.element('heading').textContent).toBe('Welcome to Ri');
    expect(ui.visible('create-home')).toBe(true);
    expect(ui.visible('choose-connect')).toBe(true);
    expect(ui.visible('help-link')).toBe(true);
    for (const id of ['connect', 'settings', 'preferences', 'notifications', 'service', 'updates', 'device']) expect(ui.visible(id), id).toBe(false);
    expect(ui.element('advanced').hasAttribute('open')).toBe(false);
    expect(ui.request.mock.calls.every(([name]) => name === 'status')).toBe(true);
  });

  it('requires choosing Connect before pairing, and local agents require explicit opt-in', async () => {
    const ui = await renderPage(fresh);
    await ui.click('choose-connect');
    expect(ui.visible('welcome')).toBe(false);
    expect(ui.visible('connect')).toBe(true);
    expect(ui.input('run-work').checked).toBe(false);
    ui.input('pairing').value = 'https://home.example/#token=fixture';
    await ui.click('connect-home');
    expect(ui.request).toHaveBeenCalledWith('connect', { pairingLink: 'https://home.example/#token=fixture', runWork: false });
    await ui.click('choose-connect');
    ui.input('pairing').value = 'https://home.example/#token=fixture';
    ui.input('run-work').checked = true;
    await ui.click('connect-home');
    expect(ui.request).toHaveBeenLastCalledWith('status', undefined);
    expect(ui.request.mock.calls.filter(([name]) => name === 'connect').at(-1)?.[1]).toEqual({ pairingLink: 'https://home.example/#token=fixture', runWork: true });
  });

  it('resets local execution consent when leaving and re-entering pairing', async () => {
    const ui = await renderPage(fresh);
    await ui.click('choose-connect');
    ui.input('run-work').checked = true;
    await ui.click('back');
    expect(ui.visible('welcome')).toBe(true);
    await ui.click('choose-connect');
    expect(ui.input('run-work').checked).toBe(false);
    expect(ui.request.mock.calls.every(([name]) => name === 'status')).toBe(true);
  });

  it('keeps a rejected pairing visible with its input intact and does not create a Home', async () => {
    const ui = await renderPage(fresh, {}, name => name === 'connect' ? { error: 'This pairing key is no longer valid.' } : {});
    await ui.click('choose-connect');
    ui.input('pairing').value = 'https://home.example/#token=rejected';
    await ui.click('connect-home');
    await ui.refresh();
    expect(ui.visible('connect')).toBe(true);
    expect(ui.element('error').textContent).toBe('This pairing key is no longer valid.');
    expect(ui.input('pairing').value).toContain('#token=rejected');
    expect(ui.request.mock.calls.some(([name]) => name === 'create-home')).toBe(false);
  });

  it('keeps a successful connection usable when optional local execution enrollment fails', async () => {
    const ui = await renderPage(fresh, {}, name => {
      if (name !== 'connect') return {};
      ui.setStatus({ ...viewer, connecting: false });
      return { executionError: 'This computer could not finish enrollment.' };
    });
    await ui.click('choose-connect');
    ui.input('pairing').value = 'https://home.example/#token=accepted';
    ui.input('run-work').checked = true;
    await ui.click('connect-home');
    expect(ui.visible('connect')).toBe(false);
    expect(ui.input('pairing').value).toBe('');
    expect(ui.visible('settings')).toBe(true);
    expect(ui.visible('open')).toBe(true);
    expect(ui.input('open').disabled).toBe(false);
    expect(ui.visible('enable-worker')).toBe(true);
    expect(ui.element('execution').hasAttribute('open')).toBe(true);
    expect(ui.element('error').textContent).toContain('Connected to your Ri, but local agents could not be enabled.');
    expect(ui.element('error').textContent).toContain('You can retry below or open Ri without local agents.');
    await ui.refresh();
    expect(ui.element('error').textContent).toContain('could not finish enrollment');
    await ui.click('enable-worker');
    expect(ui.request).toHaveBeenCalledWith('enable-worker', undefined);
    await ui.click('open');
    expect(ui.request).toHaveBeenCalledWith('open', undefined);
    expect(ui.request.mock.calls.filter(([name]) => name === 'connect')).toHaveLength(1);
    expect(ui.request.mock.calls.some(([name]) => name === 'create-home')).toBe(false);
  });

  it('proceeds directly to connection progress after pairing and local execution both succeed', async () => {
    const ui = await renderPage(fresh, {}, name => {
      if (name === 'connect') ui.setStatus({ ...viewer, role: 'worker', connecting: true, hasViewer: false });
      return {};
    });
    await ui.click('choose-connect');
    ui.input('pairing').value = 'https://home.example/#token=accepted';
    ui.input('run-work').checked = true;
    await ui.click('connect-home');
    expect(ui.visible('starting')).toBe(true);
    expect(ui.visible('settings')).toBe(false);
    expect(ui.element('error').textContent).toBe('');
  });

  it('opens built-in help without IPC or network and returns to the pairing form', async () => {
    const ui = await renderPage(fresh);
    await ui.click('choose-connect');
    const count = ui.request.mock.calls.length;
    await ui.click('help-link');
    expect(ui.visible('help')).toBe(true);
    expect(ui.element('help').textContent).toContain('starts unchecked');
    expect(ui.element('help').textContent).toContain('Your personal Ri can connect to team spaces');
    expect(ui.element('help').textContent).toContain('without setting up a personal Home');
    expect(ui.request).toHaveBeenCalledTimes(count);
    await ui.click('back');
    expect(ui.visible('connect')).toBe(true);
    expect(ui.request).toHaveBeenCalledTimes(count);
  });

  it('offers a retired installation its connection path without creating a new Home', async () => {
    const ui = await renderPage({ role: 'retired', reason: 'Your Ri moved to another computer.' });
    expect(ui.visible('create-home')).toBe(false);
    expect(ui.visible('reconnect')).toBe(true);
    expect(ui.visible('open')).toBe(false);
    await ui.click('reconnect');
    expect(ui.visible('connect')).toBe(true);
    expect(ui.input('run-work').checked).toBe(false);
  });

  it('shows local discovery context without putting paths into the primary copy or starting anything', async () => {
    const detected = { root: '/private/example/data', canUse: true };
    const ui = await renderPage({ ...fresh, detectedInstallation: detected });
    expect(ui.visible('use-detected')).toBe(true);
    expect(ui.element('detected-details').textContent).toBe(detected.root);
    expect(ui.element('detected-details').parentElement!.hasAttribute('open')).toBe(false);
    expect(ui.element('heading').textContent).not.toContain(detected.root);
    expect(ui.request.mock.calls.every(([name]) => name === 'status')).toBe(true);
    await ui.click('use-detected');
    expect(ui.request).toHaveBeenCalledWith('use-detected', undefined);
    await ui.refresh({ ...fresh, detectedInstallation: { ...detected, canUse: false, reason: 'Needs review' } });
    expect(ui.visible('use-detected')).toBe(false);
    expect(ui.visible('detected-recovery')).toBe(true);
    expect(ui.element('error').textContent).toBe('');
  });

  it.each([
    [{ ...fresh, homeSelected: true, connecting: true }, 'Starting Ri…'],
    [{ ...viewer, connecting: true, hasViewer: false }, 'Connecting to your Ri…'],
    [{ ...viewer, connecting: true, hasViewer: true }, 'Connecting to your Ri…'],
  ])('keeps startup progress simple until the main viewer is ready', async (state, text) => {
    const ui = await renderPage(state);
    expect(ui.visible('starting')).toBe(true);
    expect(ui.element('startup-status').textContent).toBe(text);
    expect(ui.visible('welcome')).toBe(false);
    expect(ui.visible('settings')).toBe(false);
    expect(ui.visible('advanced')).toBe(false);
  });

  it('retains the chosen Home after startup fails before a database exists', async () => {
    const ui = await renderPage({ ...fresh, homeSelected: true, connecting: false, connectionError: 'Local service configuration needs attention.' });
    expect(ui.visible('welcome')).toBe(false);
    expect(ui.visible('starting')).toBe(false);
    expect(ui.visible('device')).toBe(true);
    expect(ui.element('open').textContent).toBe('Try again');
    await ui.click('open');
    expect(ui.request).toHaveBeenCalledWith('open', undefined);
    expect(ui.request.mock.calls.some(([name]) => name === 'create-home')).toBe(false);
  });
});

describe('configured desktop settings', () => {
  it('keeps intentional settings usable while an existing viewer reconnects, without a duplicate retry', async () => {
    const ui = await renderPage({ ...viewer, connecting: true, hasViewer: true }, { view: 'settings' });
    expect(ui.visible('settings')).toBe(true);
    expect(ui.visible('preferences')).toBe(true);
    expect(ui.visible('starting')).toBe(false);
    expect(ui.element('status').textContent).toBe('Connecting to your Ri…');
    expect(ui.element('open').textContent).toBe('Connecting…');
    expect(ui.input('open').disabled).toBe(true);
    await ui.click('open');
    expect(ui.request.mock.calls.some(([name]) => name === 'open')).toBe(false);
    await ui.refresh({ ...viewer, connecting: false, hasViewer: true, connectionError: 'Still unreachable.' });
    expect(ui.element('open').textContent).toBe('Try again');
    expect(ui.input('open').disabled).toBe(false);
    await ui.click('open');
    expect(ui.request).toHaveBeenCalledWith('open', undefined);
    await ui.refresh({ ...viewer, connecting: false, hasViewer: true });
    expect(ui.element('open').textContent).toBe('Open Ri');
    expect(ui.input('open').disabled).toBe(false);
  });

  it('starts with collapsed preferences and preserves unsupported control restrictions after mutations', async () => {
    const ui = await renderPage(viewer, { view: 'settings' });
    expect(ui.visible('settings')).toBe(true);
    expect(ui.visible('welcome')).toBe(false);
    expect(ui.element('preferences').hasAttribute('open')).toBe(false);
    expect(ui.input('desktop-login').disabled).toBe(true);
    await ui.click('refresh');
    expect(ui.input('desktop-login').disabled).toBe(true);
    await ui.click('reconnect');
    expect(ui.visible('connect')).toBe(true);
    expect(ui.visible('run-work-label')).toBe(false);
  });

  it('submits a changed checkbox value before rendering the refreshed saved state', async () => {
    const ui = await renderPage({ ...viewer, preferences: { ...preferences, login: { enabled: false, supported: true } }, notifications: { supported: true, enabled: false } });
    await ui.change('desktop-login', true);
    expect(ui.request).toHaveBeenCalledWith('preferences', { type: 'login', enabled: true });
    await ui.change('native-notifications', true);
    expect(ui.request).toHaveBeenCalledWith('notification-enable', undefined);
    await ui.change('login', true);
    expect(ui.request).toHaveBeenCalledWith('login', { enabled: true });
  });

  it('shows persistent reconnect controls with collapsed preferences after a connection failure', async () => {
    const ui = await renderPage(viewer, { view: 'settings' });
    ui.element('preferences').setAttribute('open', '');
    await ui.refresh({ ...viewer, connectionError: 'Sign-in key revoked.' });
    expect(ui.element('heading').textContent).toBe('Ri on this device');
    expect(ui.element('open').textContent).toBe('Try again');
    expect(ui.visible('reconnect')).toBe(true);
    expect(ui.element('preferences').hasAttribute('open')).toBe(false);
    expect(ui.element('connection-error').textContent).toBe('Sign-in key revoked.');
    await ui.click('open');
    expect(ui.request).toHaveBeenCalledWith('open', undefined);
    expect(ui.element('connection-message').textContent).toContain('Your saved connection stays in place');
    expect(ui.request.mock.calls.some(([name]) => name === 'create-home')).toBe(false);
    ui.element('preferences').setAttribute('open', '');
    await ui.refresh();
    expect(ui.element('preferences').hasAttribute('open')).toBe(true);
  });

  it('does not overwrite an edited shortcut when polling status', async () => {
    const ui = await renderPage(viewer);
    ui.input('capture-shortcut').value = 'CommandOrControl+Shift+K';
    ui.input('capture-shortcut').oninput!(new Event('input'));
    await ui.refresh();
    expect(ui.input('capture-shortcut').value).toBe('CommandOrControl+Shift+K');
    await ui.click('capture-save');
    expect(ui.request).toHaveBeenCalledWith('preferences', { type: 'shortcut', enabled: true, accelerator: 'CommandOrControl+Shift+K' });
  });

  it('rejects untrusted initial markup inputs and renders status payloads only as text', async () => {
    expect(() => companionPage('bad"nonce')).toThrow();
    expect(() => companionPage('ok', { logoDataUrl: 'https://example.com/logo.svg' })).toThrow();
    expect(() => companionPage('ok', { logoDataUrl: 'data:image/png;base64,a" onload="alert(1)' })).toThrow();
    const html = companionPage('ok', { logoDataUrl: 'data:image/png;base64,YQ==' });
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain('innerHTML');
    expect(html).not.toContain('unsafe-inline');
    const ui = await renderPage({ ...viewer, home: { name: '<img src=x onerror=alert(1)>' } });
    expect(ui.element('status').textContent).toContain('<img src=x onerror=alert(1)>');
    expect(ui.element('status').querySelector('img')).toBeNull();
  });
});

describe('quiet startup recovery', () => {
  const issue = { kind: 'network', message: 'Reconnecting to Ri…', detail: 'The request timed out.', retryable: true };
  it('keeps a transient startup error behind the connecting screen until the grace period ends', async () => {
    const state = { ...viewer, connectionError: issue.detail, connection: { phase: 'failed', issue, showNotice: false } };
    const ui = await renderPage(state);
    expect(ui.visible('starting')).toBe(true);
    expect(ui.visible('device')).toBe(false);
    expect(ui.visible('settings')).toBe(false);
    await ui.refresh({ ...state, connection: { ...state.connection, showNotice: true } });
    expect(ui.visible('starting')).toBe(false);
    expect(ui.visible('device')).toBe(true);
    expect(ui.visible('settings')).toBe(false);
    expect(ui.visible('advanced')).toBe(false);
    expect(ui.element('intro').textContent).toBe('');
    expect(ui.element('connection-message').textContent).toContain('automatically');
    expect(ui.element('connection-error').textContent).toBe(issue.detail);
    expect(ui.visible('reconnect')).toBe(false);
    await ui.click('startup-settings');
    expect(ui.visible('settings')).toBe(true);
  });

  it('offers retry for a slow initial connection even before the request fails', async () => {
    const ui = await renderPage({ ...viewer, connecting: true, connection: { phase: 'connecting', issue: null, showNotice: true } });
    expect(ui.element('heading').textContent).toBe('Taking longer to connect');
    expect(ui.visible('settings')).toBe(false);
    expect(ui.input('open').disabled).toBe(false);
    await ui.click('open');
    expect(ui.request).toHaveBeenCalledWith('open', undefined);
    expect(ui.visible('progress')).toBe(false);
  });

  it('offers sign-in for rejected credentials and retains a route back to the loaded view', async () => {
    const auth = { kind: 'sign_in', message: 'This computer needs to sign in again.', detail: 'Device access was removed.', retryable: false };
    const ui = await renderPage({ ...viewer, hasViewer: true, connectionError: auth.detail, connection: { phase: 'failed', issue: auth, showNotice: true } });
    expect(ui.element('heading').textContent).toBe(auth.message);
    expect(ui.element('reconnect').textContent).toBe('Sign in again');
    expect(ui.element('connection-message').textContent).not.toContain('awake');
    expect(ui.visible('return-to-app')).toBe(true);
    await ui.click('return-to-app');
    expect(ui.request).toHaveBeenCalledWith('return-to-app', undefined);
    await ui.click('reconnect');
    expect(ui.visible('connect')).toBe(true);
  });
});

it('keeps installation paths behind deliberate disclosure and provides a native Back action', async () => {
  const { document } = parseHTML(maintenancePage('test123'));
  const request = vi.fn(async () => ({ phase: 'stopped', identity: { root: '/fixture', database: '/fixture/data.db', config: '/fixture/config', work: '/fixture/work' } }));
  vm.runInNewContext(document.querySelector('script')!.textContent!, { document, window: { riMaintenance: { request } }, setInterval() {} });
  await flush();
  expect(document.getElementById('choose-installation')!.hasAttribute('open')).toBe(false);
  await document.getElementById('back')!.onclick!(new Event('click') as PointerEvent);
  expect(request).toHaveBeenCalledWith('back', undefined);
  const opened = parseHTML(maintenancePage('test123', { chooseInstallation: true })).document;
  expect(opened.getElementById('choose-installation')!.hasAttribute('open')).toBe(true);
});
