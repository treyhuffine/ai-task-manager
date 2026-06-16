/**
 * Extract the icon for a macOS `.app` bundle as a PNG.
 *
 * Apple stores app icons as multi-resolution `.icns` files. We:
 *   1. Read `Contents/Info.plist` for `CFBundleIconFile` (via `plutil
 *      -extract … raw` so we don't have to parse XML/binary plist
 *      ourselves).
 *   2. Resolve the icns: caller might omit the extension or the file
 *      might already include it.
 *   3. Render to a 64×64 PNG with `sips`. 64px reads sharp at typical
 *      menu sizes (~24-32 device px after CSS scaling) and keeps the
 *      payload small enough to inline as a data URL.
 *
 * Cached on disk under `<brain>/icons/` keyed by the source `.app`
 * mtime so we don't re-render every request. The cache is local to the
 * server; a cold start re-extracts on demand.
 *
 * Non-macOS callers should never reach this module.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { getWorkDir } from '@/lib/config/paths';

const execFileP = promisify(execFile);

async function readBundleIconFile(appPath: string): Promise<string | null> {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  try {
    const { stdout } = await execFileP('plutil', [
      '-extract',
      'CFBundleIconFile',
      'raw',
      '-o',
      '-',
      plistPath,
    ]);
    const name = stdout.trim();
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the `.icns` file inside a bundle. Tries the value from
 * Info.plist first, then a few common fallbacks for apps that don't
 * declare CFBundleIconFile (rare but it happens — Electron wrappers
 * sometimes mis-set it).
 */
async function resolveIcnsPath(appPath: string): Promise<string | null> {
  const resourcesDir = path.join(appPath, 'Contents', 'Resources');
  const declared = await readBundleIconFile(appPath);
  const candidates: string[] = [];
  if (declared) {
    candidates.push(declared, `${declared}.icns`);
  }
  candidates.push('AppIcon.icns', 'app.icns', 'Icon.icns');

  for (const name of candidates) {
    const candidate = name.endsWith('.icns')
      ? path.join(resourcesDir, name)
      : path.join(resourcesDir, `${name}.icns`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  // Last-resort scan: pick any `.icns` in Resources/. Still fast.
  try {
    const entries = await fs.readdir(resourcesDir);
    const icns = entries.find((e) => e.toLowerCase().endsWith('.icns'));
    if (icns) return path.join(resourcesDir, icns);
  } catch {
    // Resources/ unreadable — nothing we can do.
  }

  return null;
}

function iconCacheDir(): string {
  return path.join(getWorkDir(), 'icons');
}

async function ensureCacheDir(): Promise<string> {
  const dir = iconCacheDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function cacheKey(appPath: string, mtimeMs: number): string {
  return createHash('sha1').update(`${appPath}:${mtimeMs}`).digest('hex');
}

/**
 * Returns the PNG bytes for the app's icon, sized to 64×64. Cached on
 * disk; cache is invalidated when the source `.app` mtime changes.
 */
export async function extractAppIconPng(appPath: string): Promise<Buffer | null> {
  if (process.platform !== 'darwin') return null;

  let mtimeMs: number;
  try {
    const stat = await fs.stat(appPath);
    mtimeMs = stat.mtimeMs;
  } catch {
    return null;
  }

  const dir = await ensureCacheDir();
  const cachedPath = path.join(dir, `${cacheKey(appPath, mtimeMs)}.png`);
  try {
    return await fs.readFile(cachedPath);
  } catch {
    // Fall through to extraction.
  }

  const icns = await resolveIcnsPath(appPath);
  if (!icns) return null;

  try {
    await execFileP(
      'sips',
      [
        '-s', 'format', 'png',
        '-Z', '64',
        icns,
        '--out', cachedPath,
      ],
      { timeout: 5_000 },
    );
  } catch (err) {
    console.warn(`[extract-icon] sips failed for ${appPath}:`, err);
    return null;
  }

  try {
    return await fs.readFile(cachedPath);
  } catch {
    return null;
  }
}
