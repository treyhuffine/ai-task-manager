/** Token revocation (RFC 7009): a client disconnecting itself ends its key. */
import { readForm, revokeToken } from '@/lib/oauth/flow';
import { oauthPreflight, oauthResponse, teamRefusal } from '@/lib/oauth/http';

export async function POST(request: Request) {
  const refused = teamRefusal();
  if (refused) return refused;
  let form: URLSearchParams;
  try { form = await readForm(request); }
  catch { return oauthResponse({ status: 400, body: { error: 'invalid_request', error_description: 'Send the revocation as a form.' } }); }
  return oauthResponse(revokeToken(form));
}

export const OPTIONS = oauthPreflight;
