import fs from 'node:fs';
import path from 'node:path';
import { canonical } from '../src/lib/service/paths';
import type { InstallationInspection } from './installation';

export interface DiscoveredInstallation {
  root: string;
  canUse: boolean;
  reason?: string;
  phase?: string;
}

const reviewReason = 'This Ri could not be verified. Open Advanced to review the installation.';
const accessReason = 'This Ri is not accessible to your account. Open Advanced to choose an accessible installation.';
const ownershipReason = 'This Ri uses files owned or writable by another account. Open Advanced to review the installation.';

function absent(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? '');
}

function failureReason(error: unknown): string {
  if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException)?.code ?? '')) return accessReason;
  if (error instanceof Error && /foreground launcher|Another launcher is using this installation/.test(error.message)) {
    return 'This Ri is open in another launcher. Open Advanced to review the connection.';
  }
  return reviewReason;
}

function owned(stat: fs.Stats): boolean {
  const uid = process.getuid?.();
  return uid === undefined || (stat.uid === uid && (stat.mode & 0o022) === 0);
}

/** Ancestors may be system-owned (for example /Users or /Volumes), but not
 * controlled by another account. A sticky temporary directory is safe as an
 * ancestor of a private user-owned directory, and supports isolated fixtures. */
function safeAncestors(file: string): boolean {
  const uid = process.getuid?.();
  if (uid === undefined) return true;
  let parent = path.dirname(file);
  for (;;) {
    const stat = fs.statSync(parent);
    if (!stat.isDirectory() || (stat.uid !== uid && stat.uid !== 0) || ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)) return false;
    const next = path.dirname(parent);
    if (next === parent) return true;
    parent = next;
  }
}

function safeEntry(root: string, file: string, directory: boolean): boolean {
  const resolved = fs.realpathSync(file);
  if (!resolved.startsWith(`${root}${path.sep}`)) return false;
  const stat = fs.statSync(resolved);
  return (directory ? stat.isDirectory() : stat.isFile()) && owned(stat) && safeAncestors(resolved);
}

/** Discover only the caller's known default location. This never creates a
 * root, opens SQLite, changes process environment, or starts/stops a service.
 * The caller supplies the existing ordinary-Node, read-only inspector. */
export async function discoverInstallation(input: {
  currentRoot: string;
  candidateRoot: string;
  inspect: (input: { root: string }) => Promise<InstallationInspection>;
}): Promise<DiscoveredInstallation | null> {
  if (!path.isAbsolute(input.candidateRoot) || input.candidateRoot.includes('\0')) return null;
  const candidate = path.resolve(input.candidateRoot);
  if (candidate === path.resolve(input.currentRoot)) return null;
  let root = candidate;
  try {
    try { root = fs.realpathSync(candidate); }
    catch (error) { if (absent(error)) return null; throw error; }
    if (root === canonical(input.currentRoot)) return null;
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) return null;
    if (!owned(stat) || !safeAncestors(candidate) || !safeAncestors(root)) return { root, canUse: false, reason: ownershipReason };

    const database = path.join(root, 'data.db');
    const config = path.join(root, '.config');
    const connection = path.join(config, 'connection.json');
    let hasInstallation = false;
    for (const file of [database, connection]) {
      try { fs.lstatSync(file); }
      catch (error) { if (absent(error)) continue; throw error; }
      hasInstallation = true;
      if (!safeEntry(root, file, false)) return { root, canUse: false, reason: ownershipReason };
    }
    if (!hasInstallation) return null;
    // The inspector reads config and may inspect an existing work directory.
    // Reject escaping symlinks and foreign ownership before invoking it.
    for (const directory of [config, path.join(root, '.work')]) {
      try { fs.lstatSync(directory); }
      catch (error) { if (absent(error)) continue; throw error; }
      if (!safeEntry(root, directory, true)) return { root, canUse: false, reason: ownershipReason };
    }
    const inspected = await input.inspect({ root });
    if (canonical(inspected.identity.root) !== root) return { root, canUse: false, reason: reviewReason };
    return { root, canUse: inspected.canUse, phase: inspected.phase, ...(inspected.reason ? { reason: inspected.reason } : {}) };
  } catch (error) {
    return { root, canUse: false, reason: failureReason(error) };
  }
}
