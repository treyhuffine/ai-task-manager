import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { APP_SHORT_ID } from '@/constants/app';
import { generateToken, hashToken, tokenDisplay } from './tokens';

describe('generateToken', () => {
  it('returns plaintext with the expected prefix/env/length', () => {
    const t = generateToken('live');
    expect(t.plaintext.startsWith(`${APP_SHORT_ID}_live_`)).toBe(true);
    // <prefix>_live_ + 40-char random
    expect(t.plaintext.length).toBe(`${APP_SHORT_ID}_live_`.length + 40);
    expect(t.env).toBe('live');
  });

  it('supports the test env', () => {
    const t = generateToken('test');
    expect(t.plaintext.startsWith(`${APP_SHORT_ID}_test_`)).toBe(true);
    expect(t.env).toBe('test');
  });

  it('random portion is alphanumeric only (no _ or -)', () => {
    const t = generateToken('live');
    const random = t.plaintext.slice(`${APP_SHORT_ID}_live_`.length);
    expect(random).toMatch(/^[A-Za-z0-9]{40}$/);
  });

  it('produces distinct tokens and hashes across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const t = generateToken('live');
      expect(seen.has(t.plaintext)).toBe(false);
      expect(seen.has(t.hash)).toBe(false);
      seen.add(t.plaintext);
      seen.add(t.hash);
    }
  });

  it('prefix/suffix are the first 6 and last 4 of the nanoid', () => {
    const t = generateToken('live');
    const random = t.plaintext.slice(`${APP_SHORT_ID}_live_`.length);
    expect(t.prefix).toBe(random.slice(0, 6));
    expect(t.suffix).toBe(random.slice(-4));
    expect(t.prefix).toHaveLength(6);
    expect(t.suffix).toHaveLength(4);
  });

  it('hash matches sha256 of plaintext', () => {
    const t = generateToken('live');
    const expected = createHash('sha256').update(t.plaintext).digest('hex');
    expect(t.hash).toBe(expected);
    expect(t.hash).toHaveLength(64);
  });
});

describe('hashToken', () => {
  it('is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('changes when input changes', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('returns a 64-char hex string', () => {
    expect(hashToken('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('tokenDisplay', () => {
  it('renders prefix…suffix with env', () => {
    expect(tokenDisplay('abcdef', 'wxyz', 'live')).toBe(
      `${APP_SHORT_ID}_live_abcdef…wxyz`,
    );
    expect(tokenDisplay('abcdef', 'wxyz', 'test')).toBe(
      `${APP_SHORT_ID}_test_abcdef…wxyz`,
    );
  });

  it('defaults to live', () => {
    expect(tokenDisplay('abcdef', 'wxyz')).toBe(
      `${APP_SHORT_ID}_live_abcdef…wxyz`,
    );
  });
});
