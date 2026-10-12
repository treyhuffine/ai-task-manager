/**
 * Presentation helpers for attachments. Lives outside of React so it can be
 * used by pure functions (exporters, agent prompts, tests) as well as UI.
 */

import type { Attachment } from '@/db/types';
import { currentSpaceId, spaceApiBase } from '@/lib/spaces/document';

/** Build the authenticated URL the app uses to serve a stored file: the team's, in a team's space in My Ri. */
export function attachmentUrl(fileName: string): string {
  const space = currentSpaceId();
  return space ? `${spaceApiBase(space)}/attachments/${fileName}` : `/api/attachments/${fileName}`;
}

/** Render relative attachment URLs in the document's own store, leaving external links alone. */
export function bodyWithAttachmentUrls(body: string, fileUrl: (fileName: string) => string): string {
  return body.replace(/(^|[\s("'=])\/api\/attachments\/([A-Za-z0-9_-]+\.[A-Za-z0-9]+)/g,
    (_match, prefix: string, fileName: string) => `${prefix}${fileUrl(fileName)}`);
}

/** First image-like attachment on an entity, or null. The convention used
 *  anywhere the app renders a "cover" for an area, note, or task. */
export function coverAttachment(
  attachments: Attachment[] | null | undefined,
): Attachment | null {
  if (!attachments || attachments.length === 0) return null;
  return attachments.find((a) => a.mimeType.startsWith('image/')) ?? null;
}

/** Convenience: src URL for the first image attachment, or null. */
export function coverAttachmentUrl(
  attachments: Attachment[] | null | undefined,
): string | null {
  const a = coverAttachment(attachments);
  return a ? attachmentUrl(a.fileName) : null;
}

/** Is this attachment an audio file? Used by stream UIs to decide whether
 *  to render a player chip. */
export function isAudioAttachment(a: Attachment): boolean {
  return a.mimeType.startsWith('audio/');
}
