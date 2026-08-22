import { describe, it, expect } from 'vitest';
import { assertNavigable } from './confine';

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
