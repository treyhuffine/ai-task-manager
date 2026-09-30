import { describe, expect, it } from 'vitest';
import { StartupDiagnostics } from './startup-diagnostics';

describe('startup diagnostics', () => {
  it('distinguishes an application 500 from a TLS or HTTP/2 failure', () => {
    const diagnostics = new StartupDiagnostics();
    diagnostics.capture(' ⨯ Error: Cannot find module better-sqlite3');
    const message = diagnostics.readinessFailure({ ok: false, negotiatedProtocol: 'h2', status: 500 }).message;
    expect(message).toContain('Next.js app returned HTTP 500 from /api/health');
    expect(message).toContain('HTTPS and HTTP/2 connected successfully');
    expect(message).toContain('Next.js: Error: Cannot find module better-sqlite3');
    expect(message).toContain('service log folder');
    const tls = diagnostics.readinessFailure({ ok: false, negotiatedProtocol: null, detail: 'certificate has expired' }).message;
    expect(tls).toContain('HTTP/2 readiness failed: certificate has expired');
    expect(tls).not.toContain('connected successfully');
    expect(diagnostics.readinessFailure({ ok: false, negotiatedProtocol: 'http/1.1', status: 200 }).message).toContain('negotiated http/1.1');
  });

  it('retains substantive errors across request logs without collecting stacks, HTML or source', () => {
    const diagnostics = new StartupDiagnostics();
    diagnostics.capture('\u001b[31m⨯ Error: database failed to open\u001b[0m');
    diagnostics.capture('    at open (/secret/path/file.ts:12:5)');
    diagnostics.capture('> 12 | throw new Error("source-private")');
    diagnostics.capture('Error: <html><body>response-private</body></html>');
    for (let i = 0; i < 200; i++) diagnostics.capture('GET /api/health 500 in 10ms');
    const message = diagnostics.failure('Backend exited during startup').message;
    expect(message).toContain('Next.js: Error: database failed to open');
    expect(message).not.toMatch(/\u001b|\/secret|source-private|response-private|GET/);
  });

  it('redacts known secrets, headers, OAuth values, URL credentials and credential assignments', () => {
    const diagnostics = new StartupDiagnostics(['known-secret']);
    diagnostics.capture('Error: known-secret Bearer unknown-bearer https://user:pass@host/#token=pair-secret&state=state-secret');
    diagnostics.capture('Error: API_KEY="key-value" password=pass-value refresh_token=refresh-value');
    diagnostics.capture('Error: authorization: Basic basic-value cookie: session=cookie-value');
    const message = diagnostics.failure('Startup failed with known-secret').message;
    expect(message).toContain('[redacted]');
    for (const secret of ['known-secret', 'unknown-bearer', 'user:pass', 'pair-secret', 'state-secret', 'key-value', 'pass-value', 'refresh-value', 'basic-value', 'cookie-value']) expect(message).not.toContain(secret);
  });

  it('removes ANSI before redacting and removes remaining control characters', () => {
    const diagnostics = new StartupDiagnostics(['super-secret']);
    diagnostics.capture('Error: super-\u001b[31msecret\u001b[0m\u0000\u202e');
    diagnostics.capture('Error: su\u200bper-se\u0000cret');
    expect(diagnostics.failure('Startup failed').message).not.toMatch(/super|secret|\u0000|\u202e|\u001b/);
  });

  it('bounds retained errors and output length, deduplicates, and resets per startup', () => {
    const diagnostics = new StartupDiagnostics();
    for (let i = 0; i < 100; i++) diagnostics.capture(`Error: failure${i} ${'x'.repeat(10_000)}`);
    diagnostics.capture(`Error: failure99 ${'x'.repeat(10_000)}`);
    const message = diagnostics.failure('Backend did not become ready within three minutes').message;
    expect(message).toContain('failure97');
    expect(message).toContain('failure98');
    expect(message).not.toContain('failure96');
    expect(message.match(/failure99/g)).toHaveLength(1);
    expect(message.length).toBeLessThan(1700);
    expect(new StartupDiagnostics().failure('Backend exited').message).not.toContain('failure99');
  });

  it('provides useful fallback guidance when no Next errors were emitted', () => {
    expect(new StartupDiagnostics().failure('Backend did not become ready within three minutes').message).toBe('Backend did not become ready within three minutes\nOpen the service log folder for the full startup log.');
  });
});
