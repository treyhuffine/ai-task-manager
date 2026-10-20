/**
 * Local image and HTML artifacts an agent supplies by path in a reply.
 *
 * The rule, so a reply's artifacts load without opening the whole disk to
 * the browser:
 *   - regular files of the requested type, under that preview's size cap;
 *   - inside the chat's own folder (its worktree, or the agent's folder), the
 *     same reach as the file viewer; or
 *   - anywhere else on the home, when the agent wrote that exact path in one of
 *     its replies in this chat. Showing a file the agent itself put in front of
 *     you gives the browser nothing the agent couldn't already say.
 * A chat on another device keeps its files there, so this says where instead.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveMime } from '@/lib/attachments/mime';
import { htmlTooLargeMessage } from './html-preview-response';

export type ReplyFile =
  | { ok: true; file: string; mime: string; size: number }
  | { ok: false; status: number; error: string };

export interface ReplyFileChat {
  /** The chat's own folder: its worktree, or the agent's folder. Null when it has none. */
  folder: string | null;
  /** Set when the chat runs on another device. */
  elsewhere: string | null;
}

/** `file://` URLs, `~/`, and paths relative to the chat's folder, made absolute. */
export function resolveReplyFilePath(requested: string, folder: string | null): string | null {
  let p = requested.trim();
  if (/^file:\/\//i.test(p)) {
    try {
      p = decodeURIComponent(new URL(p).pathname);
    } catch {
      return null;
    }
  }
  if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1));
  if (path.isAbsolute(p)) return path.normalize(p);
  return folder ? path.resolve(folder, p) : null;
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export async function findReplyFile(
  chat: ReplyFileChat,
  requested: string,
  agentNamed: (text: string) => boolean,
  options: { kind: 'image' | 'html' | 'pdf'; maxBytes: number },
): Promise<ReplyFile> {
  const noun = { image: 'image', html: 'HTML file', pdf: 'PDF' }[options.kind];
  const plural = { image: 'images', html: 'HTML files', pdf: 'PDFs' }[options.kind];
  const allowed = (file: string) => options.kind === 'image'
    ? resolveMime(null, path.basename(file)).startsWith('image/')
    : (options.kind === 'html' ? /\.html?$/i : /\.pdf$/i).test(file);
  if (chat.elsewhere) return { ok: false, status: 409, error: `This ${noun} is on ${chat.elsewhere}.` };
  const resolved = resolveReplyFilePath(requested, chat.folder);
  if (!resolved) return { ok: false, status: 404, error: 'Not found' };
  const mime = options.kind === 'html' ? 'text/html' : options.kind === 'pdf' ? 'application/pdf' : resolveMime(null, path.basename(resolved));
  if (!allowed(resolved)) return { ok: false, status: 415, error: `Only ${plural} are shown here` };

  let real: string;
  let size: number;
  try {
    real = await fs.realpath(/* turbopackIgnore: true */ resolved);
    const stat = await fs.stat(real);
    if (!stat.isFile()) return { ok: false, status: 404, error: 'Not found' };
    size = stat.size;
  } catch {
    return { ok: false, status: 404, error: 'Not found' };
  }
  // The real path decides the type too, so a link named .png can't serve something else.
  if (!allowed(real)) return { ok: false, status: 415, error: `Only ${plural} are shown here` };
  if (size > options.maxBytes) {
    return { ok: false, status: 413, error: options.kind === 'html' ? htmlTooLargeMessage(size, options.maxBytes) : `This ${noun} is too large to show` };
  }

  let inFolder = false;
  if (chat.folder) {
    try {
      inFolder = inside(real, await fs.realpath(chat.folder));
    } catch {
      inFolder = false;
    }
  }
  if (!inFolder && !agentNamed(requested)) {
    return { ok: false, status: 403, error: `Only ${plural} in this chat's folder, or ones its agent showed in a reply, are shown.` };
  }
  return { ok: true, file: real, mime, size };
}
