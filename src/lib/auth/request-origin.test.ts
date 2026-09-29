import { describe, expect, it } from 'vitest';
import { permitsCookieMutation } from './request-origin';

function request(headers: Record<string, string> = {}, method = 'POST') {
  return new Request('http://127.0.0.1:1234/api/notes', { method, headers: {
    host: 'localhost:42242', 'x-forwarded-proto': 'https', ...headers,
  } });
}

describe('cookie mutation origin', () => {
  it('accepts the exact public origin behind the local gateway', () => {
    expect(permitsCookieMutation(request({ origin: 'https://localhost:42242' }))).toBe(true);
  });
  it.each(['https://localhost:5555', 'http://localhost:42242', 'https://evil.example', 'null', 'https://localhost:42242/path'])('rejects %s', origin => {
    expect(permitsCookieMutation(request({ origin }))).toBe(false);
  });
  it('requires an origin or browser same-origin metadata for ambient authority', () => {
    expect(permitsCookieMutation(request())).toBe(false);
    expect(permitsCookieMutation(request({ 'sec-fetch-site': 'same-site' }))).toBe(false);
    expect(permitsCookieMutation(request({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
  });
  it('preserves explicit bearer clients and does not accept a malformed bearer fallback', () => {
    expect(permitsCookieMutation(request({ authorization: 'Bearer explicit' }))).toBe(true);
    expect(permitsCookieMutation(request({ authorization: 'bearer ignored-by-proxy' }))).toBe(false);
    expect(permitsCookieMutation(request({}, 'GET'))).toBe(true);
  });
  it('does not trust an extra forwarded host', () => {
    expect(permitsCookieMutation(request({ origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' }))).toBe(false);
  });
});
