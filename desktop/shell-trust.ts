import type { Release } from '../src/lib/service/release-trust';

/** Native delivery is gated by Ri's publisher signature on every platform,
 * including AppImage where an OS code-signing check is not available. */
export function eligibleShellFile(release: Release, files: { url: string; sha512: string; size?: number }[]) {
  if (!release.shell) throw new Error('This release has no desktop artifact for this computer');
  const base = new URL('.', release.shell.url);
  const extension = process.platform === 'darwin' ? '.zip' : '.AppImage';
  const eligible = files.filter(file => new URL(file.url, base).pathname.endsWith(extension));
  if (eligible.length !== 1) throw new Error('Unexpected desktop update artifacts');
  const file = eligible[0];
  if (new URL(file.url, base).href !== release.shell.url || file.sha512 !== release.shell.sha512 || file.size !== release.shell.size) throw new Error('Desktop artifact does not match the signed release manifest');
}
