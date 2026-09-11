import { describe, it, expect } from 'vitest';
import { resolveHttp2Enabled, isChainTrustFailure } from './http2';

describe('resolveHttp2Enabled', () => {
  it('honors explicit --http2 / --no-http2 over the environment', () => {
    expect(resolveHttp2Enabled({ http2: true }, { RI_HTTP2: '0' })).toBe(true);
    expect(resolveHttp2Enabled({ http2: false }, { RI_HTTP2: '1' })).toBe(false);
  });

  it('falls back to RI_HTTP2 when no flag is given', () => {
    expect(resolveHttp2Enabled({}, { RI_HTTP2: '1' })).toBe(true);
    expect(resolveHttp2Enabled({}, { RI_HTTP2: 'true' })).toBe(true);
    expect(resolveHttp2Enabled({}, { RI_HTTP2: '0' })).toBe(false);
    expect(resolveHttp2Enabled({}, { RI_HTTP2: 'false' })).toBe(false);
  });

  it('defaults to disabled when nothing is set', () => {
    expect(resolveHttp2Enabled({}, {})).toBe(false);
    expect(resolveHttp2Enabled({}, { RI_HTTP2: '' })).toBe(false);
  });

  it('rejects an unrecognized RI_HTTP2 value loudly', () => {
    expect(() => resolveHttp2Enabled({}, { RI_HTTP2: 'yes' })).toThrow(/Invalid RI_HTTP2/);
  });
});

describe('isChainTrustFailure', () => {
  it('recognizes untrusted-chain probe errors (allowed to proceed for supplied certs)', () => {
    expect(isChainTrustFailure('unable to verify the first certificate')).toBe(true);
    expect(isChainTrustFailure('self-signed certificate in certificate chain')).toBe(true);
    expect(isChainTrustFailure('unable to get local issuer certificate')).toBe(true);
  });

  it('does not excuse health, connection, or h2 failures', () => {
    expect(isChainTrustFailure(undefined)).toBe(false);
    expect(isChainTrustFailure('probe timed out')).toBe(false);
    expect(isChainTrustFailure('connect ECONNREFUSED 127.0.0.1:4224')).toBe(false);
    expect(isChainTrustFailure('certificate has expired')).toBe(false);
    expect(isChainTrustFailure("Hostname/IP does not match certificate's altnames")).toBe(false);
  });
});
