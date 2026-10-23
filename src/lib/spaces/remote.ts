/**
 * A personal home talking to a team as its member (docs/homes-spec.md §9.3).
 *
 * Every request goes to the team's own address, carries this home's member
 * key for that team and nothing personal, never follows a redirect, and gives
 * up after a bounded wait. The team sees one of its member's sign-ins. It
 * never gets a credential for this home or anything private.
 */

import os from 'node:os';
import { createTRPCClient, httpLink, TRPCClientError } from '@trpc/client';
import { APP_SHORT_ID } from '@/constants/app';
import { API_PROTOCOL, API_PROTOCOL_HEADER } from '@/lib/releases/api-contract';
import type { AppRouter } from '@/lib/trpc/router';

export const TEAM_REQUEST_TIMEOUT_MS = 15_000;
export const TEAM_LIFECYCLE_TIMEOUT_MS = 16 * 60_000;
/** Covers the 15 minute teardown script budget plus confirmed shutdown. */
export function teamRequestTimeout(url: string, method = 'GET'): number {
  const path = new URL(url).pathname;
  if (/\/api\/attachments(?:\/|$)/.test(path)) return 60_000;
  const procedures = path.split('/api/trpc/')[1] ?? '';
  const lifecycle = /(?:^|,)(?:sessions\.(?:archivePost|closeChatPost|restartPost)|workspaces\.(?:chatNewPost|chatResumePost|archivePost)|orchestratorChat\.(?:resumePost|create)|team\.ai\.(?:setEnabled|stop|chats\.archive))(?:,|$)/;
  return method !== 'GET' && lifecycle.test(procedures) ? TEAM_LIFECYCLE_TIMEOUT_MS : TEAM_REQUEST_TIMEOUT_MS;
}

export type TeamProblem = 'unreachable' | 'untrusted_certificate' | 'signed_out' | 'protocol' | 'not_a_team' | 'local';

/** A team that couldn't be used for a reason this home can explain. */
export class TeamRequestError extends Error {
  constructor(
    readonly problem: TeamProblem,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TeamRequestError';
  }
}

export function teamProblemMessage(problem: TeamProblem, teamName = 'The team'): string {
  switch (problem) {
    case 'unreachable':
      return `${teamName} can't be reached right now. The computer hosting it may be asleep or offline.`;
    case 'untrusted_certificate':
      return `${teamName}'s address uses a certificate this Ri doesn't trust. Use its Beamd or other HTTPS address.`;
    case 'signed_out':
      return `${teamName} no longer accepts this Ri's sign-in.`;
    case 'protocol':
      return `${teamName} runs a different version of Ri. Update the older one to keep working together.`;
    case 'local':
      return 'This Ri could not finish the request. Try again.';
    case 'not_a_team':
      return "That address isn't a team.";
  }
}

function isCertificateError(err: unknown): boolean {
  const code = (err as { cause?: { code?: string } })?.cause?.code ?? '';
  return /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(code);
}

export interface TeamRequestInit extends Omit<RequestInit, 'redirect'> {
  token?: string;
  timeoutMs?: number;
  teamName?: string;
}

/**
 * One request to a team. Resolves with any response the caller should read,
 * 4xx bodies included, and throws `TeamRequestError` for an unreachable or
 * untrusted team, a refused key (401), or a protocol mismatch (426).
 */
export async function teamRequest(url: string, init: TeamRequestInit = {}): Promise<Response> {
  const { token, timeoutMs, teamName, headers, signal, ...rest } = init;
  const merged = new Headers(headers);
  merged.set(API_PROTOCOL_HEADER, String(API_PROTOCOL));
  merged.set('user-agent', `${APP_SHORT_ID}-home (${os.hostname()})`);
  if (token) merged.set('authorization', `Bearer ${token}`);
  else merged.delete('authorization');
  merged.delete('cookie');
  if (rest.body && typeof rest.body === 'string' && !merged.has('content-type')) merged.set('content-type', 'application/json');
  const timeout = AbortSignal.timeout(timeoutMs ?? teamRequestTimeout(url, rest.method));
  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers: merged, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (err) {
    if (signal?.aborted) throw err;
    const problem: TeamProblem = isCertificateError(err) ? 'untrusted_certificate' : 'unreachable';
    throw new TeamRequestError(problem, teamProblemMessage(problem, teamName));
  }
  if (res.status === 401 && token) throw new TeamRequestError('signed_out', teamProblemMessage('signed_out', teamName), 401);
  if (res.status === 426) throw new TeamRequestError('protocol', teamProblemMessage('protocol', teamName), 426);
  return res;
}

/** The team's own tRPC API, called as this home's member. */
export function teamTRPC(url: string, token: string, teamName?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${url}/api/trpc`,
        fetch: (url, init) => teamRequest(String(url), { ...(init as RequestInit), token, teamName }),
      }),
    ],
  });
}

export type TeamClient = ReturnType<typeof teamTRPC>;

/** The team's own problem, when a tRPC call failed for one. */
export function teamRequestProblem(err: unknown): TeamRequestError | null {
  if (err instanceof TeamRequestError) return err;
  if (err instanceof TRPCClientError && err.cause instanceof TeamRequestError) return err.cause;
  if (err instanceof TRPCClientError) return new TeamRequestError('unreachable', `The team could not complete this request. ${err.message.slice(0, 300)}`);
  return new TeamRequestError('local', err instanceof Error ? `This Ri could not finish the request. ${err.message.slice(0, 300)}` : teamProblemMessage('local'));
}
