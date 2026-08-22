/**
 * Browser readiness checks, shared by `flow browser doctor` and the main
 * `flow doctor`. Reports and never mutates the user's browser.
 */

import fs from 'node:fs';
import { getBrowserProfileDir } from '@/lib/config/paths';
import { detectBrowsers, resolveChromium } from './chromium';
import { isBrowserEnabled, getConfiguredChromiumPath } from './config';
import { isBrowserOpen } from './session';

export interface BrowserCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export async function runBrowserDoctor(): Promise<BrowserCheck[]> {
  const checks: BrowserCheck[] = [];

  const enabled = isBrowserEnabled();
  checks.push({ name: 'Browser capability', ok: true, detail: enabled ? 'enabled' : 'disabled in config' });

  const detected = detectBrowsers();
  const resolved = resolveChromium(getConfiguredChromiumPath());
  checks.push({
    name: 'Chromium-family browser',
    ok: !!resolved,
    detail: resolved
      ? `${resolved.label} (${resolved.executablePath})`
      : 'none found. Install Chrome, Brave, Edge, or Chromium.',
  });
  if (detected.length > 1) {
    checks.push({
      name: 'Detected browsers',
      ok: true,
      detail: detected.map((b) => b.label).join(', '),
    });
  }

  const profileDir = getBrowserProfileDir();
  let writable = true;
  try {
    fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    fs.accessSync(profileDir, fs.constants.W_OK);
  } catch {
    writable = false;
  }
  checks.push({ name: 'Agent profile dir', ok: writable, detail: profileDir });

  const open = await isBrowserOpen();
  checks.push({ name: 'Agent browser running', ok: true, detail: open ? 'yes' : 'no (launches on demand)' });

  return checks;
}
