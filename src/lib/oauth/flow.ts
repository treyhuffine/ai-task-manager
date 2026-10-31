/**
 * The authorization code flow with PKCE (OAuth 2.1, docs/mcp-oauth.md "Flow").
 *
 * A code lives five minutes in the server's memory, is used once, and is
 * bound to its client, redirect, PKCE challenge and resource. Exchanging it
 * makes an ordinary outside-assistant key (`api_keys.role = ai_client`), so
 * a connection made by signing in is listed, used and disconnected exactly
 * like one made in Settings. The key doesn't expire, like every other Ri key,
 * so there is no refresh token: Disconnect, or the client's own revocation,
 * ends it.
 */
import crypto from 'node:crypto';
import { createPersonalAiClient, findPersonalAiClientByToken, revokePersonalAiClient } from '@/lib/db/queries';
import { processState } from '@/lib/process-state';
import type { AiClientKind } from '@/lib/external-ai/client-config';
import { OAUTH_SCOPE, resourceFor } from './issuer';
import { kindFor, OAuthClientError, redirectMatches, resolveClient, secretMatches, tokenClient, type MetadataFetch, type OAuthClient } from './clients';

const CODE_TTL_MS = 5 * 60_000;
const MAX_PENDING_CODES = 1_000;
const PKCE = /^[A-Za-z0-9._~-]{43,128}$/;

/** What an owner approved, waiting for its client to exchange the code. */
export interface ApprovedGrant {
  clientId: string;
  clientName: string;
  kind: AiClientKind;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  issuer: string;
}

const pendingCodes = processState('oauth.codes', () => new Map<string, ApprovedGrant & { expiresAt: number }>());
const codeKey = (code: string) => crypto.createHash('sha256').update(code).digest('base64url');

export function issueCode(grant: ApprovedGrant, now = Date.now()): string {
  for (const [key, entry] of pendingCodes) if (entry.expiresAt <= now) pendingCodes.delete(key);
  if (pendingCodes.size >= MAX_PENDING_CODES) pendingCodes.delete(pendingCodes.keys().next().value!);
  const code = crypto.randomBytes(32).toString('base64url');
  pendingCodes.set(codeKey(code), { ...grant, expiresAt: now + CODE_TTL_MS });
  return code;
}

/** Used once: a code is gone after this, whether or not the rest of the request checks out. */
function redeemCode(code: string, now = Date.now()): ApprovedGrant | null {
  const key = codeKey(code);
  const entry = pendingCodes.get(key);
  pendingCodes.delete(key);
  return entry && entry.expiresAt > now ? entry : null;
}

/** A URL with parameters added to whatever query it already has. */
export function withParams(base: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(base);
  for (const [name, value] of Object.entries(params)) if (value != null) url.searchParams.set(name, value);
  return url.toString();
}

/** A trailing slash on the resource is the same resource. */
const sameResource = (asked: string, canonical: string) => asked.replace(/\/+$/, '') === canonical;

export interface AuthorizeRequest {
  client: OAuthClient;
  /** Which app this is, proven by its host (`kindFor`). */
  kind: AiClientKind;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string;
  issuer: string;
}

export type AuthorizeCheck =
  /** The client or its redirect can't be trusted, so the page says so and sends nothing anywhere. */
  | { kind: 'fatal'; message: string }
  /**
   * A request error for a client's own redirect. The page shows it and links
   * back instead of sending the browser there unasked: anyone can register a
   * client, so an automatic error redirect would make Ri's own address an
   * open redirector (RFC 9700 §4.11.2).
   */
  | { kind: 'redirect'; location: string; description: string }
  | { kind: 'ok'; request: AuthorizeRequest };

/**
 * Check an authorization request (RFC 6749 §4.1.1, PKCE, RFC 8707). Every
 * answer, success and error alike, carries `iss` (RFC 9207), since the
 * metadata promises it.
 */
export async function checkAuthorizeRequest(params: URLSearchParams, issuer: string, fetchImpl?: MetadataFetch): Promise<AuthorizeCheck> {
  let client: OAuthClient;
  try { client = await resolveClient(params.get('client_id'), fetchImpl); }
  catch (error) {
    if (error instanceof OAuthClientError) return { kind: 'fatal', message: error.message };
    throw error;
  }
  const asked = params.get('redirect_uri');
  const redirectUri = asked ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
  if (!redirectUri) return { kind: 'fatal', message: `${client.name} didn’t say where to return you.` };
  if (!redirectMatches(client.redirectUris, redirectUri)) return { kind: 'fatal', message: `${client.name} asked to return you somewhere it never registered.` };

  const state = params.get('state');
  const fail = (error: string, description: string): AuthorizeCheck => ({
    kind: 'redirect', description, location: withParams(redirectUri, { error, error_description: description, state, iss: issuer }),
  });
  if (params.get('response_type') !== 'code') return fail('unsupported_response_type', 'Ri answers only response_type=code.');
  const codeChallenge = params.get('code_challenge');
  if (!codeChallenge || !PKCE.test(codeChallenge)) return fail('invalid_request', 'Send a PKCE code_challenge.');
  if (params.get('code_challenge_method') !== 'S256') return fail('invalid_request', 'Ri accepts only the S256 code challenge method.');
  const resource = resourceFor(issuer);
  const askedResource = params.get('resource');
  if (askedResource && !sameResource(askedResource, resource)) return fail('invalid_target', `This Ri’s MCP server is ${resource}.`);
  return { kind: 'ok', request: { client, kind: kindFor(client, redirectUri), redirectUri, state, codeChallenge, resource, issuer } };
}

/** Where the owner's choice sends the browser: a code for its client, or its refusal. */
export function decisionRedirect(request: AuthorizeRequest, allow: boolean): string {
  if (!allow) return withParams(request.redirectUri, { error: 'access_denied', error_description: 'The owner of this Ri said no.', state: request.state, iss: request.issuer });
  const code = issueCode({
    clientId: request.client.id, clientName: request.client.name, kind: request.kind,
    redirectUri: request.redirectUri, codeChallenge: request.codeChallenge, resource: request.resource, issuer: request.issuer,
  });
  return withParams(request.redirectUri, { code, state: request.state, iss: request.issuer });
}

export interface OAuthReply {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

const oauthError = (status: number, error: string, description: string, headers?: Record<string, string>): OAuthReply =>
  ({ status, body: { error, error_description: description }, ...(headers ? { headers } : {}) });

/** RFC 6749 §2.3.1: Basic credentials, each form-encoded. */
function basicCredentials(authorization: string | null): { id: string; secret: string } | null {
  if (!authorization?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(authorization.slice(6).trim(), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  try { return { id: decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, ' ')), secret: decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, ' ')) }; }
  catch { return null; }
}

/** The client a token or revocation request authenticates as, checked against how it registered. */
function authenticateClient(form: URLSearchParams, authorization: string | null): { clientId: string } | OAuthReply {
  const basic = basicCredentials(authorization);
  const bodyId = form.get('client_id');
  if (basic && bodyId && bodyId !== basic.id) return oauthError(400, 'invalid_request', 'The client ID in the header and the body differ.');
  const clientId = basic?.id ?? bodyId;
  const secret = basic?.secret ?? form.get('client_secret');
  if (!clientId) return oauthError(401, 'invalid_client', 'Name the client.', { 'WWW-Authenticate': 'Basic realm="ri"' });
  const client = tokenClient(clientId);
  if (!client) return oauthError(401, 'invalid_client', 'Ri doesn’t know this client.', { 'WWW-Authenticate': 'Basic realm="ri"' });
  if (secret ? client.authMethod === 'none' || !secretMatches(clientId, secret) : client.authMethod !== 'none') {
    return oauthError(401, 'invalid_client', 'The client secret is missing or wrong.', { 'WWW-Authenticate': 'Basic realm="ri"' });
  }
  return { clientId };
}

/**
 * RFC 6749 §4.1.3 with PKCE. The access token is a new outside-assistant key,
 * named after the client. `issuer` is the address this request reached: a code
 * is good only where it was approved.
 */
export function exchangeToken(form: URLSearchParams, authorization: string | null, issuer: string): OAuthReply {
  const authenticated = authenticateClient(form, authorization);
  if ('status' in authenticated) return authenticated;
  if (form.get('grant_type') !== 'authorization_code') return oauthError(400, 'unsupported_grant_type', 'Ri issues tokens for authorization codes only.');
  const code = form.get('code');
  const grant = code ? redeemCode(code) : null;
  if (!grant || grant.clientId !== authenticated.clientId || grant.issuer !== issuer) return oauthError(400, 'invalid_grant', 'This code is unknown, used or expired. Connect again.');
  const redirectUri = form.get('redirect_uri');
  if (redirectUri !== null && redirectUri !== grant.redirectUri) return oauthError(400, 'invalid_grant', 'The redirect URI differs from the one the code was made for.');
  const verifier = form.get('code_verifier');
  if (!verifier || !PKCE.test(verifier) || crypto.createHash('sha256').update(verifier).digest('base64url') !== grant.codeChallenge) {
    return oauthError(400, 'invalid_grant', 'The PKCE code verifier doesn’t match.');
  }
  const resource = form.get('resource');
  if (resource && !sameResource(resource, grant.resource)) return oauthError(400, 'invalid_target', `This code is for ${grant.resource}.`);
  const { token } = createPersonalAiClient(grant.clientName, grant.kind, { description: `Connected by signing in, from ${grant.issuer}` });
  return { status: 200, body: { access_token: token.plaintext, token_type: 'Bearer', scope: OAUTH_SCOPE } };
}

/**
 * RFC 7009. Holding the token is the authority to end it, so a client that
 * forgot its registration can still disconnect. Unknown tokens succeed too.
 */
export function revokeToken(form: URLSearchParams): OAuthReply {
  const token = form.get('token');
  const key = token ? findPersonalAiClientByToken(token) : null;
  if (key) revokePersonalAiClient(key.keyId);
  return { status: 200, body: {} };
}

/** A request body as form fields. OAuth sends forms, and a few clients send JSON. */
export async function readForm(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get('content-type') ?? '';
  const text = await request.text();
  if (type.includes('application/json')) {
    const json = JSON.parse(text || '{}') as Record<string, unknown>;
    return new URLSearchParams(Object.entries(json).filter(([, v]) => typeof v === 'string') as Array<[string, string]>);
  }
  return new URLSearchParams(text);
}
