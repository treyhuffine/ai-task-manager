/**
 * Map a file path to a CodeMirror 6 language extension. Used by the
 * file viewer and the diff view to get syntax highlighting; falls back
 * to `[]` (plaintext) for unknown extensions.
 *
 * Language packages are tree-shaken — each `import` only adds the
 * grammar for that extension to the bundle when this function is
 * actually called for a matching file.
 */

import type { Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';

export function languageFor(path: string): Extension {
  const lower = path.toLowerCase();
  // Order matters — match longer extensions first.
  if (lower.endsWith('.tsx')) return javascript({ typescript: true, jsx: true });
  if (lower.endsWith('.ts')) return javascript({ typescript: true });
  if (lower.endsWith('.jsx')) return javascript({ jsx: true });
  if (/\.(jsx?|mjs|cjs)$/.test(lower)) return javascript();
  if (lower.endsWith('.py')) return python();
  if (lower.endsWith('.json')) return json();
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return markdown();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return html();
  if (/\.(css|scss|sass|less)$/.test(lower)) return css();
  return [];
}
