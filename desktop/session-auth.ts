type SessionFailure = 'credential' | 'forbidden' | 'server' | 'response' | 'timeout' | 'network';

export class DesktopSessionError extends Error {
  constructor(message: string, readonly code: SessionFailure, readonly status?: number) {
    super(message);
    this.name = 'DesktopSessionError';
  }
}

function responseFailure(status: number, local: boolean) {
  const home = local ? 'The local Ri service' : 'Your Home';
  const log = local ? 'the local service log' : 'the Home service log';
  if (status === 401) return new DesktopSessionError(local
    ? `${home} rejected its desktop sign-in credential (HTTP 401). Restart the local service, then retry.`
    : `${home} rejected this device's sign-in credential (HTTP 401). Connect this device again.`, 'credential', status);
  if (status === 403) return new DesktopSessionError(`${home} refused this session request (HTTP 403). Check its access settings and ${log} before retrying.`, 'forbidden', status);
  if (status >= 500 && status <= 599) return new DesktopSessionError(`${home} could not create a desktop session (HTTP ${status}). Check ${log} for the server error, then retry.`, 'server', status);
  if (status === 429) return new DesktopSessionError(`${home} is limiting sign-in attempts (HTTP 429). Wait before retrying.`, 'response', status);
  return new DesktopSessionError(`${home} returned an unexpected sign-in response (HTTP ${status}). Check ${log} and the connection address before retrying.`, 'response', status);
}

/** Establish the cookie in Electron's existing session. Response bodies are
 * untrusted and unnecessary: never read one, expose one, or wait for one to end.
 */
export async function signInDesktopSession(options: {
  origin: string;
  token: string;
  local: boolean;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}) {
  const signal = AbortSignal.timeout(15_000);
  let response: Response;
  try {
    response = await options.fetch(`${options.origin}/api/session`, {
      method: 'POST', headers: { authorization: `Bearer ${options.token}` }, redirect: 'error', signal,
    });
  } catch (error) {
    const home = options.local ? 'The local Ri service' : 'Your Home';
    if (signal.aborted || (error instanceof Error && error.name === 'TimeoutError')) {
      throw new DesktopSessionError(`${home} did not finish signing in within 15 seconds. Retry when it is ready and reachable.`, 'timeout');
    }
    throw new DesktopSessionError(options.local
      ? `${home} could not be reached for sign-in. Check its status and service log, then retry.`
      : `${home} could not be reached for sign-in. Check its address, connection and HTTPS certificate, then retry.`, 'network');
  }
  // Cancel rather than draining an arbitrarily large/never-ending error page.
  // A broken body must not mask the HTTP status or stall viewer transitions.
  void response.body?.cancel().catch(() => {});
  if (!response.ok) throw responseFailure(response.status, options.local);
}
