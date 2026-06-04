/**
 * Detect which of the known editor / terminal apps are installed.
 *
 * Per platform:
 *   - macOS: stat `/Applications/<App>.app` and `~/Applications/<App>.app`.
 *     We care about the bundle existing — that's how apps end up
 *     installed there in the first place.
 *   - Linux / Windows: probe the CLI command via `which` / `where`. Many
 *     editors ship their binary on PATH after install (or after the
 *     in-app "Install CLI command in PATH" action).
 *
 * Detection runs server-side because file-system / shell access doesn't
 * exist in the browser. Result list is in the registry order so the
 * menu has stable item order.
 */

import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KNOWN_APPS, type KnownApp } from './known-apps';
import type { OpenTarget } from './open-target';

export interface DetectedApp {
  target: OpenTarget;
  label: string;
  /** Absolute path of the `.app` bundle on macOS, the resolved binary on
   *  Linux/Windows, or `null` when the entry is one of the always-available
   *  pseudo-targets (Finder, Terminal). */
  source: string | null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** macOS: prefer system-wide `/Applications`, then per-user `~/Applications`. */
async function findMacBundle(macAppName: string): Promise<string | null> {
  const candidates = [
    `/Applications/${macAppName}.app`,
    path.join(os.homedir(), 'Applications', `${macAppName}.app`),
  ];
  for (const c of candidates) {
    if (await pathExists(c)) return c;
  }
  return null;
}

/**
 * In-process `which`: walk `$PATH` and return the first matching binary.
 * Faster and more reliable than shelling out to `command -v` / `where` (no
 * subprocess, no login-shell env quirks). On Windows we try each `PATHEXT`
 * extension. Synchronous `existsSync` over a couple dozen dirs is cheap.
 */
export function resolveOnPath(cli: string): string | null {
  const envPath = process.env.PATH;
  if (!envPath) return null;
  const dirs = envPath.split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.trim()).filter(Boolean)
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, cli + ext);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

async function detectOne(app: KnownApp, platform: NodeJS.Platform): Promise<DetectedApp | null> {
  if (app.platforms && !app.platforms.includes(platform as 'darwin' | 'linux' | 'win32')) {
    return null;
  }

  // 1) macOS: hardcoded system-bundle path (Finder, Terminal). Lets us
  //    extract the real app icon without scanning /Applications.
  if (platform === 'darwin' && app.macBundlePath && (await pathExists(app.macBundlePath))) {
    return { target: app.target, label: app.label, source: app.macBundlePath };
  }

  // 2) macOS: standard /Applications scan.
  if (platform === 'darwin' && app.macAppName) {
    const bundle = await findMacBundle(app.macAppName);
    if (bundle) return { target: app.target, label: app.label, source: bundle };
  }

  // 3) Cross-platform: PATH binary. On macOS this is also the path for
  //    editors installed only via their "Install CLI command in PATH"
  //    action without an .app under /Applications.
  if (app.cliCommand) {
    const bin = resolveOnPath(app.cliCommand);
    if (bin) return { target: app.target, label: app.label, source: bin };
  }

  // 4) Always-show entries (Finder / Terminal on non-mac platforms)
  //    fall through with `source: null` so the menu still includes
  //    them — the lucide fallback icon takes over client-side.
  if (app.alwaysShow) {
    return { target: app.target, label: app.label, source: null };
  }

  return null;
}

export async function detectInstalledApps(): Promise<DetectedApp[]> {
  const platform = process.platform;
  const results = await Promise.all(KNOWN_APPS.map((a) => detectOne(a, platform)));
  return results.filter((x): x is DetectedApp => x !== null);
}
