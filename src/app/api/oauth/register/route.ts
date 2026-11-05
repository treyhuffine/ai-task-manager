/**
 * Dynamic client registration (RFC 7591). Open, as MCP clients expect, and
 * it stores nothing: the client ID is the registration (`src/lib/oauth/clients.ts`).
 */
import { registerClient, RegistrationError } from '@/lib/oauth/clients';
import { oauthPreflight, oauthResponse, teamRefusal } from '@/lib/oauth/http';

const MAX_BODY = 32 * 1024;

export async function POST(request: Request) {
  const refused = teamRefusal();
  if (refused) return refused;
  const text = await request.text();
  if (text.length > MAX_BODY) return oauthResponse({ status: 413, body: { error: 'invalid_client_metadata', error_description: 'The registration is too large.' } });
  let body: unknown;
  try { body = JSON.parse(text); }
  catch { return oauthResponse({ status: 400, body: { error: 'invalid_client_metadata', error_description: 'Send the client metadata as JSON.' } }); }
  try {
    return oauthResponse({ status: 201, body: { ...registerClient(body) } });
  } catch (error) {
    if (error instanceof RegistrationError) return oauthResponse({ status: 400, body: { error: error.code, error_description: error.message } });
    throw error;
  }
}

export const OPTIONS = oauthPreflight;
