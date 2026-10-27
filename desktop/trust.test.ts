import { beforeAll, describe, expect, it } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { generateCaPair, generateLeafPair } from '../src/lib/config/tls-x509';
import { agentInstallUrl, certificateDecision, externalWebUrl, sameOrigin } from './trust';

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
  it('opens only the agents’ own MCP install links, on their exact paths', () => {
    for (const url of [
      'cursor://anysphere.cursor-deeplink/mcp/install?name=ri&config=e30%3D',
      'vscode:mcp/install?%7B%22name%22%3A%22ri%22%7D',
      'vscode-insiders:mcp/install?%7B%7D',
      'goose://extension?url=https%3A%2F%2Fri.example%2Fapi%2Forchestrator%2Fmcp&type=streamable_http',
      'lmstudio://add_mcp?name=ri&config=e30%3D',
    ]) expect(agentInstallUrl(url)).toBe(new URL(url).href);
    for (const url of [
      'cursor://anysphere.cursor-deeplink/settings', 'cursor://file/etc/passwd', 'vscode://file/tmp/a', 'vscode:extension/evil.pack',
      'goose://recipe?config=x', 'lmstudio://other', 'kiro://kiro.mcp/add?name=ri', 'ri://command', 'javascript:alert(1)', 'https://cursor.com/en/install-mcp?name=ri', 'invalid',
    ]) expect(agentInstallUrl(url)).toBeNull();
  });
});
