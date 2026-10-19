/**
 * Work out how a custom MCP server authenticates from its URL alone, so the
 * person adding it (Settings, Plugins, MCP servers, Add MCP server) doesn't have
 * to choose. Official catalog services keep their configured auth and never
 * come through here.
 *
 * The probe sends one unauthenticated MCP `initialize` and reads the first
 * response:
 *
 * - A normal initialize result means no sign-in.
 * - A 401 or 403 leads to OAuth discovery through the MCP SDK's own helpers,
 *   the same path sign-in takes later: the `WWW-Authenticate` challenge names
 *   the protected-resource metadata (RFC 9728), which names the authorization
 *   server, whose metadata (RFC 8414 or OpenID discovery) says whether it
 *   registers clients dynamically, accepts client ID metadata documents, or
 *   needs a client registered by hand.
 * - A 401 or 403 with no OAuth metadata anywhere most likely wants a static key.
 * - Anything else (unreachable, a redirect elsewhere, not an MCP server) is
 *   reported plainly so the person can choose by hand.
 *
 * It never sends credentials, never follows a redirect to another origin,
 * never calls a tool, and reads only the first responses and the metadata
 * documents. Every address it fetches passes the same rule as a saved server:
 * https, or http for loopback only.
 */
import { discoverAuthorizationServerMetadata, discoverOAuthProtectedResourceMetadata, extractWWWAuthenticateParams } from '@modelcontextprotocol/sdk/client/auth.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { APP_NAME } from '@/constants/app';
import { validateMcpUrl } from './mcp-validate';

export type McpAuthRegistration =
  /** RFC 7591 dynamic client registration: Ri registers itself during sign-in. */
  | 'dynamic'
  /** The server takes a client ID metadata document URL instead of registration. */
  | 'client_metadata'
  /** Neither: a client has to be registered with the provider by hand. */
  | 'registered'
  /** No readable authorization-server metadata, so sign-in finds out. */
  | 'unknown';

export type McpAuthDetection =
  | { method: 'none'; server?: { name: string; version?: string } }
  | {
    method: 'oauth';
    registration: McpAuthRegistration;
    authorizationServer: string;
    resourceMetadataUrl?: string;
    scopes?: string[];
    /** The authorization server offers PKCE S256, or doesn't say. Ri requires it. */
    pkce: boolean;
  }
  | { method: 'key'; status: number; /** A header the refusal named, such as X-API-Key. */ header?: string }
  | { method: 'unknown'; reason: 'invalid_url' | 'unreachable' | 'redirected' | 'not_mcp' | 'server_error'; message: string; status?: number };

export interface McpAuthProbeOptions {
  /** Test seam. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Budget for the initialize request. */
  timeoutMs?: number;
  /** Budget for each metadata document. */
  metadataTimeoutMs?: number;
  /** An outer cancellation, such as the request that asked. */
  signal?: AbortSignal;
}

export const MCP_PROBE_TIMEOUT_MS = 8_000;
export const MCP_PROBE_METADATA_TIMEOUT_MS = 5_000;
/** Challenge URL, path-aware and root well-known for the resource, then OAuth and OIDC for the server. */
const MAX_METADATA_REQUESTS = 8;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 64 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  result?: { protocolVersion?: unknown; serverInfo?: { name?: unknown; title?: unknown; version?: unknown } };
  error?: { code?: unknown; message?: unknown };
}

export async function detectMcpAuth(rawUrl: string, options: McpAuthProbeOptions = {}): Promise<McpAuthDetection> {
  const check = validateMcpUrl(rawUrl);
  if (!check.ok) return { method: 'unknown', reason: 'invalid_url', message: check.error };
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? MCP_PROBE_TIMEOUT_MS;
  const metadataTimeoutMs = options.metadataTimeoutMs ?? MCP_PROBE_METADATA_TIMEOUT_MS;
  const signalFor = (ms: number) => AbortSignal.any([AbortSignal.timeout(ms), ...(options.signal ? [options.signal] : [])]);

  let url = new URL(check.url);
  let response: Response;
  try {
    for (let hop = 0; ; hop++) {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
          protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: APP_NAME, version: '0' },
        } }),
        redirect: 'manual', credentials: 'omit', signal: signalFor(timeoutMs),
      });
      if (!REDIRECT_STATUSES.has(response.status)) break;
      await response.body?.cancel().catch(() => {});
      const location = response.headers.get('location');
      let next: URL | undefined;
      try { if (location) next = new URL(location, url); } catch { /* reported below */ }
      if (!next) return { method: 'unknown', reason: 'not_mcp', status: response.status, message: `The server redirected without a usable address (HTTP ${response.status}).` };
      const nextCheck = validateMcpUrl(next.href);
      if (!nextCheck.ok || next.origin !== url.origin) {
        return { method: 'unknown', reason: 'redirected', status: response.status, message: `This address redirects to ${next.origin}. Enter the address it redirects to.` };
      }
      if (hop >= MAX_REDIRECTS) return { method: 'unknown', reason: 'not_mcp', status: response.status, message: 'The address keeps redirecting.' };
      url = new URL(nextCheck.url);
    }
  } catch (error) {
    return { method: 'unknown', reason: 'unreachable', message: unreachableMessage(error, timeoutMs) };
  }

  if (response.ok) {
    const message = await readFirstMessage(response).catch(() => undefined);
    closeSession(url, response, fetchImpl, signalFor(metadataTimeoutMs));
    const result = message?.result;
    if (result && typeof result.protocolVersion === 'string') {
      const info = result.serverInfo;
      const name = [info?.title, info?.name].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
      return { method: 'none', ...(name ? { server: { name, ...(typeof info?.version === 'string' ? { version: info.version } : {}) } } : {}) };
    }
    if (message?.error) {
      const text = typeof message.error.message === 'string' ? message.error.message : 'an error';
      return { method: 'unknown', reason: 'not_mcp', status: response.status, message: `The server answered initialize with ${text}.` };
    }
    return { method: 'unknown', reason: 'not_mcp', status: response.status, message: 'This address answers, but not as an MCP server.' };
  }

  if (response.status === 401 || response.status === 403) {
    const challenge = response.headers.get('www-authenticate');
    const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(response);
    const bodyText = await readText(response, 4096).catch(() => '');
    const metadataFetch = boundedMetadataFetch(fetchImpl, () => signalFor(metadataTimeoutMs));

    let resourceMetadata: Awaited<ReturnType<typeof discoverOAuthProtectedResourceMetadata>> | undefined;
    try { resourceMetadata = await discoverOAuthProtectedResourceMetadata(url, { resourceMetadataUrl }, metadataFetch); }
    catch { /* RFC 9728 is optional. The legacy fallback treats the server as its own authorization server. */ }
    const authorizationServer = resourceMetadata?.authorization_servers?.[0] ?? new URL('/', url).href;
    let metadata: Awaited<ReturnType<typeof discoverAuthorizationServerMetadata>>;
    try { metadata = await discoverAuthorizationServerMetadata(authorizationServer, { fetchFn: metadataFetch }); }
    catch { metadata = undefined; }

    if (!resourceMetadata && !metadata) {
      const header = apiKeyHeaderHint(challenge, bodyText);
      return { method: 'key', status: response.status, ...(header ? { header } : {}) };
    }
    const scopes = scope?.split(/\s+/).filter(Boolean) ?? resourceMetadata?.scopes_supported;
    const registration: McpAuthRegistration = !metadata ? 'unknown'
      : metadata.registration_endpoint ? 'dynamic'
        : metadata.client_id_metadata_document_supported === true ? 'client_metadata'
          : 'registered';
    const methods = metadata?.code_challenge_methods_supported;
    return {
      method: 'oauth', registration, authorizationServer,
      ...(resourceMetadataUrl ? { resourceMetadataUrl: resourceMetadataUrl.href } : {}),
      ...(scopes?.length ? { scopes } : {}),
      pkce: !methods || methods.includes('S256'),
    };
  }

  await response.body?.cancel().catch(() => {});
  if (response.status >= 500) {
    return { method: 'unknown', reason: 'server_error', status: response.status, message: `The server answered with an error (HTTP ${response.status}). Try again in a moment.` };
  }
  const hint = response.status === 404 || response.status === 405 ? ' Check the path, which is often /mcp.' : '';
  return { method: 'unknown', reason: 'not_mcp', status: response.status, message: `This address doesn't answer as an MCP server (HTTP ${response.status}).${hint}` };
}

/** Metadata documents are read with GET only, from allowed addresses only, a bounded number of times. */
function boundedMetadataFetch(fetchImpl: typeof fetch, signal: () => AbortSignal): typeof fetch {
  let requests = 0;
  return async (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!validateMcpUrl(target.href).ok || requests++ >= MAX_METADATA_REQUESTS) return new Response(null, { status: 404 });
    const headers = new Headers(init?.headers);
    headers.delete('authorization');
    headers.delete('cookie');
    return fetchImpl(target, { method: 'GET', headers, redirect: 'manual', credentials: 'omit', signal: signal() });
  };
}

/** A stateful server opened a session for the probe. Let it go, without waiting on the answer. */
function closeSession(url: URL, response: Response, fetchImpl: typeof fetch, signal: AbortSignal): void {
  const sessionId = response.headers.get('mcp-session-id');
  if (!sessionId) return;
  void fetchImpl(url, { method: 'DELETE', headers: { 'Mcp-Session-Id': sessionId, 'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION },
    redirect: 'manual', credentials: 'omit', signal })
    .then(reply => reply.body?.cancel()).catch(() => {});
}

/** The first JSON-RPC message of the answer, whether JSON or the first SSE event. */
async function readFirstMessage(response: Response): Promise<JsonRpcMessage | undefined> {
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('text/event-stream')) {
    const text = await readText(response, MAX_BODY_BYTES);
    return text.trim() ? JSON.parse(text) as JsonRpcMessage : undefined;
  }
  const text = await readText(response, MAX_BODY_BYTES, (buffered) => firstEventData(buffered) !== undefined);
  const data = firstEventData(text);
  return data === undefined ? undefined : JSON.parse(data) as JsonRpcMessage;
}

/** The `data` of the first complete SSE event that carries any, or undefined before one has arrived. */
function firstEventData(buffered: string): string | undefined {
  const blocks = buffered.split(/\r?\n\r?\n/);
  // The last block may still be arriving.
  for (const block of blocks.slice(0, -1)) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, ''));
    if (data.length) return data.join('\n');
  }
  return undefined;
}

/** Read at most `cap` bytes, stopping early once `done` says the buffered text is enough. */
async function readText(response: Response, cap: number, done?: (buffered: string) => boolean): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (bytes < cap) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      text += decoder.decode(chunk.value, { stream: true });
      if (done?.(text)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

/**
 * A refusal that names a custom header, such as `Missing X-API-Key header`,
 * is a stronger hint than Bearer. Only hyphenated header-looking names count,
 * and a refusal that also mentions Bearer keeps Bearer.
 */
export function apiKeyHeaderHint(challenge: string | null, body: string): string | undefined {
  const text = `${challenge ?? ''}\n${body}`;
  if (/\bbearer\b/i.test(text)) return undefined;
  const match = /\b((?:x-[a-z0-9]+(?:-[a-z0-9]+)*)|api-(?:key|token))\b/i.exec(text);
  if (!match || !/(?:key|token)$/i.test(match[1])) return undefined;
  return match[1];
}

function unreachableMessage(error: unknown, timeoutMs: number): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return `The server didn't answer within ${Math.round(timeoutMs / 1000)} seconds.`;
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code ?? (error as { code?: string }).code ?? '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return "The host name couldn't be found.";
  if (code === 'ECONNREFUSED') return 'Nothing is listening at this address.';
  if (code === 'ECONNRESET' || code === 'EPIPE') return 'The server closed the connection.';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'The connection timed out.';
  if (/^(ERR_TLS|CERT_|DEPTH_ZERO_SELF_SIGNED|SELF_SIGNED_CERT|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ERR_SSL)/.test(code)) {
    return "The server's TLS certificate isn't trusted.";
  }
  const detail = (cause?.message ?? (error instanceof Error ? error.message : '')).replace(/[.\s]+$/, '');
  return detail ? `Couldn't reach the server: ${detail}.` : "Couldn't reach the server.";
}
