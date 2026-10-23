/**
 * GET|POST /api/space/<team>/<path>: a team's space inside My Ri reaching its
 * team (docs/homes-spec.md §3.2, §9.3, P7.1).
 *
 * The personal owner's request (the proxy checked their key) goes on to the
 * team as this home's member, and only to the team's typed API and its files.
 * Nothing personal goes with it: no cookie or personal key. Only content
 * negotiation and that team's document expectations accompany its credential.
 * A team that refuses the key ends the connection, and one
 * that can't be reached says so, as `team_signed_out` and `team_unreachable`.
 */

import { SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';
import type { NextRequest } from 'next/server';
import { getRequestKey } from '@/lib/auth/request-key';
import { isTeamAuthority } from '@/lib/home/authority';
import { isCurrentTeam, recordTeamFailure, teamFor } from '@/lib/spaces/connect';
import { SPACE_ID_PATTERN } from '@/lib/spaces/document';
import { teamRequest, teamRequestProblem } from '@/lib/spaces/remote';
import { UNTRUSTED_DOCUMENT_HEADERS } from '@/lib/attachments/delivery';
import { bindingFromHeaders, documentBindingMatches, DOCUMENT_HOME_HEADER, DOCUMENT_VIEWER_HEADER, DOCUMENT_AUTHOR_CHANGED, DOCUMENT_AUTHOR_CHANGED_MESSAGE } from '@/lib/home/document-binding';

export const runtime = 'nodejs';

/** Attachments are capped at 50 MiB, plus room for the multipart envelope. */
const MAX_BODY_BYTES = 51 * 1024 * 1024;
/** Response headers worth keeping. Encoding and length aren't: the body arrives decoded. */
const PASSED_HEADERS = ['content-type', 'content-disposition'];

type Context = { params: Promise<{ teamId: string; path: string[] }> };

function reachable(method: string, path: string[]): boolean {
  if (path.some((segment) => !segment || segment === '.' || segment === '..' || /[/\\]/.test(segment))) return false;
  if (path[0] === 'trpc') return path.length === 2 && (method === 'GET' || method === 'POST');
  if (path[0] === 'transcribe') return path.length === 1 && method === 'POST';
  if (path[0] === 'attachments') return (path.length === 1 && method === 'POST') || (path.length === 2 && method === 'GET');
  return false;
}

async function forward(request: NextRequest, { params }: Context): Promise<Response> {
  if (isTeamAuthority()) return Response.json({ error: 'not_found' }, { status: 404 });
  if (getRequestKey(request.headers)?.scope !== 'viewer') {
    return Response.json({ error: 'forbidden', message: 'Only you can open your teams.' }, { status: 403 });
  }
  const { teamId, path } = await params;
  if (!SPACE_ID_PATTERN.test(teamId) || !reachable(request.method, path)) return Response.json({ error: 'not_found' }, { status: 404 });
  if (request.headers.has(SESSION_CREDENTIAL_HEADER)) return Response.json({ error: 'forbidden', message: 'Only a signed-in person can use this Team relay. Disclosed agents must use native Team actions with their own authority.' }, { status: 403 });
  const team = await teamFor(teamId);
  if (!team) return Response.json({ error: 'team_unavailable', message: "This team isn't connected to My Ri." }, { status: 404 });
  if (!documentBindingMatches(bindingFromHeaders(request.headers), { homeId: team.connection.id, viewerId: team.connection.memberId })) return Response.json({ error: DOCUMENT_AUTHOR_CHANGED, message: DOCUMENT_AUTHOR_CHANGED_MESSAGE }, { status: 403 });

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return Response.json({ error: 'too_large', message: 'That file is too large.' }, { status: 413 });
  const body = request.method === 'GET' ? undefined : await request.arrayBuffer();
  if (body && body.byteLength > MAX_BODY_BYTES) return Response.json({ error: 'too_large', message: 'That file is too large.' }, { status: 413 });

  const headers: Record<string, string> = {};
  const contentType = request.headers.get('content-type');
  if (contentType) headers['content-type'] = contentType;
  const accept = request.headers.get('accept');
  if (accept) headers.accept = accept;
  headers[DOCUMENT_HOME_HEADER] = team.connection.id;
  headers[DOCUMENT_VIEWER_HEADER] = team.connection.memberId;

  const url = `${team.connection.url}/api/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
  try {
    const res = await teamRequest(url, {
      method: request.method,
      headers,
      body,
      token: team.token,
      teamName: team.connection.name,
      signal: request.signal,
    });
    if (!isCurrentTeam(team)) {
      await res.body?.cancel();
      return Response.json({ error: 'team_unavailable', message: 'The team connection changed.' }, { status: 403 });
    }
    // The team's response is untrusted content on My Ri's origin, even if
    // its API supplies HTML or omits its own attachment sandbox. Enforce our
    // policy here, and never let a browser cache bypass membership checks.
    const passed = new Headers({ ...UNTRUSTED_DOCUMENT_HEADERS, 'Cache-Control': 'no-store' });
    for (const name of PASSED_HEADERS) {
      const value = res.headers.get(name);
      if (value) passed.set(name, value);
    }
    return new Response(res.body, { status: res.status, headers: passed });
  } catch (err) {
    const problem = recordTeamFailure(teamId, err, team) ?? teamRequestProblem(err);
    if (problem?.problem === 'signed_out') return Response.json({ error: 'team_signed_out', message: problem.message }, { status: 403 });
    if (problem) return Response.json({ error: 'team_unreachable', message: problem.message }, { status: 502 });
    throw err;
  }
}

export const GET = forward;
export const POST = forward;
