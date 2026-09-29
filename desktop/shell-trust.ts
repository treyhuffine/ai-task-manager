import type { Release } from '../src/lib/service/release-trust';

/** Native delivery is gated by Ri's publisher signature on every platform,
 * including AppImage where an OS code-signing check is not available. */
export function eligibleShellFile(release: Release, files: { url: string; sha512: string; size?: number }[], platform: NodeJS.Platform = process.platform) {
  if (!release.shell) throw new Error('This release has no desktop artifact for this computer');
  const base = new URL('.', release.shell.url);
  const extension = platform === 'darwin' ? '.zip' : '.appimage';
  const eligible = files.filter(file => new URL(file.url, base).pathname.toLowerCase().endsWith(extension));
  if (eligible.length !== 1) throw new Error('Unexpected desktop update artifacts');
  const file = eligible[0];
  if (new URL(file.url, base).href !== release.shell.url || file.sha512 !== release.shell.sha512 || file.size !== release.shell.size) throw new Error('Desktop artifact does not match the signed release manifest');
  // The caller replaces the updater's file list with this fresh signed record.
  // Its architecture filtering and fallback must never select an extra file
  // from unauthenticated channel metadata, or inherit that file's sha2/package.
  return { url: release.shell.url, sha512: release.shell.sha512, size: release.shell.size };
}

/** A metadata renewal may extend eligibility but cannot substitute another
 * version or executable after the user approved and downloaded this one. */
export function assertSameShellRelease(approved: Release, current: Release) {
  if (!approved.shell || !current.shell ||
      approved.version !== current.version || approved.channel !== current.channel ||
      approved.platform !== current.platform || approved.arch !== current.arch ||
      approved.shell.url !== current.shell.url || approved.shell.sha512 !== current.shell.sha512 ||
      approved.shell.size !== current.shell.size) {
    throw new Error('The publisher changed the desktop release. Check for updates again before installing.');
  }
}
