/** The token endpoint (RFC 6749 §3.2): an approved code becomes an outside-assistant key. */
import { exchangeToken, readForm } from '@/lib/oauth/flow';
import { issuerFor } from '@/lib/oauth/issuer';
import { oauthPreflight, oauthResponse, teamRefusal } from '@/lib/oauth/http';

export async function POST(request: Request) {
  const refused = teamRefusal();
  if (refused) return refused;
  let form: URLSearchParams;
  try { form = await readForm(request); }
  catch { return oauthResponse({ status: 400, body: { error: 'invalid_request', error_description: 'Send the token request as a form.' } }); }
  return oauthResponse(exchangeToken(form, request.headers.get('authorization'), issuerFor(request.headers, request.url)));
}

export const OPTIONS = oauthPreflight;
