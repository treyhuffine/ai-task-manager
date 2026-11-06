import { getRequestKey } from '@/lib/auth/request-key';
import { readLimitedFormData, RequestBodyTooLargeError } from '@/lib/api/limited-body';
import { writeAnswerOnOwner } from '@/lib/executor/owner-files';
import { withExecutionRequest } from '@/lib/home/execution-request';
import { whileAdmitted } from '@/lib/transfer/moving';
import { executionResourcePolicy } from '@/lib/workspaces/access';
import { agentFolderWriteAnswer } from '@/lib/workspaces/agent-folder-operations';
import { mapFileError, openSessionWorktree } from '@/lib/workspaces/session-files';
import { createWorkspaceFile } from '@/lib/workspaces/write-file';
import type { FolderSource } from './source';

/** Multipart bytes go to the same folder and device as the tree's other writes. */
export async function uploadFolderFile(request: Request, source: FolderSource): Promise<Response> {
  const run = async () => {
    const policy = executionResourcePolicy({
      ...(source.kind === 'session' ? { chatId: source.sessionId } : { workspaceId: source.workspaceId }),
      operation: 'editFiles',
    });
    if (policy.refusal) return Response.json(policy.refusal.body, { status: policy.refusal.status });

    if (!request.headers.get('content-type')?.toLowerCase().includes('multipart/form-data')) {
      return Response.json({ error: 'Content-Type must be multipart/form-data' }, { status: 400 });
    }
    let form: FormData;
    try {
      form = await readLimitedFormData(request);
    } catch (err) {
      return Response.json({ error: err instanceof RequestBodyTooLargeError
        ? 'This file is larger than the 50 MiB limit.' : 'Could not read the uploaded file.' },
      { status: err instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    const file = form.get('file');
    const relPath = form.get('path');
    if (!(file instanceof Blob) || typeof relPath !== 'string' || !relPath) {
      return Response.json({ error: 'A file and destination path are required.' }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const write = { kind: 'upload_file' as const, path: relPath, contentBase64: bytes.toString('base64') };
    if (source.kind === 'workspace') {
      const answer = await agentFolderWriteAnswer(source.workspaceId, write);
      return Response.json(answer.body, { status: answer.status });
    }
    const owner = await writeAnswerOnOwner(source.sessionId, write);
    if (owner) return Response.json(owner.body, { status: owner.status });
    const resolved = await openSessionWorktree(source.sessionId);
    if (!resolved.ok) return resolved.response;
    return Response.json({ ok: true, ...await createWorkspaceFile(resolved.handle, relPath, bytes) });
  };

  try {
    const key = getRequestKey(request.headers);
    const admitted = () => source.kind === 'session'
      ? whileAdmitted(source.sessionId, 'uploading a file', run) : run();
    return await (key ? withExecutionRequest(key, admitted) : admitted());
  } catch (err) {
    return mapFileError(err, '[upload folder file]');
  }
}
