/**
 * Browser session cookie.
 *
 * We send the *same* API token over two transports: the `Authorization`
 * header (explicit, used by CLIs and in-app `fetch`) and this httpOnly
 * cookie (implicit, used by the browser for `<img>`, `<audio>`,
 * `EventSource`, and anywhere the caller can't set headers). The middleware
 * accepts either — see `src/middleware.ts`. Cookies are set only after the
 * token has already been validated once via the Bearer-header path, so this
 * is purely a transport choice, not a new trust boundary.
 */
import { APP_SHORT_ID } from '@/constants/app';

export const SESSION_COOKIE_NAME = `${APP_SHORT_ID}_session`;

/** One year. Lifetime is bounded by the underlying API key; when the key
 *  is revoked, the cookie stops working immediately because the middleware
 *  re-checks `findApiKeyByHash` on every request. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface SessionCookieAttributes {
  name: string;
  value: string;
  httpOnly: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
  /** Only set `secure` when we're actually on HTTPS. Local dev is plain http
   *  on localhost, and `secure` cookies are dropped there. */
  secure?: boolean;
}

export function buildSessionCookie(token: string, secure: boolean): SessionCookieAttributes {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    secure,
  };
}

export function buildExpiredSessionCookie(secure: boolean): SessionCookieAttributes {
  return {
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure,
  };
}
