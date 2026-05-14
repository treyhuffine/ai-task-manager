/**
 * Cross-platform "open this folder in the user's editor" helper.
 *
 * Uses the `open` package (already in deps) to hand a URL to the OS.
 * Editor URL schemes (cursor://, vscode://, jetbrains://) are
 * registered as the editor's URL handler at install time on all three
 * platforms — `open` just routes through whichever the OS knows about.
 */

import open from 'open';
import type { CliEditor } from './cli-config';

function pathToUrl(scheme: string, absPath: string): string {
  const normalized = absPath.startsWith('/') ? absPath : `/${absPath}`;
  return `${scheme}://file${encodeURI(normalized)}`;
}

function editorUrl(editor: CliEditor, absPath: string): string {
  switch (editor) {
    case 'vscode':
      return pathToUrl('vscode', absPath);
    case 'jetbrains':
      return `jetbrains://open?file=${encodeURIComponent(absPath)}`;
    case 'cursor':
    default:
      return pathToUrl('cursor', absPath);
  }
}

/** Best-effort open. Returns the URL we tried in case the caller wants
 *  to print it as a fallback when the OS reports no handler. */
export async function openInEditor(
  absPath: string,
  editor: CliEditor,
): Promise<{ url: string; ok: boolean; error?: unknown }> {
  const url = editorUrl(editor, absPath);
  try {
    await open(url);
    return { url, ok: true };
  } catch (err) {
    return { url, ok: false, error: err };
  }
}
