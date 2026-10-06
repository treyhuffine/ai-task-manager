import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { describe, expect, it, vi } from 'vitest';
import { companionPage } from './companion-page';
import { maintenancePage } from './maintenance-page';
import { localPageStyle, startingPage, type LocalPageStyleOptions } from './local-page-style';

const root = path.resolve(__dirname, '..');
const themeCss = fs.readFileSync(path.join(root, 'src/styles/theme.css'), 'utf8');
const font = fs.readFileSync(path.join(root, 'public/fonts/inter-latin.woff2'));
const options: LocalPageStyleOptions = {
  themeCss, fontDataUrl: `data:font/woff2;base64,${font.toString('base64')}`,
  logoDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', platform: 'darwin',
};

describe('shared desktop appearance', () => {
  it('uses the web app token file as its only palette and validates the offline font assets', () => {
    const globalCss = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
    expect(globalCss).toContain("@import '../styles/theme.css'");
    expect(globalCss).not.toMatch(/--(?:background|foreground|primary|border):/);
    const style = localPageStyle('nonce', options);
    expect(style.head).toContain(themeCss);
    const ownCss = localPageStyle('nonce').head;
    expect(ownCss).not.toMatch(/#[0-9a-f]{3,8}\b|oklch\(/i);
    for (const [, token] of ownCss.matchAll(/var\((--[\w-]+)/g)) {
      expect(themeCss, `Missing shared token ${token}`).toContain(`${token}:`);
    }
    expect(font.toString('ascii', 0, 4)).toBe('wOF2');
    expect(fs.readFileSync(path.join(root, 'public/fonts/OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(style.head).toContain('font-family:Inter');
    expect(style.head).toContain('font-weight:100 900');
    expect(style.head).toContain(options.fontDataUrl);
  });

  it.each([
    ['companion', companionPage], ['maintenance', maintenancePage], ['loading', startingPage],
  ] as const)('renders %s inside matching light or dark app chrome', (view, page) => {
    for (const theme of ['light', 'dark'] as const) {
      const { document } = parseHTML(page('nonce', { ...options, theme }));
      expect(document.documentElement.className).toBe(theme);
      expect(document.documentElement.dataset.riLocalView).toBe(view);
      expect(document.documentElement.dataset.riDesktop).toBe('darwin');
      expect(document.querySelector('[data-desktop-titlebar]')?.getAttribute('aria-hidden')).toBe('true');
      expect(document.querySelectorAll('main')).toHaveLength(1);
      expect(document.querySelector('main .brand img')?.getAttribute('src')).toBe(options.logoDataUrl);
      const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')!;
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain('font-src data:');
      expect(csp).toContain("script-src 'nonce-nonce'");
      expect(csp).not.toContain('https:');
      expect(document.querySelectorAll('style[nonce="nonce"]')).toHaveLength(1);
    }
  });

  it('updates a live setup theme without reloading the page, losing input or issuing an action', async () => {
    const { document } = parseHTML(companionPage('nonce', options));
    const request = vi.fn(async () => ({ role: 'first-run' }));
    let updateTheme!: (value: string) => void;
    vm.runInNewContext(document.querySelector('script')!.textContent!, {
      document,
      window: { riCompanion: { request }, riLocal: { onTheme: (handler: typeof updateTheme) => { updateTheme = handler; } } },
      setInterval() {},
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    await document.getElementById('choose-connect')!.onclick!(new Event('click') as PointerEvent);
    const input = document.getElementById('pairing') as HTMLInputElement;
    input.value = 'https://home.example/pair#private-token';
    const count = request.mock.calls.length;
    updateTheme('light');
    expect(document.documentElement.className).toBe('light');
    expect(input.value).toBe('https://home.example/pair#private-token');
    expect(document.getElementById('connect')!.hidden).toBe(false);
    expect(request).toHaveBeenCalledTimes(count);
    updateTheme('unexpected');
    expect(document.documentElement.className).toBe('light');
    updateTheme('dark');
    expect(document.documentElement.className).toBe('dark');
  });

  it('provides loading content without a service bridge or connection', () => {
    const { document } = parseHTML(startingPage('nonce', options));
    expect(document.querySelector('[role="status"]')!.textContent).toBe('Connecting…');
    expect(() => vm.runInNewContext(document.querySelector('script')!.textContent!, { document, window: {} })).not.toThrow();
    expect(document.querySelectorAll('button,input')).toHaveLength(0);
  });

  it.each([
    { themeCss: '</style><script>alert(1)</script>' },
    { themeCss: '@import "https://example.com/style.css";' },
    { themeCss: ':root{background:url(https://example.com)}' },
    { fontDataUrl: 'https://example.com/font.woff2' },
    { fontDataUrl: 'data:font/woff2;base64,a"}body{background:red}' },
    { logoDataUrl: 'data:image/svg+xml;base64,a" onload="alert(1)' },
    { platform: 'darwin" onload="alert(1)' },
    { theme: 'dark" onload="alert(1)' as 'dark' },
  ])('refuses untrusted template assets %j', value => {
    expect(() => localPageStyle('nonce', value)).toThrow();
  });
});
