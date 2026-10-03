import { describe, it, expect } from 'vitest';
import { assertNavigable, isBlockedHost, isRequestAllowed } from './confine';

describe('assertNavigable', () => {
  it('allows public http and https urls', () => {
    expect(() => assertNavigable('https://example.com/article')).not.toThrow();
    expect(() => assertNavigable('http://medium.com')).not.toThrow();
    expect(() => assertNavigable('https://sub.domain.co.uk/path?q=1')).not.toThrow();
  });

  it('blocks localhost and loopback', () => {
    expect(() => assertNavigable('http://localhost:3000')).toThrow();
    expect(() => assertNavigable('http://127.0.0.1')).toThrow();
    expect(() => assertNavigable('http://127.9.9.9:8080')).toThrow();
    expect(() => assertNavigable('http://[::1]/')).toThrow();
  });

  it('blocks private network ranges', () => {
    expect(() => assertNavigable('http://10.0.0.5')).toThrow();
    expect(() => assertNavigable('http://192.168.1.1')).toThrow();
    expect(() => assertNavigable('http://172.16.0.1')).toThrow();
    expect(() => assertNavigable('http://172.31.255.255')).toThrow();
  });

  it('allows public ranges that look adjacent to private ones', () => {
    expect(() => assertNavigable('http://172.15.0.1')).not.toThrow();
    expect(() => assertNavigable('http://172.32.0.1')).not.toThrow();
    expect(() => assertNavigable('http://11.0.0.1')).not.toThrow();
  });

  it('blocks cloud metadata endpoints', () => {
    expect(() => assertNavigable('http://169.254.169.254/latest/meta-data')).toThrow();
    expect(() => assertNavigable('http://metadata.google.internal/')).toThrow();
  });

  it('blocks non-http protocols and junk', () => {
    expect(() => assertNavigable('file:///etc/passwd')).toThrow();
    expect(() => assertNavigable('ftp://example.com')).toThrow();
    expect(() => assertNavigable('not a url')).toThrow();
  });
});

describe('isBlockedHost', () => {
  it('does not mistake hostnames that start like IPv6 prefixes for addresses', () => {
    expect(isBlockedHost('fda.gov')).toBe(false);
    expect(isBlockedHost('fcbarcelona.com')).toBe(false);
    expect(isBlockedHost('fe80.example.com')).toBe(false);
  });

  it('blocks IPv6 loopback, link-local, unique-local and mapped private addresses', () => {
    expect(isBlockedHost('[::1]')).toBe(true);
    expect(isBlockedHost('::')).toBe(true);
    expect(isBlockedHost('fe80::1')).toBe(true);
    expect(isBlockedHost('fd12:3456::1')).toBe(true);
    expect(isBlockedHost('fc00::1')).toBe(true);
    expect(isBlockedHost('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedHost(new URL('http://[::ffff:127.0.0.1]/').hostname)).toBe(true);
    expect(isBlockedHost(new URL('http://[::ffff:192.168.1.1]/').hostname)).toBe(true);
    expect(isBlockedHost(new URL('http://[::ffff:8.8.8.8]/').hostname)).toBe(false);
    expect(isBlockedHost('2606:4700::1111')).toBe(false);
  });

  it('blocks every *.localhost name and a trailing-dot localhost', () => {
    expect(isBlockedHost('ri.localhost')).toBe(true);
    expect(isBlockedHost('localhost.')).toBe(true);
    expect(isBlockedHost('notlocalhost.com')).toBe(false);
  });
});

describe('isRequestAllowed', () => {
  it('allows public http(s) and non-network schemes', () => {
    expect(isRequestAllowed('https://medium.com/gitconnected')).toBe(true);
    expect(isRequestAllowed('data:text/plain,hi')).toBe(true);
    expect(isRequestAllowed('blob:https://medium.com/123')).toBe(true);
  });

  it('refuses private, loopback and metadata addresses, including websockets', () => {
    expect(isRequestAllowed('http://localhost:4224/api/tasks')).toBe(false);
    expect(isRequestAllowed('http://192.168.1.1/admin')).toBe(false);
    expect(isRequestAllowed('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isRequestAllowed('ws://127.0.0.1:9222/devtools')).toBe(false);
    expect(isRequestAllowed('not a url')).toBe(false);
  });
});
