/**
 * Minimal client for registry handlers that need the RUNNING app server —
 * not the database.
 *
 * Why this exists: live session state is process-owned. The in-memory
 * `AgentSession` cache, the running-sessions set, and pending-input
 * resolvers all live in the server process. Registry handlers, however,
 * run in two different processes depending on surface:
 *
 *   - orchestrator MCP → inside the server (state visible)
 *   - CLI (`<cli> agent …`) → its own short-lived process (state invisible;
 *     worse, dispatching from here would spawn a *duplicate* harness
 *     process against a session the server already owns)
 *
 * Routing live reads + session mutations through the server's HTTP API
 * makes both surfaces behave identically and keeps exactly one process
 * owning every harness subprocess. DB-only reads should NOT use this —
 * query the DB directly; it works from any process.
 */

import { readAuthConfig } from '@/lib/auth/config-file';
import { getLocalBaseUrl } from '@/lib/auth/bootstrap';
import { PUBLIC_BASE_URL_ENV, readLiveServerRuntime } from '@/lib/server-runtime/record';
import { ActionError } from './types';
import type { WorkstreamRuntime, ScopeChange } from '@/lib/sessions/workstream';

/**
 * Base URL for INTERNAL self-calls into the app's HTTP API.
 *
 * These must reach the app over a plain-HTTP loopback address, never the public
 * HTTPS gateway: under `--http2` the public origin is HTTPS with a locally-
 * generated certificate this internal Node client does not carry the CA for, so
 * a `fetch` to it fails validation and every send/stop/notify would break. In
 * gateway mode we target the private Next listener directly:
 *   - in the server process, `PORT` is that private port;
 *   - out of process (e.g. `ri agent`), the runtime record carries it.
 * Direct HTTP and portless deployments keep their existing public/local URL.
 */
export function serverBaseUrl(): string {
  const envPort = Number(process.env.PORT);
  const gatewayInProcess = process.env[PUBLIC_BASE_URL_ENV]?.startsWith('https:');
  if (gatewayInProcess && Number.isFinite(envPort) && envPort > 0) {
    return `http://127.0.0.1:${envPort}`;
  }
  // Only follow a LIVE record: a stale HTTPS record left by a crashed run (or
  // after a switch back to HTTP) must not redirect self-calls to a dead port.
  const record = readLiveServerRuntime();
  if (record?.mode === 'https') {
    return record.privateUpstreams.next;
  }
  return getLocalBaseUrl();
}

/**
 * Authenticated fetch against the app server. Throws `ActionError` with a
 * actionable message when the server is unreachable — callers that can
 * degrade gracefully (live-signal enrichment) should catch; callers that
 * can't (sends) let it propagate.
 *
 * `Connection: close` — node's undici pool reuses sockets the Next dev
 * server has already closed, surfacing as spurious "fetch failed".
 */
export async function serverFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readAuthConfig()?.localToken;
  if (!token) {
    throw new ActionError(
      'unsupported',
      'No local auth token found (config.json). Has the app been initialized with `start`?',
    );
  }
  const base = serverBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${base}/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Connection: 'close',
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ActionError(
      'conflict',
      `App server unreachable at ${base}. Live session state and sends require the app to be running.`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ActionError(
      'conflict',
      `${init.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

export interface LiveSignals {
  /** Chat-session ids with an in-flight turn right now. */
  runningSessionIds: string[];
  /** Chat-session ids blocked on a permission/question prompt. */
  pendingSessionIds: string[];
}

/**
 * Live running/pending sets from the server's rail endpoint. Returns null
 * when the server is unreachable — which also means nothing can be running
 * (the server process owns every harness subprocess), so callers may
 * render "unknown/offline" or treat it as idle; they should say which.
 */
export async function fetchLiveSignals(): Promise<LiveSignals | null> {
  try {
    const rail = await serverFetch<{
      runningSessionIds: string[];
      pendingSessionIds: string[];
    }>('/sessions/rail');
    return {
      runningSessionIds: rail.runningSessionIds ?? [],
      pendingSessionIds: rail.pendingSessionIds ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * The {@link WorkstreamRuntime} for orchestrator handlers (CLI and MCP). Live
 * running state and the runtime stop/notify effects are process-owned by the app
 * server, so this routes them through the authenticated HTTP control path. When
 * the server is unreachable, `runningSessionIds` reports null — meaning nothing
 * can be running — so a lifecycle change with no live agent still proceeds
 * offline, and a stop against a genuinely running agent surfaces as a conflict.
 */
export const serverWorkstreamRuntime: WorkstreamRuntime = {
  async runningSessionIds() {
    const signals = await fetchLiveSignals();
    return signals ? signals.runningSessionIds : null;
  },
  stopExecution(executionId) {
    return serverFetch<{ ok: boolean; failures: string[] }>(`/executions/${executionId}/stop-agent`, {
      method: 'POST',
    });
  },
  async notify(executionId, change: ScopeChange) {
    await serverFetch(`/executions/${executionId}/notify-scope-change`, {
      method: 'POST',
      body: JSON.stringify(change),
    });
  },
};
