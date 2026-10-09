import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  return new Request('http://localhost:4224/api/integrations/connect', { method: 'POST', headers });
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

  it('defaults the path to the integrations pane', () => {
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
  it('runs as bundled ESM under plain Node, as required by the packaged CLI', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-oauth-return-esm-'));
    try {
      const outfile = path.join(dir, 'oauth-return.mjs');
      await build({
        entryPoints: [path.resolve(__dirname, 'oauth-return.ts')],
        outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external',
      });
      // Resolve external imports from the checkout as the production deploy
      // does. Without this link, any package import would fail indiscriminately.
      fs.symlinkSync(path.resolve(__dirname, '../../../node_modules'), path.join(dir, 'node_modules'), 'dir');
      const probe = `
        import assert from 'node:assert/strict';
        import { oauthReturnRedirect } from ${JSON.stringify(outfile)};
        const response = oauthReturnRedirect({ origin: 'https://ri.example', path: '/welcome?step=connect#done' }, { connected: 'a@b.co' });
        assert.equal(response.status, 307);
        assert.equal(response.headers.get('location'), 'https://ri.example/welcome?step=connect&connected=a%40b.co#done');
        assert.equal(await response.text(), '');
      `;
      const env = { ...process.env };
      delete env.NODE_OPTIONS;
      delete env.ELECTRON_RUN_AS_NODE;
      execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env, timeout: 10_000 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

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
