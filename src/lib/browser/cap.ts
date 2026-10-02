/**
 * Cap model-facing text. Anything over the limit is spilled whole to a scratch
 * file under the browser work dir, and the model gets the head plus a pointer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ensureBrowserWorkDir } from '@/lib/config/paths';

export interface Capped {
  content: string;
  truncated?: boolean;
  /** Where the full content was spilled, when truncated. */
  spillPath?: string;
}

export function applyCap(
  content: string,
  maxChars: number,
  session: string,
  label: string,
  hint = 'Re-read with a tighter selector or a larger max_chars.',
): Capped {
  if (content.length <= maxChars) return { content };
  const dir = path.join(ensureBrowserWorkDir(), 'spill');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const safeSession = session.replace(/[^a-zA-Z0-9_-]/g, '_');
  const spillPath = path.join(dir, `${safeSession}-${label}-${Date.now()}.txt`);
  fs.writeFileSync(spillPath, content, { mode: 0o600 });
  const head = content.slice(0, maxChars);
  return {
    content: `${head}\n\n[truncated at ${maxChars} chars. Full content spilled to ${spillPath}. ${hint}]`,
    truncated: true,
    spillPath,
  };
}
