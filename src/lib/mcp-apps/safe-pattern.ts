import { RE2JS } from 're2js';

/**
 * A server's `pattern` (in a form field or a setting), checked in linear
 * time. JavaScript's regex engine backtracks, so a pattern such as
 * `^(a+)+$` can take seconds or hours on a short value, on the Home's single
 * thread or in the person's tab. Ri never runs a server's pattern there. It
 * runs it in RE2 (re2js), whose time grows with the value's length only.
 *
 * JSON Schema patterns are ECMA-262 regular expressions. RE2 reads nearly the
 * same syntax, and the few differences that change a match are translated:
 * `\s` is JavaScript's whitespace (no-break space and the other Unicode
 * spaces), `.` stops at every line terminator, and `\uXXXX` and `\u{X}`
 * name code points. RE2 has no lookaround or backreferences, since those
 * cannot run in linear time, and no way to write `\S` inside a class with
 * JavaScript's meaning. A pattern that uses them, or is longer than
 * `MAX_PATTERN_LENGTH`, is left for the server to check, which it does
 * anyway when the value reaches it. So is a value longer than
 * `MAX_CHECKED_LENGTH`.
 */
export const MAX_PATTERN_LENGTH = 4096;
export const MAX_CHECKED_LENGTH = 65_536;

/** JavaScript's `\s`, as RE2 class members. */
const SPACE = '\\t\\n\\x{0b}\\f\\r \\x{a0}\\x{1680}\\x{2000}-\\x{200a}\\x{2028}\\x{2029}\\x{202f}\\x{205f}\\x{3000}\\x{feff}';
const NOT_LINE_END = '[^\\n\\r\\x{2028}\\x{2029}]';

/** Whether a pattern is a valid ECMA-262 regular expression with the `u` flag, as JSON Schema reads it. Parsing never runs it. */
export function validPattern(pattern: string): boolean {
  try { new RegExp(pattern, 'u'); return true; } catch { return false; }
}

/** The pattern in RE2's syntax with JavaScript's meaning, or null when part of it cannot be translated. */
export function toRe2(pattern: string): string | null {
  let out = '', inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      const next = pattern[++i];
      if (next === undefined) return null;
      if (next === 'u') {
        const braced = pattern[i + 1] === '{' ? /^\{([0-9a-fA-F]{1,6})\}/.exec(pattern.slice(i + 1)) : null;
        const plain = braced ? null : /^[0-9a-fA-F]{4}/.exec(pattern.slice(i + 1));
        if (!braced && !plain) return null;
        out += `\\x{${braced ? braced[1] : plain![0]}}`;
        i += braced ? braced[0].length : 4;
      } else if (next === 's') out += inClass ? SPACE : `[${SPACE}]`;
      else if (next === 'S') {
        // Inside a class, "not JavaScript's whitespace" has no RE2 spelling, so the server checks it.
        if (inClass) return null;
        out += `[^${SPACE}]`;
      } else out += `\\${next}`;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      out += c;
      continue;
    }
    if (c === '[') {
      // JavaScript's `[]` matches nothing and `[^]` matches anything. RE2 reads a leading `]` as a literal.
      if (pattern[i + 1] === ']') { out += '[^\\x{0}-\\x{10ffff}]'; i += 1; continue; }
      if (pattern.startsWith('^]', i + 1)) { out += '[\\x{0}-\\x{10ffff}]'; i += 2; continue; }
      inClass = true;
      out += c;
      if (pattern[i + 1] === '^') { out += '^'; i += 1; }
      continue;
    }
    out += c === '.' ? NOT_LINE_END : c;
  }
  return out;
}

const compiled = new Map<string, RE2JS | null>();
/** The pattern compiled to run in linear time, or null when RE2 cannot run it. Cached by pattern. */
function linear(pattern: string): RE2JS | null {
  if (compiled.has(pattern)) return compiled.get(pattern)!;
  let result: RE2JS | null = null;
  if (pattern.length <= MAX_PATTERN_LENGTH && validPattern(pattern)) {
    const translated = toRe2(pattern);
    try { result = translated === null ? null : RE2JS.compile(translated); } catch { result = null; }
  }
  if (compiled.size >= 256) compiled.delete(compiled.keys().next().value!);
  compiled.set(pattern, result);
  return result;
}

/** Whether a pattern can be checked here, in linear time. When it can't, the server checks it. */
export function checkablePattern(pattern: string): boolean {
  return linear(pattern) !== null;
}

/**
 * Whether `value` matches `pattern` as JSON Schema means it (anywhere in the
 * value, unless the pattern anchors itself). `undefined` when Ri leaves the
 * check to the server: a pattern RE2 cannot run, or a value too long to check.
 */
export function matchesPattern(pattern: string, value: string): boolean | undefined {
  if (value.length > MAX_CHECKED_LENGTH) return undefined;
  const re = linear(pattern);
  return re ? re.matcher(value).find() : undefined;
}
