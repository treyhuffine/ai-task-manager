/**
 * How skill errors reach HTTP callers (the app and the orchestrator actions,
 * which call the same routes). One shape: `{ error, code }`, plus `current`
 * on a stale write so the caller can reload or merge without another read.
 */

import { SkillError } from './library';

const STATUS: Record<SkillError['code'], number> = {
  invalid: 400,
  not_found: 404,
  conflict: 409,
  stale: 409,
};

export function skillErrorResponse(err: unknown, where: string): Response {
  if (err instanceof SkillError) {
    return Response.json(
      { error: err.message, code: err.code, ...(err.current ? { current: err.current } : {}) },
      { status: STATUS[err.code] },
    );
  }
  console.error(`[${where}]`, err);
  return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
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
