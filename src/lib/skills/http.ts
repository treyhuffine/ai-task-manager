/**
 * How skill errors reach HTTP callers (the app and the orchestrator actions,
 * which call the same routes). One shape: `{ error, code }`, plus `current`
 * on a stale write so the caller can reload or merge without another read.
 */

import { SkillError } from './library';
import { getHome, isTeamError } from '@/lib/db/queries';

const STATUS: Record<SkillError['code'], number> = {
  invalid: 400,
  not_found: 404,
  conflict: 409,
  stale: 409,
};

export function skillErrorResponse(err: unknown, where: string): Response {
  if (isTeamError(err)) return Response.json({ error: err.message, code: err.code }, { status: err.code === 'not_allowed' ? 403 : err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 400 });
  if (err instanceof SkillError) {
    return Response.json(
      { error: err.message, code: err.code, ...(err.current ? { current: getHome()?.kind === 'team' ? { ...err.current, dir: `<team-home>/skills/${err.current.name}` } : err.current } : {}) },
      { status: STATUS[err.code] },
    );
  }
  console.error(`[${where}]`, err);
  return Response.json({ error: getHome()?.kind === 'team' ? 'The shared skill could not be changed. Try again.' : err instanceof Error ? err.message : String(err) }, { status: 500 });
}

/** Parse a JSON body, answering 400 instead of throwing on junk. */
export async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // Fall through.
  }
  return Response.json({ error: 'Send a JSON object.' }, { status: 400 });
}
