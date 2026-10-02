import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import { EVAL_MAX_CHARS, fillPlaceholders, finishValue, originOf, placeholderNames, scrubValue } from './evaluate';

let root: string;
let prevRoot: string | undefined;

beforeAll(() => {
  prevRoot = process.env[APP_ROOT_ENV];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-evaluate-'));
  process.env[APP_ROOT_ENV] = root;
});

afterAll(() => {
  if (prevRoot === undefined) delete process.env[APP_ROOT_ENV];
  else process.env[APP_ROOT_ENV] = prevRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('placeholderNames', () => {
  it('finds every {{cookie:name}}', () => {
    expect(placeholderNames('a {{cookie:xsrf}} b {{cookie:sid.v2}} {{cookie:}} {{cookie:bad name}}')).toEqual([
      'xsrf',
      'sid.v2',
    ]);
  });
});

describe('fillPlaceholders', () => {
  const jar: Record<string, string> = { xsrf: 'tok123', sid: 's3cr3t' };

  it('fills known cookies and reports names, leaving unknown ones as written', () => {
    const filled: string[] = [];
    const missing: string[] = [];
    const out = fillPlaceholders(
      '{"x":"{{cookie:xsrf}}","y":"{{cookie:nope}}"}',
      (n) => jar[n],
      (n) => filled.push(n),
      (n) => missing.push(n),
    );
    expect(out).toBe('{"x":"tok123","y":"{{cookie:nope}}"}');
    expect(filled).toEqual(['xsrf']);
    expect(missing).toEqual(['nope']);
  });

  it('is a no-op without placeholders', () => {
    expect(fillPlaceholders('plain', () => 'v', () => {}, () => {})).toBe('plain');
  });
});

describe('scrubValue', () => {
  it('replaces filled cookie values anywhere in the result, deeply', () => {
    const secrets = new Map([['tok123', 'xsrf']]);
    const value = { echo: 'header was tok123', list: ['tok123', 3, null], nested: { deep: 'x tok123 y' }, n: 7 };
    expect(scrubValue(value, secrets)).toEqual({
      echo: 'header was [redacted:cookie:xsrf]',
      list: ['[redacted:cookie:xsrf]', 3, null],
      nested: { deep: 'x [redacted:cookie:xsrf] y' },
      n: 7,
    });
  });

  it('also masks known credential formats', () => {
    expect(scrubValue('key ghp_abcdefghijklmnopqrstuvwxyz0123456789', new Map())).toBe('key [redacted:github-token]');
  });

  it('leaves non-string values alone', () => {
    expect(scrubValue(42, new Map([['42', 'n']]))).toBe(42);
    expect(scrubValue(undefined, new Map())).toBeUndefined();
  });
});

describe('originOf', () => {
  it('returns the origin, or null for opaque pages', () => {
    expect(originOf('https://medium.com/gitconnected/settings?tab=writers')).toBe('https://medium.com');
    expect(originOf('about:blank')).toBeNull();
    expect(originOf('data:text/html,hi')).toBeNull();
    expect(originOf('nonsense')).toBeNull();
  });
});

describe('finishValue', () => {
  it('returns a small value as is, with its size', () => {
    expect(finishValue({ success: true }, null, 't')).toEqual({ value: { success: true }, resultChars: 16 });
  });

  it('spills a large value to a file and returns a capped preview', () => {
    const big = { rows: Array.from({ length: 3_000 }, (_, i) => `row ${i} with some text`) };
    const out = finishValue(big, null, 't');
    expect(out.truncated).toBe(true);
    expect(out.resultChars).toBeGreaterThan(EVAL_MAX_CHARS);
    expect(typeof out.value).toBe('string');
    expect((out.value as string).length).toBeLessThan(EVAL_MAX_CHARS + 300);
    expect(JSON.parse(fs.readFileSync(out.spillPath!, 'utf8'))).toEqual(big);
  });

  it('keeps undefined as undefined (a script that returns nothing)', () => {
    expect(finishValue(undefined, null, 't')).toEqual({ value: undefined, resultChars: 0 });
  });
});
