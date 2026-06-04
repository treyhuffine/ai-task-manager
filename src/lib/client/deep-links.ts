/**
 * Small client-side platform/label helpers for the host-only "open"
 * affordances.
 *
 * The old `vscode://` / `file://` URL-scheme builders that lived here were
 * retired: they were blind (a silent no-op when no handler was registered)
 * and didn't share a preference with the rest of the app. Every "open in
 * editor" / "reveal" action now routes through the local `/api/fs/open`
 * spawn endpoint via `fsApi` + `useOpenInPreferredEditor`, which reports
 * success/failure and respects the single editor preference.
 */

/** Platform-appropriate label for the "Reveal" affordance. */
export function revealLabel(platform: 'darwin' | 'linux' | 'win32' | string): string {
  if (platform === 'darwin') return 'Reveal in Finder';
  if (platform === 'win32') return 'Show in Explorer';
  return 'Show in Files';
}

/** Detect the user's platform from `navigator.platform`. Falls back to
 *  `linux` for unknown UAs — safe default for the label. */
export function detectClientPlatform(): 'darwin' | 'linux' | 'win32' {
  if (typeof navigator === 'undefined') return 'linux';
  const p = (navigator.platform || '').toLowerCase();
  if (p.startsWith('mac') || p.includes('iphone') || p.includes('ipad')) return 'darwin';
  if (p.startsWith('win')) return 'win32';
  return 'linux';
}
