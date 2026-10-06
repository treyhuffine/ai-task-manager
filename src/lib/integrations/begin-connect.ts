/**
 * Start an OAuth connect: the shared core of /api/integrations/connect (Settings, the /connect page)
 * and the Connect card in chat. Returns the provider's authorization URL for the client to open.
 *
 * `onCompleted` runs once the new connection is saved, on either return path: the web callback
 * (which calls `runAuthCompleted` with the OAuth `state`) or the desktop flow. It's how a Connect
 * card learns its sign-in finished. Hooks live in memory with a TTL, like the OAuth return records:
 * a sign-in that spans a server restart still connects, the card just needs one more click, which
 * then finds the account connected.
 */
import type { Connection } from '@integrations/engine';
import { desktopOAuth, desktopRelayFor, isDesktopRequest, type DesktopOAuthFlow } from './desktop-oauth';
import { rememberOAuthReturn } from './oauth-return';
import { getIntegrationRuntime } from './runtime';

export interface BeginConnectOptions {
  providerId: string;
  scopes?: string[];
  label?: string;
  existingConnectionId?: string;
  authConfigId?: string;
  /** Same-origin path to land on afterwards (see oauth-return.ts). */
  returnTo?: string | null;
  onCompleted?: (connection: Connection) => Promise<void>;
}

export interface BeginConnectResult {
  requestId: string;
  authorizationUrl: string;
  desktopFlowId?: string;
}

const HOOK_TTL_MS = 30 * 60_000;

interface HookState {
  hooks: Map<string, { run: (connection: Connection) => Promise<void>; expires: number }>;
}
const STATE_KEY = Symbol.for('@ri/integration-auth-completed-hooks');
const globalRef = globalThis as unknown as { [STATE_KEY]?: HookState };
if (!globalRef[STATE_KEY]) globalRef[STATE_KEY] = { hooks: new Map() };
const hooks = globalRef[STATE_KEY]!.hooks;

/** Run (once) whatever a connect start asked to happen when its sign-in completes. */
export async function runAuthCompleted(requestId: string | null, connection: Connection): Promise<void> {
  if (!requestId) return;
  const hook = hooks.get(requestId);
  hooks.delete(requestId);
  if (!hook || hook.expires < Date.now()) return;
  try {
    await hook.run(connection);
  } catch (err) {
    console.error(`[integrations] after-connect step failed:`, err);
  }
}

export async function beginConnect(request: Pick<Request, 'headers' | 'url'>, opts: BeginConnectOptions): Promise<BeginConnectResult> {
  const now = Date.now();
  for (const [id, h] of hooks) if (h.expires < now) hooks.delete(id);

  let desktopFlow: DesktopOAuthFlow | undefined;
  try {
    const runtime = await getIntegrationRuntime();
    if (isDesktopRequest(request)) {
      const provider = runtime.getProviders().find((p) => p.id === opts.providerId);
      if (!provider?.auth.oauth) throw new Error('This provider does not support OAuth sign-in');
      desktopFlow = await desktopOAuth().begin(`integration:${opts.providerId}`, {
        returnTo: opts.returnTo ?? null,
        relayUrl: desktopRelayFor(opts.providerId, provider.auth.oauth.usePkce ?? false),
      });
    }
    const result = await runtime.beginAuth(opts.providerId, {
      callbackChannel: desktopFlow ? 'desktop' : 'web',
      ...(desktopFlow ? { redirectUri: desktopFlow.redirectUri } : {}),
      scopes: opts.scopes,
      label: opts.label,
      existingConnectionId: opts.existingConnectionId,
      // Connect through a SPECIFIC auth client (BYO work/personal); else §4a default resolves.
      authConfigId: opts.authConfigId,
    });
    if (opts.onCompleted) hooks.set(result.requestId, { run: opts.onCompleted, expires: now + HOOK_TTL_MS });
    desktopFlow?.arm(result.requestId, async (params) => {
      const metadata = Object.fromEntries([...params].filter(([key]) => !['code', 'state', 'error'].includes(key)));
      const connection = await runtime.completeAuth({ code: params.get('code')!, state: params.get('state')!, params: metadata, expectedChannel: 'desktop' });
      await runAuthCompleted(result.requestId, connection);
    });
    // The callback returns the browser to this page's origin (see oauth-return.ts).
    if (!desktopFlow) rememberOAuthReturn(result.requestId, request, opts.returnTo ?? null);
    return { ...result, ...(desktopFlow ? { desktopFlowId: desktopFlow.id } : {}) };
  } catch (e) {
    desktopFlow?.cancel();
    throw e;
  }
}
