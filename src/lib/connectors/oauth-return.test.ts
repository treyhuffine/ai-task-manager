import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OAUTH_RETURN_PATH,
  oauthReturnRedirect,
  pageOrigin,
  rememberOAuthReturn,
  safeReturnPath,
  takeOAuthReturn,
} from './oauth-return';

function browserPost(origin: string | null, site: string | null = 'same-origin'): Request {
  const headers = new Headers();
  if (origin) headers.set('origin', origin);
  if (site) headers.set('sec-fetch-site', site);
  // The URL Next hands a route is always loopback, whatever the browser used.
  return new Request('http://localhost:4224/api/connectors/connect', { method: 'POST', headers });
}

describe('pageOrigin', () => {
  it('trusts the Origin of a same-origin browser call', () => {
    expect(pageOrigin(browserPost('https://ri-trey.beamd.run'))).toBe('https://ri-trey.beamd.run');
  });

  it('ignores cross-site and unlabeled calls', () => {
    expect(pageOrigin(browserPost('https://evil.example', 'cross-site'))).toBeNull();
    expect(pageOrigin(browserPost('https://ri-trey.beamd.run', null))).toBeNull();
    expect(pageOrigin(browserPost(null))).toBeNull();
  });

  it('ignores non-http origins', () => {
    expect(pageOrigin(browserPost('null'))).toBeNull();
    expect(pageOrigin(browserPost('file:///tmp'))).toBeNull();
  });
});

describe('safeReturnPath', () => {
  it('keeps in-app paths and drops everything else', () => {
    expect(safeReturnPath('/welcome?step=connect')).toBe('/welcome?step=connect');
    expect(safeReturnPath('//evil.example/x')).toBeNull();
    expect(safeReturnPath('https://evil.example')).toBeNull();
    expect(safeReturnPath(42)).toBeNull();
  });

  it('judges the path a browser will resolve, not the raw string', () => {
    // Dot segments normalize to a protocol-relative `//evil.example/landing`.
    expect(safeReturnPath('/a/..//evil.example/landing')).toBeNull();
    expect(safeReturnPath('/a/%2e%2e//evil.example/landing')).toBeNull();
    // A browser reads a backslash as a slash, so this is `//evil.example`.
    expect(safeReturnPath('/\\evil.example/x')).toBeNull();
  });

  it('returns the normalized path', () => {
    expect(safeReturnPath('/a/../welcome?step=connect#top')).toBe('/welcome?step=connect#top');
    // Encoded slashes stay a path segment on this origin.
    expect(safeReturnPath('/%2F%2Fevil.example')).toBe('/%2F%2Fevil.example');
  });
});

describe('remember / take', () => {
  it('returns the recorded origin and path once', () => {
    rememberOAuthReturn('state-1', browserPost('https://ri-trey.beamd.run'), '/welcome');
    expect(takeOAuthReturn('state-1')).toEqual({ origin: 'https://ri-trey.beamd.run', path: '/welcome' });
    expect(takeOAuthReturn('state-1')).toBeNull();
  });

  it('defaults the path to the connectors pane', () => {
    rememberOAuthReturn('state-2', browserPost('http://localhost:42241'), '//evil.example');
    expect(takeOAuthReturn('state-2')).toEqual({ origin: 'http://localhost:42241', path: DEFAULT_OAUTH_RETURN_PATH });
  });

  it('forgets a return once the sign-in has expired', () => {
    const start = 1_000_000;
    rememberOAuthReturn('state-3', browserPost('https://ri-trey.beamd.run'), null, start);
    expect(takeOAuthReturn('state-3', start + 11 * 60_000)).toBeNull();
  });

  it('knows nothing about a missing or unknown state', () => {
    expect(takeOAuthReturn(null)).toBeNull();
    expect(takeOAuthReturn('never-recorded')).toBeNull();
  });
});

describe('oauthReturnRedirect', () => {
  it('lands on the recorded origin, not the loopback address Next reports', () => {
    const res = oauthReturnRedirect({ origin: 'https://ri-trey.beamd.run', path: DEFAULT_OAUTH_RETURN_PATH }, { connected: 'a@b.co' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://ri-trey.beamd.run/?settings=plugins&connected=a%40b.co');
  });

  it('keeps the query of a returnTo path', () => {
    const res = oauthReturnRedirect({ origin: 'http://localhost:42241', path: '/welcome?step=connect' }, { error: 'access_denied' });
    expect(res.headers.get('location')).toBe('http://localhost:42241/welcome?step=connect&error=access_denied');
  });

  it('answers relative when nothing was recorded, so the browser stays on its origin', () => {
    const res = oauthReturnRedirect(null, { error: 'missing_code_or_state' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/?settings=plugins&error=missing_code_or_state');
  });

  it('never leaves the app, even for a path that skipped safeReturnPath', () => {
    for (const path of ['/a/..//evil.example/landing', '/\\evil.example/x', '//evil.example']) {
      const abs = oauthReturnRedirect({ origin: 'https://ri-trey.beamd.run', path }, { connected: 'a@b.co' });
      expect(new URL(abs.headers.get('location')!).origin).toBe('https://ri-trey.beamd.run');
      const rel = oauthReturnRedirect({ origin: null, path }, { connected: 'a@b.co' });
      expect(rel.headers.get('location')).toBe('/?settings=plugins&connected=a%40b.co');
    }
  });

  it('answers relative for a recorded path with no trusted origin', () => {
    const res = oauthReturnRedirect({ origin: null, path: '/welcome' }, { connected: 'x' });
    expect(res.headers.get('location')).toBe('/welcome?connected=x');
  });
});
