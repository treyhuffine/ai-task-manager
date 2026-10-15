import { NextRequest } from 'next/server';
import { oauthReturnRedirect } from '@/lib/integrations/oauth-return';
import { getAttempt } from '@/lib/integrations/sources/attempts';
import { completeManagedAttempt, SourceError } from '@/lib/integrations/sources/service';

/**
 * Where a managed source (Composio) sends the browser after consent (public, see src/proxy.ts).
 * The query carries the attempt id Ri put in the callback URL, plus the source's own hints
 * (`status`, `connected_account_id`). None of that is trusted: completion is verified through
 * the source against the stored attempt (its exact remote account, user, auth config and toolkit),
 * and an unknown, expired, mismatched or replayed attempt creates nothing. The browser then
 * returns to the page that started it, with `?connected=` or `?error=`.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const attemptId = url.searchParams.get('attempt') ?? '';
  const attempt = /^att_[a-f0-9]{32}$/.test(attemptId) ? getAttempt(attemptId) : null;
  const back = attempt ? { origin: attempt.origin ?? null, path: attempt.returnTo ?? '/?settings=plugins' } : null;
  if (!attempt) return oauthReturnRedirect(null, { error: 'invalid_state' });
  const hinted = url.searchParams.get('connected_account_id') ?? undefined;
  try {
    const result = await completeManagedAttempt(attemptId, { via: 'callback', ...(hinted ? { hintedAccountId: hinted } : {}) });
    if (result.status === 'completed') return oauthReturnRedirect(back, { connected: result.account, attempt: attemptId });
    // Still pending: the source redirected before the account settled. The page polls it to the end.
    if (result.status === 'pending') return oauthReturnRedirect(back, { attempt: attemptId });
    return oauthReturnRedirect(back, { error: result.status === 'expired' ? 'link_expired' : 'connect_failed', attempt: attemptId });
  } catch (error) {
    // A coarse code only: the message may carry vendor detail that shouldn't sit in browser history.
    console.error('[integrations] managed connect callback failed', error instanceof Error ? error.message : error);
    return oauthReturnRedirect(back, { error: error instanceof SourceError ? error.code : 'connect_failed', attempt: attemptId });
  }
}
