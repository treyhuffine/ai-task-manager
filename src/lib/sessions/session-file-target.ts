/**
 * Which file a chat's viewer may open for a requested path, decided once for
 * every reader: the file viewer's JSON read (`/api/sessions/:id/file`), the
 * HTML preview's document (`/api/sessions/:id/html`) and a PDF's bytes and
 * page images (`/api/sessions/:id/pdf`). They answer the same question, so
 * they share this rather than each restating it.
 *
 *   - Relative paths, and absolute ones under the chat's folder, are folder
 *     files. The reader keeps them inside the folder, here or on the device
 *     the chat runs on.
 *   - Anything else is outside, and opens when the agent shared that exact
 *     HTML or PDF path in a reply in this chat (`reply-files.ts`, checked
 *     first so the common handoff never scans file-tool history), or when one
 *     of its file tools named it (`named-files.ts`).
 */

import { sanitizeRelPath } from '@/lib/workspaces/read-file';
import { executionResourcePolicy } from '@/lib/workspaces/access';
import type { ChatSessionWithExecution } from '@/db/types';
import { agentReplyMentions, fileToolCallNamed } from '@/lib/db/queries';
import { preparedFolder } from '@/lib/executions/location';
import { NOT_NAMED_MESSAGE, placeViewerPath } from './named-files';
import { findReplyFile, resolveReplyFilePath } from './reply-files';
import { isLocalHtmlTarget } from './reply-html';
import { isLocalPdfTarget } from './reply-pdf';
import { HTML_PREVIEW_MAX_BYTES } from './html-preview-response';
import { PDF_MAX_BYTES } from '@/lib/attachments/pdf-delivery';

export type SessionFileTarget =
  /** In the chat's folder, as a folder-relative path. */
  | { kind: 'folder'; path: string }
  /** Outside it and allowed: `file` to read, `shown` as the path to answer with. */
  | { kind: 'outside'; file: string; shown: string }
  | { kind: 'refused'; status: number; body: { error: string; code?: string } };

export async function sessionFileTarget(session: ChatSessionWithExecution, requested: string): Promise<SessionFileTarget> {
  const policy = executionResourcePolicy({ chatId: session.id, operation: 'inspectFiles' });
  if (policy.refusal) return { kind: 'refused', status: policy.refusal.status, body: { error: policy.refusal.body.message } };
  const folder = preparedFolder(session);
  const viewerPath = /^file:\/\//i.test(requested) || requested.startsWith('~/')
    ? resolveReplyFilePath(requested, folder) : requested;
  if (!viewerPath) return { kind: 'refused', status: 400, body: { error: 'Invalid path', code: 'invalid_path' } };
  const placed = placeViewerPath(viewerPath, folder);
  if (placed.kind === 'folder') {
    if (policy.authority && !sanitizeRelPath(placed.path)) return { kind: 'refused', status: 403, body: { error: 'Choose a file inside this team execution.', code: 'outside_execution' } };
    return { kind: 'folder', path: placed.path };
  }

  if (policy.authority) return { kind: 'refused', status: 403, body: { error: 'Only files inside this team execution can be opened.', code: 'outside_execution' } };

  const shared = isLocalHtmlTarget(requested) ? { kind: 'html' as const, maxBytes: HTML_PREVIEW_MAX_BYTES }
    : isLocalPdfTarget(requested) ? { kind: 'pdf' as const, maxBytes: PDF_MAX_BYTES } : null;
  if (shared && agentReplyMentions(session.id, requested)) {
    // Shared HTML and PDF artifacts usually arrive as a reply path or
    // visualize marker, with no file tool call before them. The same narrow,
    // real-file rule as reply images. The size bound is the preview's: the
    // file viewer's JSON read reports anything over its own cap as `tooLarge`.
    const artifact = await findReplyFile({
      folder,
      elsewhere: session.location && !session.location.isHome ? session.location.name : null,
    }, requested, () => true, shared);
    if (!artifact.ok) return { kind: 'refused', status: artifact.status, body: { error: artifact.error } };
    return { kind: 'outside', file: artifact.file, shown: requested };
  }
  if (!fileToolCallNamed({ sessionId: session.id, executionId: session.executionId }, placed.file)) {
    return { kind: 'refused', status: 403, body: { error: NOT_NAMED_MESSAGE, code: 'not_named' } };
  }
  // The file is on the device the chat runs on, which only reads its own folder.
  if (session.location && !session.location.isHome) {
    return { kind: 'refused', status: 409, body: { error: `This file is on ${session.location.name}.`, code: 'elsewhere' } };
  }
  return { kind: 'outside', file: placed.file, shown: placed.file };
}
