import { describe, expect, it } from 'vitest';
import { checkablePattern, matchesPattern, MAX_CHECKED_LENGTH, toRe2, validPattern } from './safe-pattern';

describe('server patterns in linear time', () => {
  it('runs a catastrophic pattern on a long value at once, where JavaScript would backtrack for hours', () => {
    const start = performance.now();
    expect(matchesPattern('^(a+)+$', `${'a'.repeat(50_000)}!`)).toBe(false);
    expect(matchesPattern('^(\\w+\\s?)*$', `${'word '.repeat(10_000)}!`)).toBe(false);
    expect(matchesPattern('(x+x+)+y', 'x'.repeat(MAX_CHECKED_LENGTH))).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('means what JavaScript means, on patterns both can run', () => {
    const cases: [string, string[]][] = [
      ['^[a-z][a-z0-9-]{0,47}$', ['parts', 'Parts', 'a-1', '', '-a', 'a'.repeat(48), 'a'.repeat(49)]],
      ['^(mcp|cad|file):', ['cad://parts/hex-bolt', 'http://x', 'xcad:', 'file:']],
      ['\\d{3}', ['ab123', '12', 'x1234']],
      ['^\\s*$', ['', '  ', ' ', '\t\n', ' x ', ' ', '﻿']],
      ['^\\S+$', ['abc', 'a b', 'a b', '　']],
      ['^.$', ['a', '\n', '\r', ' ', '😀', '\u0085']],
      ['^\\u0041\\u{1F600}$', ['A😀', 'A', 'a😀']],
      ['^[^]$', ['x', '\n']], ['^[]$', ['', 'x']],
      ['^[\\s\\d]+$', ['1 2', '1 2', 'x']],
      ['^(?<year>\\d{4})-(?:\\d{2})$', ['2026-10', '26-10']],
      ['colou?r', ['color', 'colour', 'colr']],
      ['^\\p{L}+$', ['éa', 'a1']],
      ['^a\\/b\\.c$', ['a/b.c', 'a/bxc']],
      ['^\\w+@\\w+\\.\\w{2,}$', ['me@example.com', 'me@example', 'é@x.com']],
      ['^[\\-+]?\\d+$', ['-1', '+2', '3', '--4']],
      ['^$', ['', 'a', '\n']],
      ['^a$', ['a', 'a\n']],
    ];
    for (const [pattern, values] of cases) {
      expect(checkablePattern(pattern), pattern).toBe(true);
      for (const value of values) expect(matchesPattern(pattern, value), `${pattern} on ${JSON.stringify(value)}`).toBe(new RegExp(pattern, 'u').test(value));
    }
  });

  it('leaves to the server what cannot run in linear time or translate exactly, and refuses what JavaScript cannot read', () => {
    for (const pattern of ['^(?=.*\\d).+$', '(?<!x)y', '^(a)\\1$', '^\\k<n>(?<n>a)$', '^[\\S]+$', `^${'a'.repeat(5000)}$`, '^a{2000}$', '^\\cA$'])
      { expect(checkablePattern(pattern), pattern).toBe(false); expect(matchesPattern(pattern, 'a'), pattern).toBeUndefined(); }
    expect(matchesPattern('^a+$', 'a'.repeat(MAX_CHECKED_LENGTH + 1))).toBeUndefined();
    expect(validPattern('(')).toBe(false);
    expect(validPattern('\\_')).toBe(false);
    expect(checkablePattern('(')).toBe(false);
  });

  it('translates only what changes a match', () => {
    expect(toRe2('^[a-z]+$')).toBe('^[a-z]+$');
    expect(toRe2('a.b')).toBe('a[^\\n\\r\\x{2028}\\x{2029}]b');
    expect(toRe2('[.]')).toBe('[.]');
    expect(toRe2('\\u00e9')).toBe('\\x{00e9}');
    expect(toRe2('\\u{1F600}')).toBe('\\x{1F600}');
    expect(toRe2('\\uZZ')).toBeNull();
  });
});
