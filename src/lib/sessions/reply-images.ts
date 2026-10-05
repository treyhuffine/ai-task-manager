/**
 * Which image a chat's reply-image route serves (`GET
 * /api/sessions/:id/reply-image?path=`), for local image paths an agent puts in
 * its replies (`reply-image-urls.ts` points them here).
 *
 * The rule, so a reply's screenshots load without opening the whole disk to
 * the browser:
 *   - images only (by extension), up to 25 MiB, regular files;
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

export const REPLY_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

export type ReplyImage =
  | { ok: true; file: string; mime: string; size: number }
  | { ok: false; status: number; error: string };

export interface ReplyImageChat {
  /** The chat's own folder: its worktree, or the agent's folder. Null when it has none. */
  folder: string | null;
  /** Set when the chat runs on another device. */
  elsewhere: string | null;
}

/** `file://` URLs, `~/`, and paths relative to the chat's folder, made absolute. */
export function resolveReplyImagePath(requested: string, folder: string | null): string | null {
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

export async function findReplyImage(
  chat: ReplyImageChat,
  requested: string,
  agentNamed: (text: string) => boolean,
): Promise<ReplyImage> {
  if (chat.elsewhere) return { ok: false, status: 409, error: `This image is on ${chat.elsewhere}.` };
  const resolved = resolveReplyImagePath(requested, chat.folder);
  if (!resolved) return { ok: false, status: 404, error: 'Not found' };
  const mime = resolveMime(null, path.basename(resolved));
  if (!mime.startsWith('image/')) return { ok: false, status: 415, error: 'Only images are shown here' };

  let real: string;
  let size: number;
  try {
    real = await fs.realpath(resolved);
    const stat = await fs.stat(real);
    if (!stat.isFile()) return { ok: false, status: 404, error: 'Not found' };
    size = stat.size;
  } catch {
    return { ok: false, status: 404, error: 'Not found' };
  }
  // The real path decides the type too, so a link named .png can't serve something else.
  if (!resolveMime(null, path.basename(real)).startsWith('image/')) return { ok: false, status: 415, error: 'Only images are shown here' };
  if (size > REPLY_IMAGE_MAX_BYTES) return { ok: false, status: 413, error: 'Image is too large to show' };

  let inFolder = false;
  if (chat.folder) {
    try {
      inFolder = inside(real, await fs.realpath(chat.folder));
    } catch {
      inFolder = false;
    }
  }
  if (!inFolder && !agentNamed(requested)) {
    return { ok: false, status: 403, error: "Only images in this chat's folder, or ones its agent showed in a reply, are shown." };
  }
  return { ok: true, file: real, mime, size };
}
