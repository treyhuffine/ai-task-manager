/**
 * Discover installed Chromium-family browsers so the user can pick a flavor
 * (Chrome, Brave, Edge, Chromium) for the agent browser. We drive whichever
 * they choose over CDP, so any Chromium binary works, resolved by executable
 * path. Detection powers the Settings picker and `flow browser doctor`.
 *
 * We never download a browser here. Falling back to the Playwright Chromium is
 * a separate, consented step (see the proposal), not a silent default.
 */

import fs from 'node:fs';
import path from 'node:path';

export type BrowserFlavor = 'chrome' | 'brave' | 'edge' | 'chromium';

export interface DetectedBrowser {
  flavor: BrowserFlavor;
  /** Human label for the picker. */
  label: string;
  /** Absolute path to the executable. */
  executablePath: string;
}

interface Candidate {
  flavor: BrowserFlavor;
  label: string;
  /** Absolute paths (macOS/Windows) tried in order. */
  paths?: string[];
  /** Bare binary names to resolve on PATH (Linux). */
  bins?: string[];
}

function macCandidates(): Candidate[] {
  return [
    { flavor: 'chrome', label: 'Google Chrome', paths: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] },
    { flavor: 'brave', label: 'Brave', paths: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'] },
    { flavor: 'edge', label: 'Microsoft Edge', paths: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] },
    { flavor: 'chromium', label: 'Chromium', paths: ['/Applications/Chromium.app/Contents/MacOS/Chromium'] },
  ];
}

function linuxCandidates(): Candidate[] {
  return [
    { flavor: 'chrome', label: 'Google Chrome', bins: ['google-chrome', 'google-chrome-stable'] },
    { flavor: 'brave', label: 'Brave', bins: ['brave-browser', 'brave'] },
    { flavor: 'edge', label: 'Microsoft Edge', bins: ['microsoft-edge', 'microsoft-edge-stable'] },
    { flavor: 'chromium', label: 'Chromium', bins: ['chromium', 'chromium-browser'] },
  ];
}

function windowsCandidates(): Candidate[] {
  const pf = process.env.PROGRAMFILES ?? 'C:\\Program Files';
  const pfx86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA ?? '';
  const join = (base: string, rest: string) => (base ? path.join(base, rest) : '');
  return [
    {
      flavor: 'chrome',
      label: 'Google Chrome',
      paths: [
        join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
        join(pfx86, 'Google\\Chrome\\Application\\chrome.exe'),
        join(local, 'Google\\Chrome\\Application\\chrome.exe'),
      ],
    },
    {
      flavor: 'brave',
      label: 'Brave',
      paths: [
        join(pf, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
        join(pfx86, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
      ],
    },
    {
      flavor: 'edge',
      label: 'Microsoft Edge',
      paths: [
        join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
        join(pfx86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      ],
    },
    { flavor: 'chromium', label: 'Chromium', paths: [join(local, 'Chromium\\Application\\chrome.exe')] },
  ];
}

/** Resolve a bare binary name against PATH (Linux/macOS). */
function resolveOnPath(bin: string): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const full = path.join(dir, bin);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {
      // not here, keep looking
    }
  }
  return null;
}

function resolveCandidate(c: Candidate): string | null {
  for (const p of c.paths ?? []) {
    if (p && fs.existsSync(p)) return p;
  }
  for (const bin of c.bins ?? []) {
    const found = resolveOnPath(bin);
    if (found) return found;
  }
  return null;
}

function candidatesForPlatform(): Candidate[] {
  if (process.platform === 'darwin') return macCandidates();
  if (process.platform === 'win32') return windowsCandidates();
  return linuxCandidates();
}

/** Every installed Chromium-family browser we can find, in preference order. */
export function detectBrowsers(): DetectedBrowser[] {
  const found: DetectedBrowser[] = [];
  for (const c of candidatesForPlatform()) {
    const executablePath = resolveCandidate(c);
    if (executablePath) found.push({ flavor: c.flavor, label: c.label, executablePath });
  }
  return found;
}

/**
 * Pick the browser to drive. An explicit configured path wins when it still
 * exists. Otherwise use the first detected system browser. Returns null when
 * nothing is installed, which is the signal to offer the consented Playwright
 * Chromium download rather than failing silently.
 */
export function resolveChromium(configuredPath?: string | null): DetectedBrowser | null {
  if (configuredPath && fs.existsSync(configuredPath)) {
    const match = detectBrowsers().find((b) => b.executablePath === configuredPath);
    if (match) return match;
    return { flavor: 'chromium', label: 'Configured browser', executablePath: configuredPath };
  }
  return detectBrowsers()[0] ?? null;
}
