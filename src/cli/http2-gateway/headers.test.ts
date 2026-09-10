import { describe, it, expect } from 'vitest';
import {
  buildUpstreamRequestHeaders,
  buildDownstreamResponseHeaders,
  privateAuthoritiesFor,
  rewriteLocation,
  type HeaderTranslationConfig,
} from './headers';

const cfg: HeaderTranslationConfig = {
  publicBaseUrl: 'https://localhost:4224',
  publicHostHeader: 'localhost:4224',
  publicPort: 4224,
  privateAuthorities: privateAuthoritiesFor('127.0.0.1', 53000),
};

describe('buildUpstreamRequestHeaders', () => {
  it('strips hop-by-hop, pseudo, and client forwarding hints; sets canonical values', () => {
    const out = buildUpstreamRequestHeaders(
      {
        ':method': 'GET',
        host: 'evil.example',
        connection: 'keep-alive, x-custom',
        'keep-alive': 'timeout=5',
        'x-custom': 'dropme', // named by Connection
        'x-forwarded-for': '1.2.3.4',
        forwarded: 'for=1.2.3.4',
        authorization: 'Bearer t',
        accept: 'text/event-stream',
      },
      cfg,
      { remoteAddress: '10.0.0.9' },
    );
    expect(out['connection']).toBeUndefined();
    expect(out['keep-alive']).toBeUndefined();
    expect(out['x-custom']).toBeUndefined();
    expect(out[':method']).toBeUndefined();
    expect(out['authorization']).toBe('Bearer t');
    expect(out['host']).toBe('localhost:4224');
    expect(out['x-forwarded-proto']).toBe('https');
    expect(out['x-forwarded-host']).toBe('localhost:4224');
    expect(out['x-forwarded-port']).toBe('4224');
    expect(out['x-forwarded-for']).toBe('10.0.0.9');
  });

  it('concatenates split Cookie fields with "; "', () => {
    // Node types `cookie` as a single string, but normalize defensively in case
    // a proxy surfaces the split fields as an array.
    const out = buildUpstreamRequestHeaders(
      { cookie: ['a=1', 'b=2'] as unknown as string },
      cfg,
    );
    expect(out['cookie']).toBe('a=1; b=2');
  });

  it('preserves Connection/Upgrade when forwarding an Upgrade', () => {
    const out = buildUpstreamRequestHeaders(
      { connection: 'Upgrade', upgrade: 'websocket' },
      cfg,
      { keepUpgrade: true },
    );
    expect(out['connection']).toBe('Upgrade');
    expect(out['upgrade']).toBe('websocket');
  });
});

describe('buildDownstreamResponseHeaders', () => {
  it('strips hop-by-hop and Transfer-Encoding, preserves multiple Set-Cookie', () => {
    const out = buildDownstreamResponseHeaders(
      {
        connection: 'keep-alive',
        'transfer-encoding': 'chunked',
        'content-encoding': 'gzip',
        'set-cookie': ['a=1; Path=/', 'b=2; Path=/'],
        etag: 'W/"x"',
      },
      cfg,
    );
    expect(out['connection']).toBeUndefined();
    expect(out['transfer-encoding']).toBeUndefined();
    expect(out['content-encoding']).toBe('gzip');
    expect(out['set-cookie']).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    expect(out['etag']).toBe('W/"x"');
  });
});

describe('rewriteLocation', () => {
  it('rewrites a private-backend authority to the public origin', () => {
    expect(rewriteLocation('http://127.0.0.1:53000/dashboard?x=1#f', cfg)).toBe(
      'https://localhost:4224/dashboard?x=1#f',
    );
    expect(rewriteLocation('http://localhost:53000/a', cfg)).toBe('https://localhost:4224/a');
  });

  it('leaves relative and unrelated external redirects untouched', () => {
    expect(rewriteLocation('/relative/path', cfg)).toBe('/relative/path');
    expect(rewriteLocation('https://accounts.google.com/o/oauth2/callback', cfg)).toBe(
      'https://accounts.google.com/o/oauth2/callback',
    );
  });

  it('upgrades a self-referential http redirect on the public host to https', () => {
    // Next builds absolute URLs (e.g. OAuth callbacks) from its loopback HTTP
    // connection → `http://<publichost>/…`. The browser is on https, so the
    // scheme must be upgraded or it bounces to a plaintext URL on the TLS port.
    expect(rewriteLocation('http://localhost:4224/?settings=connectors', cfg)).toBe(
      'https://localhost:4224/?settings=connectors',
    );
    // Already-https public URL is unchanged; a different external host is not touched.
    expect(rewriteLocation('https://localhost:4224/x', cfg)).toBe('https://localhost:4224/x');
    expect(rewriteLocation('http://example.com:4224/x', cfg)).toBe('http://example.com:4224/x');
  });
});
