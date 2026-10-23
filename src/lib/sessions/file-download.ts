import path from 'node:path';
import { contentDisposition, UNTRUSTED_DOCUMENT_HEADERS } from '@/lib/attachments/delivery';
import { getChatSessionWithExecution } from '@/lib/db/queries';
import { readAnswerOnOwner } from '@/lib/executor/owner-files';
import { agentFolderAnswer } from '@/lib/workspaces/agent-folder-operations';
import { sanitizeRelPath } from '@/lib/workspaces/read-file';
import { fileResponseSchema } from '@/lib/server/remote-contracts';
import { sessionFileTarget } from './session-file-target';
import { isLocalArtifactTarget } from './reply-artifacts';
import { fileBytes } from '@/lib/files/byte-delivery';

const error = (status: number, message: string) => Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
const headers = (name: string, size: number) => ({
  ...UNTRUSTED_DOCUMENT_HEADERS,
  'Content-Type': 'application/octet-stream',
  'Content-Disposition': contentDisposition('attachment', name),
  'Content-Length': String(size),
  'Cache-Control': 'private, no-store',
});

/** Any authorized local file, streamed beyond the preview display cap. A remote worker keeps its own read cap. */
export async function downloadSessionFile(request: Request, sessionId: string, requested: string): Promise<Response> {
  if (!isLocalArtifactTarget(requested)) return error(415, 'Only local files download here.');
  const session = getChatSessionWithExecution(sessionId);
  if (!session) return error(404, 'This chat no longer exists.');
  const target = await sessionFileTarget(session, requested);
  if (target.kind === 'refused') return error(target.status, target.body.error);
  if (target.kind === 'folder' && target.elsewhere) {
    const answer = !session.executionId && session.workspaceId
      ? await agentFolderAnswer(session.workspaceId, { kind: 'file', path: target.path, base: false })
      : await readAnswerOnOwner(sessionId, { kind: 'file', path: target.path, base: false });
    if (!answer) return error(409, `This file is on ${target.elsewhere}.`);
    if (answer.status >= 400) return Response.json(answer.body, { status: answer.status });
    const file = fileResponseSchema.parse(answer.body);
    if (file.tooLarge) return error(413, 'This file exceeds the download limit of its device.');
    if (file.content === null) return error(409, `Open this file on ${target.elsewhere} to download it.`);
    const bytes = Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8');
    return new Response(new Uint8Array(bytes), { headers: headers(path.basename(target.path), bytes.length) });
  }
  const relative = target.kind === 'folder' ? sanitizeRelPath(target.path) : null;
  const file = target.kind === 'outside' ? target.file
    : target.root && relative ? path.join(/* turbopackIgnore: true */ target.root, relative) : null;
  if (!file) return error(400, 'Invalid file path.');
  try {
    return await fileBytes(request, file, path.basename(file));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return error(404, 'This file is no longer there.');
    throw cause;
  }
}
