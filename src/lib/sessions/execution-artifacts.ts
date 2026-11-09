import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChatSessionWithExecution, listChatSessions, listArtifactMessages } from '@/lib/db/queries';
import { messageArtifactPaths, type ArtifactCursor } from './artifact-messages';
import type { FilePreviewSource } from '@/lib/files/preview-types';

export function listExecutionArtifacts(sessionId: string, before?: ArtifactCursor, visible: (chat: { id: string }) => boolean = () => true) {
  const current = getChatSessionWithExecution(sessionId);
  const chats = (current?.executionId ? listChatSessions({ executionId: current.executionId }) : current ? [current] : []).filter(visible);
  const labels = new Map(chats.map(chat => [chat.id, chat.label ?? 'Untitled chat']));
  const limit = 50;
  // Each chat gets its own ordered index walk. An IN over all chats would
  // make SQLite sort their entire histories before applying LIMIT.
  const candidates = chats.flatMap(chat => listArtifactMessages(chat.id, before, limit + 1));
  candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const messages = candidates.slice(0, limit);
  const folder = current?.location?.folder ?? current?.worktreePath;
  const items = messages.flatMap(message => {
    const provenance = { sessionId: message.sessionId, chatLabel: labels.get(message.sessionId)!, eventId: message.id, createdAt: message.createdAt };
    const attached = (message.attachments ?? []).map(file => ({
      ...provenance, key: `attachment:${file.fileName}`, name: file.originalName || file.fileName,
      source: { kind: 'attachment', fileName: file.fileName, ...(/^(audio|video)\//.test(file.mimeType) ? { media: file.mimeType.startsWith('audio/') ? 'audio' : 'video' } : {}) } as FilePreviewSource,
      mimeType: file.mimeType,
    }));
    const shared = message.source === 'agent' ? messageArtifactPaths(message.content ?? '').map(target => {
      let normalized = target;
      try { if (target.startsWith('file://')) normalized = fileURLToPath(target); } catch { /* Keep the original reference for its error view. */ }
      const identity = folder && !normalized.startsWith('~/') ? path.resolve(/* turbopackIgnore: true */ folder, normalized) : path.normalize(normalized);
      return { ...provenance, key: `path:${identity}`, name: normalized.split('/').at(-1) || normalized,
        source: { kind: 'session', sessionId: message.sessionId, path: target } as FilePreviewSource, mimeType: null };
    }) : [];
    return [...shared, ...attached];
  });
  const last = messages.at(-1);
  return { items, nextCursor: candidates.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null };
}
