import type { NextRequest } from 'next/server';
import { readAuthConfig } from '@/lib/auth/config-file';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { hashToken } from '@/lib/auth/tokens';

/** Only the installation's own pairing credential can manage its binaries.
 * Paired device, harness and future team credentials are not installers. */
export function isInstallationOwner(request: NextRequest) {
  const header = request.headers.get('authorization');
  const supplied = header?.startsWith('Bearer ') ? header.slice(7).trim() : request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const expected = readAuthConfig()?.localToken;
  return !!supplied && !!expected && hashToken(supplied) === hashToken(expected);
}
