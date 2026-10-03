import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import { appendAudit, readAuditTail, storeScript } from './audit';

let root: string;
let prevRoot: string | undefined;

beforeAll(() => {
  prevRoot = process.env[APP_ROOT_ENV];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-audit-'));
  process.env[APP_ROOT_ENV] = root;
});

afterAll(() => {
  if (prevRoot === undefined) delete process.env[APP_ROOT_ENV];
  else process.env[APP_ROOT_ENV] = prevRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('storeScript', () => {
  it('keeps the whole script in a content-addressed file and a short preview inline', () => {
    const fn = `(async () => {\n  const body = ${JSON.stringify({ writerNamesToAdd: ['ada'], pad: 'x'.repeat(5_000) })};\n  return fetch('/gitconnected', { method: 'POST', headers: { 'x-xsrf-token': '{{cookie:xsrf}}' }, body: JSON.stringify(body) }).then(r => r.json());\n})()`;
    const script = storeScript(fn);
    expect(fs.readFileSync(script.path, 'utf8')).toBe(fn);
    expect(script.chars).toBe(fn.length);
    expect(script.preview.length).toBeLessThanOrEqual(241);
    expect(script.preview).not.toContain('\n');
    expect(path.basename(script.path)).toBe(`${script.sha256}.js`);
  });

  it('stores a repeated script once', () => {
    const a = storeScript('document.title');
    const b = storeScript('document.title');
    expect(a.path).toBe(b.path);
    expect(fs.readdirSync(path.dirname(a.path)).filter((f) => f === path.basename(a.path))).toHaveLength(1);
  });

  it('redacts known credential formats in the stored copy', () => {
    const script = storeScript("fetch('/x', { headers: { authorization: 'Bearer abcdefghijklmnopqrstuvwxyz0123' } })");
    expect(fs.readFileSync(script.path, 'utf8')).toContain('[redacted:bearer-token]');
  });
});

describe('appendAudit', () => {
  it('records an evaluate with its chat, origin, script, size and error', () => {
    const script = storeScript('1 + 1');
    appendAudit({
      action: 'evaluate',
      session: 'ws-1',
      chat: 'chat-9',
      origin: 'https://medium.com',
      script,
      resultChars: 1,
      requests: { cookiesFilled: ['xsrf'] },
      error: 'boom ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    });
    const last = readAuditTail(1)[0];
    expect(last).toMatchObject({
      action: 'evaluate',
      session: 'ws-1',
      chat: 'chat-9',
      origin: 'https://medium.com',
      script: { sha256: script.sha256 },
      resultChars: 1,
      requests: { cookiesFilled: ['xsrf'] },
      error: 'boom [redacted:github-token]',
    });
  });
});
