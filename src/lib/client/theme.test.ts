import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CLIENT_THEME_KEY, ClientAppearance, useClientTheme } from './theme';
import { ThemeSettings } from '@/components/settings/sections/theme-settings';

let root: Root;
let values: Map<string, string>;
let blocked: boolean;
beforeEach(() => {
  const { window, document } = parseHTML('<html class="dark"><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('Event', window.Event);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  blocked = false; values = new Map([[CLIENT_THEME_KEY, 'dark']]);
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => { if (blocked) throw new Error('Blocked'); return values.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (blocked) throw new Error('Blocked'); values.set(key, value); },
  } });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
function Reader({ id }: { id: string }) {
  const { theme, toggleTheme, setTheme } = useClientTheme();
  return createElement('button', { id, onClick: toggleTheme, onDoubleClick: () => setTheme('dark') }, theme);
}
const render = () => act(async () => root.render(createElement('div', null, createElement(ClientAppearance), createElement(Reader, { id: 'personal' }), createElement(Reader, { id: 'team' }))));

it('shares appearance between mounted surfaces and restores it when the document changes', async () => {
  await render();
  await act(async () => document.getElementById('team')!.click());
  expect(document.getElementById('personal')!.textContent).toBe('light');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(values.get(CLIENT_THEME_KEY)).toBe('light');
  await act(async () => root.render(null));
  await render();
  expect(document.getElementById('team')!.textContent).toBe('light');
  values.set(CLIENT_THEME_KEY, 'dark');
  await act(async () => window.dispatchEvent(Object.assign(new Event('storage'), { key: CLIENT_THEME_KEY })));
  expect(document.getElementById('team')!.textContent).toBe('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});

it('keeps appearance usable when browser storage is unavailable', async () => {
  await render();
  blocked = true;
  await act(async () => document.getElementById('team')!.click());
  expect(document.getElementById('personal')!.textContent).toBe('light');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});

it('renders the shared settings control without personal dashboard or server state', () => {
  const html = renderToStaticMarkup(createElement(ThemeSettings));
  expect(html).toContain('Dark mode'); expect(html).toContain('role="switch"');
  expect(html).not.toContain('service');
});
