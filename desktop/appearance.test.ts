import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { desktopAppearance } from './appearance';
import { observeDesktopTheme } from './appearance-observer';

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); vi.unstubAllGlobals(); });
const file = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-appearance-')); roots.push(root); return path.join(root, 'appearance.json'); };

it('remembers only a valid cosmetic theme without creating an installation', () => {
  const target = file(); const appearance = desktopAppearance(target);
  expect(appearance.get()).toBe('dark'); expect(fs.existsSync(target)).toBe(false);
  expect(appearance.set({ theme: 'light' })).toBe(false);
  expect(appearance.set('light')).toBe(true); expect(desktopAppearance(target).get()).toBe('light');
  expect(appearance.set('light')).toBe(false);
  expect(fs.readdirSync(path.dirname(target))).toEqual(['appearance.json']);
  fs.writeFileSync(target, '{broken'); expect(desktopAppearance(target).get()).toBe('dark');
});
it('keeps theme changes usable if the cosmetic file cannot be written', () => {
  const appearance = desktopAppearance(path.join(file(), 'missing/appearance.json'));
  expect(appearance.set('light')).toBe(true); expect(appearance.get()).toBe('light');
});
it('reports actual rendered theme changes and ignores unrelated class changes', async () => {
  const { document, MutationObserver } = parseHTML('<html class="dark"><body></body></html>');
  vi.stubGlobal('MutationObserver', MutationObserver);
  const report = vi.fn(); const stop = observeDesktopTheme(document as unknown as Document, report);
  expect(report).toHaveBeenCalledExactlyOnceWith('dark');
  document.documentElement.classList.add('unrelated'); await Promise.resolve();
  expect(report).toHaveBeenCalledTimes(1);
  document.documentElement.classList.remove('dark'); await Promise.resolve();
  expect(report).toHaveBeenLastCalledWith('light');
  stop(); document.documentElement.classList.add('dark'); await Promise.resolve();
  expect(report).toHaveBeenCalledTimes(2);
});
