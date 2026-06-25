/**
 * Request-signing strategies: oauth1 (RFC 5849), aws_sigv4 (AWS test-suite vector),
 * jwt (self-verified). Each builds an `AuthApplyContext` and asserts the produced header.
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { oauth1 } from '../auth/oauth1';
import { awsSigV4 } from '../auth/aws-sigv4';
import { jwt } from '../auth/jwt';
import type { AuthApplyContext, Credentials } from '../core/types';

function ctx(method: string, url: string, body?: string): AuthApplyContext & { headers: Record<string, string> } {
  return {
    method,
    url,
    headers: {},
    ...(body !== undefined ? { body } : {}),
    addQueryParam() {},
    setBodyField() {},
    setUrl() {},
  };
}

describe('oauth1 (HMAC-SHA1, RFC 5849)', () => {
  // RFC 3986 percent-encoding, mirrored so the test independently reconstructs the base string.
  const pe = (s: string): string =>
    encodeURIComponent(s).replace(/[!*'()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

  it('produces a signature matching an independently-built base string (GET, no params)', () => {
    const strat = oauth1({ nonce: () => 'NONCE', timestamp: () => 1234567890 });
    const creds: Credentials = {
      type: 'oauth1',
      consumerKey: 'CK',
      consumerSecret: 'CS',
      token: 'TK',
      tokenSecret: 'TS',
    };
    const c = ctx('GET', 'https://api.example.com/resource');
    strat.applyAuth(creds, c);

    // Independent reconstruction (params sorted by key): proves the base string + HMAC + key.
    const params = [
      'oauth_consumer_key=CK',
      'oauth_nonce=NONCE',
      'oauth_signature_method=HMAC-SHA1',
      'oauth_timestamp=1234567890',
      'oauth_token=TK',
      'oauth_version=1.0',
    ].join('&');
    const base = ['GET', pe('https://api.example.com/resource'), pe(params)].join('&');
    const key = `${pe('CS')}&${pe('TS')}`;
    const expected = createHmac('sha1', key).update(base).digest('base64');

    expect(c.headers.Authorization).toContain(`oauth_signature="${pe(expected)}"`);
    expect(c.headers.Authorization?.startsWith('OAuth ')).toBe(true);
    expect(c.headers.Authorization).toContain('oauth_signature_method="HMAC-SHA1"');
  });

  it('includes query + form-body params in the signature (changes the signature)', () => {
    const mk = () => oauth1({ nonce: () => 'N', timestamp: () => 1 });
    const creds: Credentials = { type: 'oauth1', consumerKey: 'CK', consumerSecret: 'CS' };
    const plain = ctx('POST', 'https://api.example.com/r');
    const withParams = ctx('POST', 'https://api.example.com/r?x=1', 'y=2');
    withParams.headers['content-type'] = 'application/x-www-form-urlencoded';
    mk().applyAuth(creds, plain);
    mk().applyAuth(creds, withParams);
    const sig = (h: Record<string, string>) => /oauth_signature="([^"]+)"/.exec(h.Authorization ?? '')?.[1];
    expect(sig(plain.headers)).not.toBe(sig(withParams.headers)); // params are actually signed
  });

  it('throws on tokenOf (no static token)', () => {
    expect(() => oauth1().tokenOf({ type: 'oauth1', consumerKey: '', consumerSecret: '' })).toThrow();
  });
});

describe('aws_sigv4', () => {
  it('matches the AWS get-vanilla test-suite vector', () => {
    const strat = awsSigV4({
      region: 'us-east-1',
      service: 'service',
      timestamp: () => new Date('2015-08-30T12:36:00Z'),
    });
    const creds: Credentials = {
      type: 'aws_sigv4',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    };
    const c = ctx('GET', 'https://example.amazonaws.com/');
    strat.applyAuth(creds, c);
    expect(c.headers['x-amz-date']).toBe('20150830T123600Z');
    expect(c.headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('adds the session token header when present', () => {
    const strat = awsSigV4({ region: 'us-east-1', service: 's3', timestamp: () => new Date('2015-08-30T12:36:00Z') });
    const c = ctx('GET', 'https://b.s3.amazonaws.com/k');
    strat.applyAuth(
      { type: 'aws_sigv4', accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'TOKEN' },
      c,
    );
    expect(c.headers['x-amz-security-token']).toBe('TOKEN');
    expect(c.headers.Authorization).toContain('SignedHeaders=host;x-amz-date');
  });
});

describe('jwt (self-signed per request)', () => {
  it('mints an HS256 bearer whose signature verifies', () => {
    const strat = jwt({ algorithm: 'HS256', issuer: 'me', audience: 'them', ttlSeconds: 600, now: () => 1_700_000_000_000 });
    const c = ctx('GET', 'https://api.example.com/x');
    strat.applyAuth({ type: 'jwt', key: 'topsecret' }, c);
    const token = (c.headers.Authorization as string).replace('Bearer ', '');
    const [h, p, sig] = token.split('.');
    // signature verifies with the same key
    const expected = createHmac('sha256', 'topsecret').update(`${h}.${p}`).digest('base64url');
    expect(sig).toBe(expected);
    const payload = JSON.parse(Buffer.from(p as string, 'base64url').toString());
    expect(payload).toMatchObject({ iss: 'me', aud: 'them', iat: 1_700_000_000, exp: 1_700_000_600 });
    const header = JSON.parse(Buffer.from(h as string, 'base64url').toString());
    expect(header).toMatchObject({ alg: 'HS256', typ: 'JWT' });
  });
});
