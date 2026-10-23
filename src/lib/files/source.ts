import fs from 'node:fs/promises';
import path from 'node:path';
import { attachmentPath } from '@/lib/attachments/save';
import { ATTACHMENT_FILE_NAME } from '@/lib/attachments/markers';
import { getChatSessionWithExecution } from '@/lib/db/queries';
import { sessionFileTarget } from '@/lib/sessions/session-file-target';
import { sanitizeRelPath } from '@/lib/workspaces/read-file';
import { OperationError } from '@/lib/server/operation';
import type { FilePreviewSource } from './preview-types';

/** A local file the viewer may read. A worker's filesystem is never read on Home. */
export async function previewFile(source: FilePreviewSource) {
  let file: string;
  let name: string;
  if (source.kind === 'attachment') {
    if (!ATTACHMENT_FILE_NAME.test(source.fileName)) throw new OperationError(400, { error: 'Invalid filename' });
    file = attachmentPath(source.fileName);
    name = source.fileName;
  } else {
    const session = getChatSessionWithExecution(source.sessionId);
    if (!session) throw new OperationError(404, { error: 'This chat no longer exists.' });
    const target = await sessionFileTarget(session, source.path);
    if (target.kind === 'refused') throw new OperationError(target.status, target.body);
    if (target.kind === 'outside') file = target.file;
    else {
      if (target.elsewhere) throw new OperationError(409, { error: `This file is on ${target.elsewhere}. Open it on that device.` });
      const relative = sanitizeRelPath(target.path);
      if (!target.root || !relative) throw new OperationError(400, { error: 'Invalid file path.' });
      file = path.join(/* turbopackIgnore: true */ target.root, relative);
    }
    name = path.basename(file);
  }
  try {
    const stat = await fs.stat(/* turbopackIgnore: true */ file);
    if (!stat.isFile()) throw new OperationError(400, { error: 'This path is not a regular file.' });
    return { file, name, size: stat.size, modified: stat.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new OperationError(404, { error: 'This file is no longer there.' });
    throw error;
  }
}
