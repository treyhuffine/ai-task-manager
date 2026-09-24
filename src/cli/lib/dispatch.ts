/**
 * Run an orchestrator action from the CLI wherever this computer's data is
 * (docs/homes-spec.md §5.3).
 *
 * - On a home: in this process, as the trusted local CLI.
 * - On a connected computer: on the home, through
 *   `POST /api/orchestrator/actions/:name`, with this computer's key and the
 *   calling harness session's signed credential when there is one. The home
 *   runs it as a remote call. If the home can't be reached the action fails
 *   and says so. Nothing is written locally.
 *
 * Either way the result is the same envelope, so commands print it the same
 * way.
 */

import { runAction, type DispatchEnvelope } from '@/lib/orchestrator/dispatch';
import {
  SESSION_CREDENTIAL_ENV,
  SESSION_CREDENTIAL_HEADER,
  actorFromSessionCredential,
} from '@/lib/orchestrator/session-credential';
import { getInstallationRole } from '@/lib/config/role';
import { readConnection } from '@/lib/connection/config';
import { homeFetch, HomeRequestError } from '@/lib/connection/home-client';

export async function dispatchAction(name: string, input: unknown): Promise<DispatchEnvelope> {
  if (getInstallationRole() === 'connected') return runActionAtHome(name, input);
  // From a harness session's shell, its signed credential names the chat that
  // is calling. A human at a terminal has none, and runs with no actor.
  const actor = actorFromSessionCredential(process.env[SESSION_CREDENTIAL_ENV]);
  return runAction(name, input, { remote: false, actor, caller: { location: 'home' } });
}

export async function runActionAtHome(name: string, input: unknown): Promise<DispatchEnvelope> {
  const connection = readConnection();
  if (!connection) {
    return { ok: false, action: name, error: { code: 'not_connected', message: 'This computer is not connected to a home.' } };
  }
  const credential = process.env[SESSION_CREDENTIAL_ENV];
  try {
    const res = await homeFetch(connection, `/api/orchestrator/actions/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
      headers: credential ? { [SESSION_CREDENTIAL_HEADER]: credential } : {},
    });
    if (res.status === 404) {
      return {
        ok: false,
        action: name,
        error: {
          code: 'unsupported',
          message: `${connection.homeName} runs an older version of Ri that can't take actions from connected computers. Update it, then try again.`,
        },
      };
    }
    const body = (await res.json().catch(() => null)) as DispatchEnvelope | { error?: string; message?: string } | null;
    if (body && 'ok' in body) return body;
    return {
      ok: false,
      action: name,
      error: { code: body?.error ?? 'error', message: body?.message ?? `${connection.homeName} returned HTTP ${res.status}.` },
    };
  } catch (err) {
    if (err instanceof HomeRequestError) {
      return { ok: false, action: name, error: { code: err.problem, message: err.message } };
    }
    throw err;
  }
}
