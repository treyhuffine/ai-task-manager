/**
 * Shared error shaping for the preview API routes. Turns a
 * `PreviewServiceError` into a clean JSON envelope with its status code;
 * everything else is a 500.
 */

import { isTeamError } from '@/lib/db/queries';
import { PreviewServiceError } from './service';

export function previewErrorResponse(err: unknown, context: string): Response {
  if (isTeamError(err)) return Response.json({ error: err.code, message: err.message }, { status: err.code === 'not_found' ? 404 : 403 });
  if (err instanceof PreviewServiceError) {
    return Response.json(
      { error: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) },
      { status: err.status },
    );
  }
  console.error(`[${context}]`, err);
  return Response.json({ error: 'preview_failed', message: String(err) }, { status: 500 });
}
