import { describe, it, expect } from 'vitest';
import {
  rewriteSetCookie,
  rewriteSetCookieList,
  isReservedCookieName,
} from './rewrite-set-cookie';

const WS = '019df8ea-15f8-7a5a-9c3e-91d4f8242745';
const PATH = `/preview/${WS}/`;

describe('rewriteSetCookie', () => {
  it('forces Path to /preview/<id>/ when upstream sent Path=/', () => {
    const out = rewriteSetCookie('foo=bar; Path=/', { workspaceId: WS });
    expect(out).toBe(`foo=bar; Path=${PATH}`);
  });

  it('forces Path even when upstream omitted it', () => {
    const out = rewriteSetCookie('foo=bar', { workspaceId: WS });
    expect(out).toBe(`foo=bar; Path=${PATH}`);
  });

  it('strips Domain attribute', () => {
    const out = rewriteSetCookie('foo=bar; Domain=example.com; Path=/', { workspaceId: WS });
    expect(out).toBe(`foo=bar; Path=${PATH}`);
    expect(out).not.toContain('Domain=');
  });

  it('preserves other attributes (HttpOnly, Secure, SameSite, Max-Age)', () => {
    const out = rewriteSetCookie(
      'foo=bar; HttpOnly; Secure; SameSite=Lax; Max-Age=3600; Path=/',
      { workspaceId: WS },
    );
    expect(out).toContain('HttpOnly');
    expect(out).toContain('Secure');
    expect(out).toContain('SameSite=Lax');
    expect(out).toContain('Max-Age=3600');
    expect(out).toContain(`Path=${PATH}`);
  });

  it('drops cookies that try to spoof the Flow session cookie', () => {
    expect(rewriteSetCookie('flow_session=stolen; Path=/', { workspaceId: WS })).toBeNull();
    expect(rewriteSetCookie('flow_session=', { workspaceId: WS })).toBeNull();
  });

  it('drops cookies that try to spoof a preview cookie', () => {
    expect(rewriteSetCookie(`flow_preview_${WS}=stolen; Path=/`, { workspaceId: WS })).toBeNull();
    expect(rewriteSetCookie('flow_preview_other-workspace=stolen', { workspaceId: WS })).toBeNull();
  });

  it('cookie names are case-sensitive — uppercase variants pass through', () => {
    // Browsers treat cookie names case-sensitively. A cookie named
    // `Flow_Session` is a different cookie from `flow_session`. We
    // don't pretend otherwise.
    const out = rewriteSetCookie('FLOW_SESSION=foo; Path=/', { workspaceId: WS });
    expect(out).toBe(`FLOW_SESSION=foo; Path=${PATH}`);
  });

  it('handles weird spacing in attributes', () => {
    const out = rewriteSetCookie('foo=bar;  Domain=evil.com  ;  Path=/admin  ', { workspaceId: WS });
    expect(out).toContain('foo=bar');
    expect(out).not.toContain('Domain=');
    expect(out).toContain(`Path=${PATH}`);
    expect(out).not.toContain('/admin');
  });

  it('does not break on cookies with `=` in the value', () => {
    const out = rewriteSetCookie('jwt=a.b.c=padding; Path=/', { workspaceId: WS });
    expect(out).toBe(`jwt=a.b.c=padding; Path=${PATH}`);
  });

  it('refuses workspaceIds with unsafe characters', () => {
    const out = rewriteSetCookie('foo=bar', { workspaceId: 'evil;crlf' });
    // We fall back to an invalid path that won't fire anywhere usable
    // rather than emit a Set-Cookie containing a stray `;`.
    expect(out).toBe('foo=bar; Path=/preview/__invalid__/');
  });

  it('rewriteSetCookieList drops nulls and rewrites the rest', () => {
    const out = rewriteSetCookieList(
      [
        'session=user1; Path=/',
        'flow_session=stolen; Path=/',
        'tracker=abc; Domain=evil.com',
      ],
      { workspaceId: WS },
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(`session=user1; Path=${PATH}`);
    expect(out[1]).toBe(`tracker=abc; Path=${PATH}`);
  });
});

describe('isReservedCookieName', () => {
  it('matches flow_session exactly', () => {
    expect(isReservedCookieName('flow_session')).toBe(true);
  });
  it('matches anything starting with flow_preview_', () => {
    expect(isReservedCookieName('flow_preview_abc')).toBe(true);
    expect(isReservedCookieName('flow_preview_')).toBe(true);
  });
  it('does not match unrelated names', () => {
    expect(isReservedCookieName('session')).toBe(false);
    expect(isReservedCookieName('flow_other')).toBe(false);
    expect(isReservedCookieName('flow')).toBe(false);
    expect(isReservedCookieName('_flow_session')).toBe(false);
  });
});
