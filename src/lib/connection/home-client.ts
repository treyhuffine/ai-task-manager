/**
 * How a connected computer talks to its home (docs/homes-spec.md §3.1, §5.3).
 *
 * `homeFetch` adds this computer's credential and a user agent, bounds every
 * call with a timeout, and turns failures into the states the spec asks the
 * UI and CLI to show (§3.5): the home can't be reached, this computer's
 * access was removed, the address now answers for a different home, or the
 * home isn't active. It never falls back to anything local.
 */

import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';
import type { ConnectionConfig } from './config';

export const HOME_REQUEST_TIMEOUT_MS = 10_000;

export type HomeProblem =
  /** Nothing answered: offline, asleep, wrong address, or a network in between. */
  | 'unreachable'
  /** The home answered but refused this computer's credential. */
  | 'unauthorized'
  /** Something answered, but it isn't this computer's home. */
  | 'wrong_home'
  /** The home's data is on a machine where it isn't the active home. */
  | 'not_active'
  /** HTTPS failed because the certificate isn't trusted. */
  | 'untrusted_certificate'
  /** Any other failure. */
  | 'error';

export class HomeRequestError extends Error {
  constructor(
    readonly problem: HomeProblem,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HomeRequestError';
  }
}

function where(connection: Pick<ConnectionConfig, 'homeName' | 'homeHostName' | 'homeUrl'>): string {
  return connection.homeHostName ? `your Ri on ${connection.homeHostName}` : `${connection.homeName} at ${connection.homeUrl}`;
}

export function describeHomeProblem(
  problem: HomeProblem,
  connection: Pick<ConnectionConfig, 'homeName' | 'homeHostName' | 'homeUrl'>,
  detail?: string,
): string {
  switch (problem) {
    case 'unreachable':
      return `Cannot reach ${where(connection)}. Check that it is awake and online, then try again.`;
    case 'unauthorized':
      return `${connection.homeName} no longer accepts this computer. Connect it again from your home.`;
    case 'wrong_home':
      return `${connection.homeUrl} now answers for a different Ri. Connect again, or update the address if your home moved.`;
    case 'not_active':
      return `${connection.homeName} isn't active on the computer at ${connection.homeUrl}.`;
    case 'untrusted_certificate':
      return `${connection.homeUrl} uses a certificate this computer doesn't trust. Use your home's Beamd or other trusted HTTPS address.`;
    default:
      return detail ? `${connection.homeName} returned an error: ${detail}` : `${connection.homeName} returned an error.`;
  }
}

function userAgent(): string {
  return `${APP_SHORT_ID}-cli (${os.hostname()})`;
}

function isCertificateError(err: unknown): boolean {
  const code = (err as { cause?: { code?: string } })?.cause?.code ?? '';
  return /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(code);
}

export interface HomeFetchOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
}

/**
 * Call the home. Resolves with the response for any HTTP status the caller
 * may want to read (including 4xx bodies), and throws `HomeRequestError`
 * for the states above.
 */
export async function homeFetch(
  connection: Pick<ConnectionConfig, 'homeUrl' | 'credential' | 'homeName' | 'homeHostName'>,
  path: string,
  init: HomeFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = HOME_REQUEST_TIMEOUT_MS, headers, ...rest } = init;
  const url = `${connection.homeUrl}${path.startsWith('/') ? path : `/${path}`}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        authorization: `Bearer ${connection.credential}`,
        'user-agent': userAgent(),
        ...(rest.body && !(headers as Record<string, string> | undefined)?.['content-type']
          ? { 'content-type': 'application/json' }
          : {}),
        ...(headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isCertificateError(err)) {
      throw new HomeRequestError('untrusted_certificate', describeHomeProblem('untrusted_certificate', connection));
    }
    throw new HomeRequestError('unreachable', describeHomeProblem('unreachable', connection));
  }
  if (res.status === 401 || res.status === 403) {
    throw new HomeRequestError('unauthorized', describeHomeProblem('unauthorized', connection), res.status);
  }
  if (res.status === 503) {
    const body = (await res.clone().json().catch(() => null)) as { error?: string } | null;
    if (body?.error === 'home_not_active') {
      throw new HomeRequestError('not_active', describeHomeProblem('not_active', connection), 503);
    }
  }
  return res;
}

export interface HomeSummary {
  id: string;
  kind: string;
  name: string;
  host: { id: string; name: string; platform: string | null };
}

/**
 * Confirm the address answers for this computer's home, with this
 * computer's credential. Throws `HomeRequestError` otherwise.
 */
export async function checkHome(connection: ConnectionConfig): Promise<HomeSummary> {
  const res = await homeFetch(connection, '/api/home');
  if (res.status === 404) {
    throw new HomeRequestError(
      'error',
      `${connection.homeName} runs an older version of Ri that can't accept connected computers. Update it, then try again.`,
      404,
    );
  }
  if (!res.ok) {
    throw new HomeRequestError('error', describeHomeProblem('error', connection, `HTTP ${res.status}`), res.status);
  }
  const home = (await res.json()) as HomeSummary;
  if (home.id !== connection.homeId) {
    throw new HomeRequestError('wrong_home', describeHomeProblem('wrong_home', connection));
  }
  return home;
}
