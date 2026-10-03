import { readAuthConfig } from '@/lib/auth/config-file';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { hashToken } from '@/lib/auth/tokens';

/** Only the installation's own pairing credential can manage its binaries.
 * Paired device, harness and future team credentials are not installers. */
export function isInstallationOwner(request: Pick<Request, 'headers'>) {
  const header = request.headers.get('authorization');
  const cookie = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${SESSION_COOKIE_NAME}=`));
  const supplied = header?.startsWith('Bearer ') ? header.slice(7).trim() : cookie?.slice(SESSION_COOKIE_NAME.length + 1);
  const expected = readAuthConfig()?.localToken;
  return !!supplied && !!expected && hashToken(supplied) === hashToken(expected);
}
