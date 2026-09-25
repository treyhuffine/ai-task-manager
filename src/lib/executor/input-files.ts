/**
 * A message's attached files, placed for the computer its chat runs on
 * (docs/homes-build.md, P2.5). At home, each file's marker becomes its path
 * in the attachments directory. For a chat on a connected computer the
 * markers stay, and the files go beside the message with their size and
 * sha256, for that computer's worker to fetch, check, and place itself.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { Attachment } from '@/db/types';
import { markedFileNames, placeFileMarkers } from '@/lib/attachments/markers';
import { attachmentPath } from '@/lib/attachments/save';
import type { InputFile } from '@/lib/runner/types';

/** The message with each attached file's marker replaced by its path at home. */
export function placeFilesAtHome(message: string, attachments: Attachment[]): string {
  const attached = new Set(attachments.map((a) => a.fileName));
  return placeFileMarkers(message, (fileName) => (attached.has(fileName) ? attachmentPath(fileName) : null));
}

/**
 * The attached files the message still names, as a worker fetches them. A
 * file missing at home is left out, and its marker stays as written, as a
 * home chat would get a path to nothing.
 */
export async function describeInputFiles(message: string, attachments: Attachment[]): Promise<InputFile[]> {
  const named = markedFileNames(message);
  const files: InputFile[] = [];
  for (const a of attachments) {
    if (!named.delete(a.fileName)) continue;
    const bytes = await measure(attachmentPath(a.fileName));
    if (!bytes) {
      console.warn(`[input-files] ${a.fileName} (${a.originalName}) is missing at home and was not sent.`);
      continue;
    }
    files.push({ fileName: a.fileName, originalName: a.originalName, mimeType: a.mimeType, ...bytes });
  }
  return files;
}

async function measure(file: string): Promise<{ size: number; sha256: string } | null> {
  const hash = createHash('sha256');
  let size = 0;
  try {
    for await (const chunk of fs.createReadStream(file)) {
      hash.update(chunk as Buffer);
      size += (chunk as Buffer).byteLength;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return { size, sha256: hash.digest('hex') };
}
