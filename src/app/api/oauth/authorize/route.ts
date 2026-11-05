/**
 * The owner's Allow or Cancel on the consent page (`src/app/oauth/authorize`).
 * The proxy has checked the browser's sign-in cookie and that the form came
 * from this origin. The request is checked again in full here, since the
 * form's fields are only what the page was given.
 */
import { NextResponse } from 'next/server';
import { getRequestKey } from '@/lib/auth/request-key';
import { checkAuthorizeRequest, decisionRedirect } from '@/lib/oauth/flow';
import { issuerFor, OAUTH_PATHS } from '@/lib/oauth/issuer';
import { teamRefusal } from '@/lib/oauth/http';
import { AUTHORIZE_FIELDS } from '@/lib/oauth/consent';

export async function POST(request: Request) {
  const refused = teamRefusal();
  if (refused) return refused;
  if (getRequestKey(request.headers)?.scope !== 'viewer') {
    return NextResponse.json({ error: 'sign_in_required', message: 'Sign in to Ri in this browser to connect an app.' }, { status: 403 });
  }
  const form = new URLSearchParams(await request.text());
  const params = new URLSearchParams();
  for (const field of AUTHORIZE_FIELDS) {
    const value = form.get(field);
    if (value !== null) params.set(field, value);
  }
  const issuer = issuerFor(request.headers, request.url);
  const check = await checkAuthorizeRequest(params, issuer);
  // A request that no longer checks out goes back to the page, which says why.
  if (check.kind === 'fatal') return NextResponse.redirect(`${issuer}${OAUTH_PATHS.authorize}?${params}`, 303);
  if (check.kind === 'redirect') return NextResponse.redirect(check.location, 303);
  return NextResponse.redirect(decisionRedirect(check.request, form.get('decision') === 'allow'), 303);
}
