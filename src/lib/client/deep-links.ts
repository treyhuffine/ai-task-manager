import type { EditorPreference } from './editor-preference';

/**
 * URL builders for same-machine deep links (browser-host === app-host).
 *
 * The OS routes these to whatever app has registered the scheme. Caller
 * should only render these as `<a href>` when `useClientLocation().kind`
 * is `'host'` — on a remote client, the path in the URL doesn't exist
 * locally and the click silently fails.
 *
 * Cloning URLs (cross-machine handoff) are NOT here — that goes through
 * the CLI (`flow takeover <url>`). The clone deep-link URLs popped a
 * folder picker every time and accepted no path argument, so the CLI
 * route gives us a predictable canonical clone path instead.
 */

function fileUrl(absPath: string): string {
  return `file://${encodeURI(absPath)}`;
}

/** `file://` URL targeting the parent directory — clicking opens the
 *  Finder/Explorer/Files window scrolled to the file. */
export function revealInFinderHref(absPath: string): string {
  const parent = absPath.replace(/[^/]*$/, '') || '/';
  return fileUrl(parent);
}

/** Editor-specific "open file" deep link. The editor's URL handler is
 *  registered at install time on macOS/Linux; on Windows it goes through
 *  the registry. If no handler is registered the click is a no-op. */
export function openInEditorHref(absPath: string, editor: EditorPreference): string {
  switch (editor) {
    case 'vscode':
      return `vscode://file${absPath.startsWith('/') ? '' : '/'}${encodeURI(absPath)}`;
    case 'jetbrains':
      return `jetbrains://open?file=${encodeURIComponent(absPath)}`;
    case 'cursor':
    default:
      return `cursor://file${absPath.startsWith('/') ? '' : '/'}${encodeURI(absPath)}`;
  }
}

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
