/**
 * Shared HTTP mapping for stream triage routes: TriageError codes onto
 * status codes, everything else onto 500 with a logged cause.
 */

import { TriageError } from '@/lib/db/queries';

const STATUS_BY_CODE = {
  not_found: 404,
  invalid_params: 400,
  conflict: 409,
} as const;

export function triageErrorResponse(scope: string, err: unknown): Response {
  if (err instanceof TriageError) {
    return Response.json({ error: err.message, code: err.code }, { status: STATUS_BY_CODE[err.code] });
  }
  console.error(`[${scope}]`, err);
  return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
}
