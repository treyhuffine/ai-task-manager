import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the api-key validator BEFORE importing the module under test.
// hashToken just needs to be deterministic; findApiKeyByHash decides
// whether the Flow session cookie / Bearer token is considered valid.
vi.mock('@/lib/auth/tokens', () => ({
  hashToken: (t: string) => `hash:${t}`,
}));

const findApiKeyByHash = vi.fn();
vi.mock('@/lib/db/queries', () => ({
  findApiKeyByHash: (hash: string) => findApiKeyByHash(hash),
}));

import { checkPreviewAuth, previewCookieName, PREVIEW_QUERY_TOKEN } from './auth';

const WS = '019df8ea-15f8-7a5a-9c3e-91d4f8242745';
const VALID_PREVIEW_TOKEN = 'preview-token-valid';
const VALID_FLOW_TOKEN = 'flow_live_valid';

function makeRequest(url: string, init: { headers?: Record<string, string>; cookies?: Record<string, string> } = {}): NextRequest {
  const headers = new Headers(init.headers ?? {});
  if (init.cookies) {
    const cookieHeader = Object.entries(init.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    headers.set('cookie', cookieHeader);
  }
  return new NextRequest(url, { headers });
}

describe('checkPreviewAuth', () => {
  beforeEach(() => {
    findApiKeyByHash.mockReset();
  });

  const isPreviewTokenValid = (t: string) => t === VALID_PREVIEW_TOKEN;

  describe('preview cookie path', () => {
    it('accepts a valid preview cookie', () => {
      const req = makeRequest('http://flow.local/preview/' + WS + '/', {
        cookies: { [previewCookieName(WS)]: VALID_PREVIEW_TOKEN },
      });
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      expect(r).toEqual({ ok: true, via: 'preview_cookie' });
    });

    it('rejects an invalid preview cookie and falls through', () => {
      const req = makeRequest('http://flow.local/preview/' + WS + '/', {
        cookies: { [previewCookieName(WS)]: 'wrong-value' },
      });
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      // No other auth supplied → fail.
      expect(r.ok).toBe(false);
    });

    it('uses a different workspace cookie does not authenticate', () => {
      const otherWs = '019df8ea-aaaa-bbbb-cccc-aaaaaaaaaaaa';
      const req = makeRequest('http://flow.local/preview/' + WS + '/', {
        cookies: { [previewCookieName(otherWs)]: VALID_PREVIEW_TOKEN },
      });
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      expect(r.ok).toBe(false);
    });
  });

  describe('query token path', () => {
    it('accepts a valid _pt query param', () => {
      const req = makeRequest(
        `http://flow.local/preview/${WS}/?${PREVIEW_QUERY_TOKEN}=${VALID_PREVIEW_TOKEN}`,
      );
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      expect(r).toEqual({ ok: true, via: 'preview_query' });
    });

    it('rejects an invalid _pt query param', () => {
      const req = makeRequest(`http://flow.local/preview/${WS}/?${PREVIEW_QUERY_TOKEN}=nope`);
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      expect(r.ok).toBe(false);
    });
  });

  describe('Flow session fallback', () => {
    it('accepts a valid Bearer token', () => {
      findApiKeyByHash.mockReturnValue({ revoked_at: null, expires_at: null });
      const req = makeRequest('http://flow.local/preview/' + WS + '/', {
        headers: { authorization: `Bearer ${VALID_FLOW_TOKEN}` },
      });
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      expect(r).toEqual({ ok: true, via: 'session' });
      expect(findApiKeyByHash).toHaveBeenCalledWith(`hash:${VALID_FLOW_TOKEN}`);
    });

    it('accepts a valid flow_session cookie', () => {
      findApiKeyByHash.mockReturnValue({ revoked_at: null, expires_at: null });
      const req = makeRequest('http://flow.local/preview/' + WS + '/', {
        cookies: { flow_session: VALID_FLOW_TOKEN },
      });
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      expect(r).toEqual({ ok: true, via: 'session' });
    });

    it('rejects revoked tokens', () => {
      findApiKeyByHash.mockReturnValue({ revoked_at: '2025-01-01', expires_at: null });
      const req = makeRequest('http://flow.local/preview/' + WS + '/', {
        headers: { authorization: `Bearer ${VALID_FLOW_TOKEN}` },
      });
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      expect(r).toEqual({ ok: false, reason: 'invalid' });
    });

    it('rejects expired tokens', () => {
      findApiKeyByHash.mockReturnValue({
        revoked_at: null,
        expires_at: '2020-01-01T00:00:00Z',
      });
      const req = makeRequest('http://flow.local/preview/' + WS + '/', {
        headers: { authorization: `Bearer ${VALID_FLOW_TOKEN}` },
      });
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      expect(r).toEqual({ ok: false, reason: 'invalid' });
    });

    it('rejects tokens with no matching api_key row', () => {
      findApiKeyByHash.mockReturnValue(null);
      const req = makeRequest('http://flow.local/preview/' + WS + '/', {
        headers: { authorization: `Bearer ${VALID_FLOW_TOKEN}` },
      });
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      expect(r).toEqual({ ok: false, reason: 'invalid' });
    });

    it('treats Bearer as winning over flow_session', () => {
      findApiKeyByHash.mockImplementation((hash) =>
        hash === `hash:${VALID_FLOW_TOKEN}` ? { revoked_at: null, expires_at: null } : null,
      );
      const req = makeRequest('http://flow.local/preview/' + WS + '/', {
        headers: { authorization: `Bearer ${VALID_FLOW_TOKEN}` },
        cookies: { flow_session: 'this-would-fail' },
      });
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      expect(r).toEqual({ ok: true, via: 'session' });
      expect(findApiKeyByHash).toHaveBeenCalledTimes(1);
    });
  });

  describe('no credentials', () => {
    it('rejects requests with no auth at all', () => {
      const req = makeRequest('http://flow.local/preview/' + WS + '/');
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      expect(r).toEqual({ ok: false, reason: 'no_credentials' });
      expect(findApiKeyByHash).not.toHaveBeenCalled();
    });

    it('rejects an empty Authorization header', () => {
      const req = makeRequest('http://flow.local/preview/' + WS + '/', {
        headers: { authorization: 'Bearer ' },
      });
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      expect(r).toEqual({ ok: false, reason: 'no_credentials' });
    });
  });

  describe('precedence', () => {
    it('preview cookie wins over Flow session', () => {
      findApiKeyByHash.mockReturnValue({ revoked_at: null, expires_at: null });
      const req = makeRequest('http://flow.local/preview/' + WS + '/', {
        cookies: {
          [previewCookieName(WS)]: VALID_PREVIEW_TOKEN,
          flow_session: VALID_FLOW_TOKEN,
        },
      });
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      expect(r).toEqual({ ok: true, via: 'preview_cookie' });
      expect(findApiKeyByHash).not.toHaveBeenCalled();
    });

    it('preview cookie wins over _pt query', () => {
      const req = makeRequest(
        `http://flow.local/preview/${WS}/?${PREVIEW_QUERY_TOKEN}=${VALID_PREVIEW_TOKEN}`,
        { cookies: { [previewCookieName(WS)]: VALID_PREVIEW_TOKEN } },
      );
      const r = checkPreviewAuth(req, WS, isPreviewTokenValid);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.via).toBe('preview_cookie');
    });
  });
});
