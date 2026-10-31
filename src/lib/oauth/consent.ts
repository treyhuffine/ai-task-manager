/** What the consent page needs to know and say (`src/app/oauth/authorize`). */
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { lookupApiToken } from '@/lib/auth/api-token';
import { isSessionToken } from '@/lib/auth/session-token';
import type { AiClientKind } from '@/lib/external-ai/client-config';
import type { AuthorizeRequest } from './flow';

/** The authorization request's own parameters, carried from the page to its form. */
export const AUTHORIZE_FIELDS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'] as const;

/** Whether the browser's session cookie is a working sign-in to this personal Ri (not a worker's, a session's or an assistant's key). */
export function signedIn(cookies: { get(name: string): { value: string } | undefined }): boolean {
  const token = cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token || isSessionToken(token)) return false;
  const found = lookupApiToken(token);
  return Boolean(found && found.key.role === 'sign_in' && found.key.memberId === null);
}

const COMPANIES: Partial<Record<AiClientKind, string>> = { chatgpt: 'OpenAI', claude_desktop: 'Anthropic' };

export interface ConsentCopy {
  /** Who is asking, as the page names it. */
  name: string;
  /** "From chatgpt.com" for a client whose ID its host serves, else where it returns you. */
  origin: string;
  /** Where what it reads goes. */
  destination: string;
}

function returnsTo(redirectUri: string): string {
  const url = new URL(redirectUri);
  if (url.protocol === 'https:') return `Returns you to ${url.hostname}`;
  if (url.protocol === 'http:') return 'Returns you to an app on this computer';
  return `Returns you to the app that opens ${url.protocol.replace(/:$/, '')} links`;
}

export function consentCopy(request: AuthorizeRequest): ConsentCopy {
  const { client } = request;
  const company = COMPANIES[request.kind];
  return {
    name: client.name,
    origin: client.host ? `From ${client.host}` : returnsTo(request.redirectUri),
    destination: company ? `What ${client.name} reads is sent to ${company}.` : `What ${client.name} reads leaves your Ri.`,
  };
}
