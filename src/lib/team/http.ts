/**
 * Shared handling for the team's own REST routes (src/app/api/team/**):
 * a JSON body read within a bound, checked against its schema, and a team's
 * refusals turned into their status, never a stack trace.
 */

import type { z } from 'zod/v4';
import { readLimitedJson, RequestBodyTooLargeError } from '@/lib/api/limited-body';
import { isTeamError, type TeamErrorCode } from '@/lib/db/queries';
import { isTeamAuthority } from '@/lib/home/authority';

const STATUS: Record<TeamErrorCode, number> = {
  invalid: 400,
  expired: 410,
  used: 409,
  revoked: 410,
  not_allowed: 403,
  conflict: 409,
  not_found: 404,
};

export function notATeam(): Response {
  return Response.json({ error: 'not_a_team', message: 'This Ri is not a team space.' }, { status: 404 });
}

export async function readInput<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S> | Response> {
  let body: unknown;
  try {
    body = await readLimitedJson(request, 64 * 1024);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) return Response.json({ error: 'too_large' }, { status: 413 });
    return Response.json({ error: 'invalid_json', message: 'Send a JSON body.' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'invalid', message: 'That request is missing something.' }, { status: 400 });
  return parsed.data;
}

/** Run a team route: 404 outside a team, a team's refusal as its status. */
export async function teamRoute(handler: () => Promise<Response> | Response): Promise<Response> {
  if (!isTeamAuthority()) return notATeam();
  try {
    return await handler();
  } catch (err) {
    if (isTeamError(err)) return Response.json({ error: err.code, message: err.message }, { status: STATUS[err.code] });
    console.error('[team]', err);
    return Response.json({ error: 'failed', message: 'Something went wrong. Try again.' }, { status: 500 });
  }
}

export const noStore = { 'Cache-Control': 'no-store' } as const;
