/**
 * Who is asking to connect (docs/mcp-oauth.md, "Clients"). Two ways for a
 * client to say, and neither needs a person to make an app first:
 *
 *   - A client ID metadata document: the client ID is an HTTPS URL its owner
 *     serves, such as ChatGPT's `https://chatgpt.com/oauth/client.json`. Its
 *     host is who it is, so the consent page can name it with confidence.
 *   - Dynamic registration (RFC 7591): the client posts its redirect URIs and
 *     name and gets an ID back. The ID is that registration itself, encoded,
 *     so registering stores nothing and anyone on the internet calling the
 *     open endpoint can't fill the Home's disk. A confidential client's secret
 *     is an HMAC of its ID under the Home's local token.
 */
import crypto from 'node:crypto';
import dns from 'node:dns';
import https from 'node:https';
import { APP_SHORT_ID } from '@/constants/app';
import { readAuthConfig } from '@/lib/auth/config-file';
import type { AiClientKind } from '@/lib/external-ai/client-config';
import { processState } from '@/lib/process-state';

export type ClientAuthMethod = 'none' | 'client_secret_basic' | 'client_secret_post';
const AUTH_METHODS: readonly ClientAuthMethod[] = ['none', 'client_secret_basic', 'client_secret_post'];

export interface OAuthClient {
  id: string;
  /** What to call it, on the consent page and on its key. */
  name: string;
  redirectUris: string[];
  /** `metadata`: its ID is a URL its owner serves. `registered`: it named itself. */
  source: 'metadata' | 'registered';
  /** The host its ID is served from. Null for a registered client, whose redirect says where it goes. */
  host: string | null;
  authMethod: ClientAuthMethod;
}

/** A client the authorization page names instead of redirecting to (RFC 6749 §4.1.2.1). */
export class OAuthClientError extends Error {}

const NAME_MAX = 80;
const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 2000;
const REGISTERED_PREFIX = `${APP_SHORT_ID}_oauth_`;

/** Schemes a redirect may never use, whatever an app registers. */
const UNSAFE_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'about:', 'blob:', 'filesystem:']);

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * A redirect a client may register: HTTPS, plain HTTP only back to this
 * computer (a CLI's local listener, RFC 8252 §7.3), or an app's own scheme
 * (`cursor://`, RFC 8252 §7.1). Never with a fragment.
 */
export function isAllowedRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > MAX_URI_LENGTH) return false;
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.hash || raw.includes('#')) return false;
  if (url.protocol === 'https:') return Boolean(url.hostname);
  if (url.protocol === 'http:') return isLoopbackHost(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !UNSAFE_SCHEMES.has(url.protocol);
}

/**
 * Whether a redirect the client asked for is one it registered. Exact,
 * except that a loopback IP listener may pick its port at run time
 * (RFC 8252 §7.3).
 */
export function redirectMatches(registered: readonly string[], asked: string): boolean {
  if (registered.includes(asked)) return true;
  let url: URL;
  try { url = new URL(asked); } catch { return false; }
  if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]')) return false;
  const portless = (value: URL) => `${value.protocol}//${value.hostname}${value.pathname}${value.search}`;
  return registered.some(entry => {
    try { return portless(new URL(entry)) === portless(url); } catch { return false; }
  });
}

/** A display name with nothing a page could mistake for markup or layout. */
function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, NAME_MAX) : null;
}

const KNOWN_HOSTS: ReadonlyArray<[RegExp, AiClientKind]> = [
  [/(^|\.)(chatgpt|openai)\.com$/, 'chatgpt'],
  [/(^|\.)claude\.(ai|com)$/, 'claude_desktop'],
];

/** The Connect your agent item for a host that proved it's a known app. */
export function clientKindFor(host: string | null): AiClientKind {
  for (const [pattern, kind] of KNOWN_HOSTS) if (host && pattern.test(host)) return kind;
  return 'other';
}

function hostOf(raw: string): string | null {
  try { return new URL(raw).protocol === 'https:' ? new URL(raw).hostname || null : null; } catch { return null; }
}

/**
 * Which app a request really is, for its logo, its company and the item its
 * key is filed under: a document client by the host that serves its ID, a
 * registered one by the host its code goes back to. Never by the name it
 * gives, which anyone can choose.
 */
export function kindFor(client: Pick<OAuthClient, 'host'>, redirectUri: string): AiClientKind {
  return clientKindFor(client.host ?? hostOf(redirectUri));
}

// ─── Dynamic registration ─────────────────────────────────────

interface Registration { v: 1; r: string[]; n: string | null; a: ClientAuthMethod }

function homeSecret(): string {
  const token = readAuthConfig()?.localToken;
  if (!token) throw new Error('This Ri has no local token yet. Restart it, then connect again.');
  return token;
}

/** A registered confidential client's secret, recomputed rather than stored. */
export function registeredClientSecret(clientId: string, secret: string = homeSecret()): string {
  return crypto.createHmac('sha256', secret).update(`${APP_SHORT_ID}-oauth-client:${clientId}`).digest('base64url');
}

export function secretMatches(clientId: string, given: string, secret?: string): boolean {
  const expected = Buffer.from(registeredClientSecret(clientId, secret));
  const actual = Buffer.from(given);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export class RegistrationError extends Error {
  constructor(readonly code: 'invalid_redirect_uri' | 'invalid_client_metadata', message: string) { super(message); }
}

/** RFC 7591 §3.2.1 response, with the secret when the client authenticates with one. */
export interface RegisteredClient {
  client_id: string;
  client_id_issued_at: number;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: ClientAuthMethod;
  client_secret?: string;
  client_secret_expires_at?: number;
}

export function registerClient(body: unknown, secret?: string): RegisteredClient {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RegistrationError('invalid_client_metadata', 'Send the client metadata as a JSON object.');
  const input = body as Record<string, unknown>;
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    throw new RegistrationError('invalid_redirect_uri', `Register between 1 and ${MAX_REDIRECT_URIS} redirect URIs.`);
  }
  const bad = uris.find(uri => !isAllowedRedirectUri(uri));
  if (bad !== undefined) throw new RegistrationError('invalid_redirect_uri', `This redirect URI can’t be used: ${String(bad).slice(0, 200)}. Use HTTPS, plain HTTP to this computer, or an app’s own scheme.`);
  // RFC 7591 §2: an omitted method means client_secret_basic.
  const method = input.token_endpoint_auth_method ?? 'client_secret_basic';
  if (!AUTH_METHODS.includes(method as ClientAuthMethod)) {
    throw new RegistrationError('invalid_client_metadata', `Ri supports ${AUTH_METHODS.join(', ')} at its token endpoint.`);
  }
  if (input.grant_types !== undefined && !(Array.isArray(input.grant_types) && input.grant_types.includes('authorization_code'))) {
    throw new RegistrationError('invalid_client_metadata', 'Ri issues tokens through the authorization_code grant.');
  }
  if (input.response_types !== undefined && !(Array.isArray(input.response_types) && input.response_types.includes('code'))) {
    throw new RegistrationError('invalid_client_metadata', 'Ri answers the code response type.');
  }
  const name = cleanName(input.client_name);
  const registration: Registration = { v: 1, r: uris as string[], n: name, a: method as ClientAuthMethod };
  const clientId = `${REGISTERED_PREFIX}${Buffer.from(JSON.stringify(registration)).toString('base64url')}`;
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(name ? { client_name: name } : {}),
    redirect_uris: registration.r,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: registration.a,
    ...(registration.a === 'none' ? {} : { client_secret: registeredClientSecret(clientId, secret), client_secret_expires_at: 0 }),
  };
}

function decodeRegistered(clientId: string): OAuthClient | null {
  if (!clientId.startsWith(REGISTERED_PREFIX) || clientId.length > 8_000) return null;
  let parsed: Registration;
  try { parsed = JSON.parse(Buffer.from(clientId.slice(REGISTERED_PREFIX.length), 'base64url').toString('utf8')) as Registration; }
  catch { return null; }
  if (parsed?.v !== 1 || !Array.isArray(parsed.r) || !parsed.r.length || !parsed.r.every(isAllowedRedirectUri) || !AUTH_METHODS.includes(parsed.a)) return null;
  const name = cleanName(parsed.n) ?? hostOf(parsed.r[0]) ?? 'An MCP client';
  return { id: clientId, name, redirectUris: parsed.r, source: 'registered', host: null, authMethod: parsed.a };
}

// ─── Client ID metadata documents ─────────────────────────────

const METADATA_MAX_BYTES = 64 * 1024;
const METADATA_TIMEOUT_MS = 5_000;
const METADATA_TTL_MS = 10 * 60_000;
const METADATA_CACHE_MAX = 100;

/** A literal address or name for this computer or its network. A metadata document is always public. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || (!host.includes('.') && !host.includes(':'))) return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  return host.includes(':') && (host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:'));
}

/** A client ID that names its own metadata document (draft-ietf-oauth-client-id-metadata-document). */
export function isMetadataClientId(clientId: string): boolean {
  if (!clientId.startsWith('https://') || clientId.length > MAX_URI_LENGTH) return false;
  try {
    const url = new URL(clientId);
    return url.pathname !== '/' && !url.hash && !url.username && !url.password && !isPrivateHost(url.hostname);
  } catch { return false; }
}

const metadataCache = processState('oauth.client-metadata', () => new Map<string, { client: OAuthClient; expiresAt: number }>());

/** A GET of a metadata document: its status and up to `METADATA_MAX_BYTES` of its body. */
export type MetadataFetch = (url: string) => Promise<{ status: number; body: string }>;

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/**
 * DNS for a metadata fetch, refusing an answer on this computer or its
 * network. It runs where the socket connects, so a public name that resolves
 * (or rebinds) to a private address is refused too, not only a literal one.
 */
type Lookup = (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => void;

export function publicLookup(resolve: Lookup = dns.lookup as unknown as Lookup): Lookup {
  return (hostname, options, callback) => {
    resolve(hostname, options, (error, address, family) => {
      if (error) return callback(error, address, family);
      const addresses = Array.isArray(address) ? address.map(entry => entry.address) : [address];
      if (addresses.some(isPrivateHost)) return callback(Object.assign(new Error(`${hostname} is on a private network`), { code: 'EPRIVATE' }), address, family);
      callback(null, address, family);
    });
  };
}

/** The real fetch: HTTPS to a public address only, no redirects, 5 seconds, 64 KiB. */
const publicFetch: MetadataFetch = (url) => new Promise((resolve, reject) => {
  const request = https.get(url, { headers: { accept: 'application/json' }, timeout: METADATA_TIMEOUT_MS, lookup: publicLookup() as unknown as typeof dns.lookup }, response => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > METADATA_MAX_BYTES) { request.destroy(new OAuthClientError('Its client metadata document is too large.')); return; }
      chunks.push(chunk);
    });
    response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    response.on('error', reject);
  });
  request.on('timeout', () => request.destroy(new Error('timed out')));
  request.on('error', reject);
});

/** Test seam: a stand-in for the network, so tests never reach it. */
let metadataFetchOverride: MetadataFetch | null = null;
export function setMetadataFetchForTests(fetchImpl: MetadataFetch | null): void {
  metadataFetchOverride = fetchImpl;
  metadataCache.clear();
}

async function fetchMetadataClient(clientId: string, fetchImpl: MetadataFetch): Promise<OAuthClient> {
  let response: { status: number; body: string };
  try { response = await fetchImpl(clientId); }
  catch (error) {
    if (error instanceof OAuthClientError) throw error;
    throw new OAuthClientError(`Ri couldn’t read this app’s details at ${clientId}.`);
  }
  if (response.status < 200 || response.status > 299) throw new OAuthClientError(`This app’s details at ${clientId} answered ${response.status}.`);
  if (Buffer.byteLength(response.body) > METADATA_MAX_BYTES) throw new OAuthClientError('Its client metadata document is too large.');
  let doc: Record<string, unknown>;
  try { doc = JSON.parse(response.body) as Record<string, unknown>; }
  catch { throw new OAuthClientError(`This app’s details at ${clientId} aren’t JSON.`); }
  if (!doc || typeof doc !== 'object' || doc.client_id !== clientId) throw new OAuthClientError('This app’s details name a different client.');
  const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter(isAllowedRedirectUri) : [];
  if (!uris.length) throw new OAuthClientError('This app’s details list no redirect Ri can use.');
  // Ri has no keys to check a signed assertion, so a document client is a public one.
  const methods = Array.isArray(doc.token_endpoint_auth_methods_supported) ? doc.token_endpoint_auth_methods_supported : [doc.token_endpoint_auth_method ?? 'none'];
  if (!methods.includes('none')) throw new OAuthClientError('This app signs in only with a method Ri does not support.');
  const host = new URL(clientId).hostname;
  const name = cleanName(doc.client_name) ?? host;
  return { id: clientId, name, redirectUris: uris, source: 'metadata', host, authMethod: 'none' };
}

/**
 * The client an ID names. A metadata document is fetched (and kept ten
 * minutes), so call this only for a signed-in owner: otherwise anyone could
 * make the Home fetch URLs for them.
 */
export async function resolveClient(clientId: string | null, fetchImpl?: MetadataFetch): Promise<OAuthClient> {
  if (!clientId) throw new OAuthClientError('The request names no client.');
  const registered = decodeRegistered(clientId);
  if (registered) return registered;
  if (!isMetadataClientId(clientId)) throw new OAuthClientError('Ri doesn’t know this client. It should register first, or use an HTTPS client ID that serves its details.');
  const cached = metadataCache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) return cached.client;
  const client = await fetchMetadataClient(clientId, fetchImpl ?? metadataFetchOverride ?? publicFetch);
  if (metadataCache.size >= METADATA_CACHE_MAX) metadataCache.delete(metadataCache.keys().next().value!);
  metadataCache.set(clientId, { client, expiresAt: Date.now() + METADATA_TTL_MS });
  return client;
}

/** What to call a client before anyone has signed in, from its ID alone: nothing is fetched. */
export function clientLabel(clientId: string | null): string | null {
  if (!clientId) return null;
  const registered = decodeRegistered(clientId);
  if (registered) return registered.name;
  return isMetadataClientId(clientId) ? new URL(clientId).hostname : null;
}

/**
 * The client a token request names, without fetching anything: a document
 * client already proved itself at authorization, and the code is bound to it.
 */
export function tokenClient(clientId: string): Pick<OAuthClient, 'id' | 'authMethod'> | null {
  const registered = decodeRegistered(clientId);
  if (registered) return registered;
  return isMetadataClientId(clientId) ? { id: clientId, authMethod: 'none' } : null;
}
