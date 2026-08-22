import { describe, it, expect } from 'vitest';
import { redactSecrets } from './redact';

describe('redactSecrets', () => {
  it('masks known credential formats', () => {
    expect(redactSecrets('key sk-abcdefghijklmnopqrstuvwx')).toContain('[redacted:openai-key]');
    expect(redactSecrets('token ghp_' + 'a'.repeat(36))).toContain('[redacted:github-token]');
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')).toContain('[redacted:bearer-token]');
    expect(redactSecrets('id AKIAIOSFODNN7EXAMPLE here')).toContain('[redacted:aws-key-id]');
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redactSecrets(jwt)).toContain('[redacted:jwt]');
  });

  it('leaves ordinary prose untouched', () => {
    const prose = 'The quick brown fox reads a member-only article about skiing in the Alps.';
    expect(redactSecrets(prose)).toBe(prose);
  });

  it('does not corrupt normal words that resemble nothing sensitive', () => {
    const text = 'skiing is fun and github is a website and bearer of good news';
    expect(redactSecrets(text)).toBe(text);
  });
});
