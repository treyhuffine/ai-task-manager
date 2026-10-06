import fs from 'node:fs';
import path from 'node:path';
import type { LocalPageStyleOptions } from './local-page-style';

export type DesktopTheme = 'light' | 'dark';
export const isDesktopTheme = (value: unknown): value is DesktopTheme => value === 'light' || value === 'dark';

/** Cosmetic, per-profile state. Never opens a Home or changes its settings. */
export function desktopAppearance(file: string) {
  let theme: DesktopTheme = 'dark';
  try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); if (isDesktopTheme(saved.theme)) theme = saved.theme; }
  catch { /* Match the main app's default on a fresh profile. */ }
  return {
    get: () => theme,
    set(value: unknown) {
      if (!isDesktopTheme(value) || value === theme) return false;
      theme = value;
      try {
        fs.writeFileSync(`${file}.tmp`, JSON.stringify({ theme }), { mode: 0o600 });
        fs.renameSync(`${file}.tmp`, file);
      } catch { /* Cosmetic persistence must not interrupt the app. */ }
      return true;
    },
  };
}

/** Bundled assets are available before Next or a remote Home exists. */
export function localPageAssets(repo: string): Pick<LocalPageStyleOptions, 'themeCss' | 'fontDataUrl' | 'logoDataUrl'> {
  return {
    themeCss: fs.readFileSync(path.join(repo, 'src/styles/theme.css'), 'utf8'),
    fontDataUrl: `data:font/woff2;base64,${fs.readFileSync(path.join(repo, 'public/fonts/inter-latin.woff2')).toString('base64')}`,
    logoDataUrl: `data:image/svg+xml;base64,${fs.readFileSync(path.join(repo, 'public/brand/ri-mark-white.svg')).toString('base64')}`,
  };
}
