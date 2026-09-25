import { beforeAll, describe, expect, it } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { generateCaPair, generateLeafPair } from '../src/lib/config/tls-x509';
import { certificateDecision, externalWebUrl, sameOrigin } from './trust';

let certificate: string;
let otherCertificate: string;
beforeAll(async () => {
  const ca = await generateCaPair({ years: 1, clockSkewMs: 1000 });
  const leaf = () => generateLeafPair({ caCertPem: ca.certPem, caKeyPem: ca.keyPem,
    sans: [{ type: 'dns', value: 'localhost' }, { type: 'ip', value: '127.0.0.1' }], days: 1, clockSkewMs: 1000 });
  certificate = (await leaf()).certPem;
  otherCertificate = (await leaf()).certPem;
});

describe('session certificate pin', () => {
  const origin = 'https://localhost:42242';
  it('accepts the exact local leaf without requiring an OS trust anchor', () => {
    expect(certificateDecision('localhost', certificate, { origin, certificate })).toBe(0);
  });
  it('rejects another leaf even when the same local CA signed it', () => {
    expect(certificateDecision('localhost', otherCertificate, { origin, certificate })).toBe(-2);
  });
  it('rejects expired and not-yet-valid certificates even when the pin matches', () => {
    const cert = new X509Certificate(certificate);
    expect(certificateDecision('localhost', certificate, { origin, certificate }, Date.parse(cert.validTo) + 1)).toBe(-2);
    expect(certificateDecision('localhost', certificate, { origin, certificate }, Date.parse(cert.validFrom) - 1)).toBe(-2);
  });
  it('rejects malformed certificates and hostname mismatches', () => {
    expect(certificateDecision('localhost', 'invalid', { origin, certificate })).toBe(-2);
    expect(certificateDecision('other.localhost', certificate, { origin: 'https://other.localhost:42242', certificate })).toBe(-2);
  });
  it('keeps Chromium validation for external hosts and deceptive lookalikes', () => {
    for (const host of ['example.com', 'localhost.example.com', '127.0.0.1']) {
      expect(certificateDecision(host, certificate, { origin, certificate })).toBe(-3);
    }
  });
});

describe('window navigation', () => {
  it('compares exact origins including scheme and port', () => {
    expect(sameOrigin('https://localhost:42242/welcome?force=1', 'https://localhost:42242')).toBe(true);
    for (const url of ['http://localhost:42242/', 'https://localhost:42243/', 'https://localhost.evil:42242/', 'file:///tmp/a', 'invalid']) {
      expect(sameOrigin(url, 'https://localhost:42242')).toBe(false);
    }
  });
  it('allows ordinary web links but excludes executable/file/custom schemes and credentials', () => {
    expect(externalWebUrl('https://example.com/docs')).toBe('https://example.com/docs');
    for (const url of ['javascript:alert(1)', 'file:///tmp/a', 'ri://command', 'https://user:secret@example.com', 'invalid']) {
      expect(externalWebUrl(url)).toBeNull();
    }
  });
});
