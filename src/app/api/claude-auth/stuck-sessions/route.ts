import { listSessionsStuckOnSource } from '@/lib/db/queries';
import { camelizeKeys } from '@/lib/case/keys';
import type { Attachment, StoredAttachment } from '@/db/types';
import { withCompression } from '@/lib/api/compression';

export interface StuckSession {
  id: string;
  label: string | null;
  lastUserMessage: {
    eventId: string;
    content: string;
    attachments: Attachment[];
  } | null;
}

/**
 * GET /api/claude-auth/stuck-sessions
 *
 * Drives the "Resume sessions" floating card. Returns the active sessions
 * whose most-recent event is `auth_required`, enriched with the last
 * user message in each so the card can show a preview + Resend action
 * without further round-trips.
 *
 * Cheap to call repeatedly — the floating card refetches on close+reopen
 * and after each Resend so a row disappears once its dispatch lands.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  const rows = listSessionsStuckOnSource('auth_required');
  const sessions: StuckSession[] = rows.map((r) => {
    // The CTE pulls the JSON column verbatim, so the parsed shape is
    // snake_case `StoredAttachment[]`. Camelize at the boundary to keep
    // the wire contract camelCase and let `expandMarkers` read
    // `.fileName` / `.mimeType` correctly downstream.
    const attachments = ((): Attachment[] => {
      if (!r.last_user_attachments) return [];
      try {
        const parsed = JSON.parse(r.last_user_attachments) as StoredAttachment[];
        return Array.isArray(parsed) ? camelizeKeys(parsed) : [];
      } catch {
        return [];
      }
    })();
    return {
      id: r.sessionId,
      label: r.label,
      lastUserMessage: r.last_user_event_id
        ? {
            eventId: r.last_user_event_id,
            content: r.last_user_content ?? '',
            attachments,
          }
        : null,
    };
  });
  return Response.json({ sessions });
}
