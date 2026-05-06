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

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { KNOWN_APPS, type KnownApp } from './known-apps';
import type { OpenTarget } from './open-target';

const execFileP = promisify(execFile);

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
 * Cross-platform `which`. Uses `where` on Windows (returns the first
 * match on success), `command -v` on POSIX (works in any sh-derivative,
 * doesn't rely on the `which` external binary being installed).
 */
async function findCliBinary(cli: string): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileP('where', [cli]);
      const first = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      return first ?? null;
    }
    const { stdout } = await execFileP('sh', ['-lc', `command -v ${cli}`]);
    const resolved = stdout.trim();
    return resolved || null;
  } catch {
    return null;
  }
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

  // 3) Cross-platform: PATH binary.
  if (app.cliCommand) {
    const bin = await findCliBinary(app.cliCommand);
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
