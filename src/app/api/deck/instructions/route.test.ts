import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { NextRequest } from 'next/server';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import { DECK_INSTRUCTIONS_FILENAME } from '@/lib/deck/instructions';
import { GET, PUT } from './route';

const ROOT = path.join(os.tmpdir(), `flow-deck-instr-route-${process.pid}`);
const prevRoot = process.env[APP_ROOT_ENV];

beforeEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  process.env[APP_ROOT_ENV] = ROOT;
});

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  if (prevRoot === undefined) delete process.env[APP_ROOT_ENV];
  else process.env[APP_ROOT_ENV] = prevRoot;
});

function putReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe('/api/deck/instructions route', () => {
  it('GET returns empty content when DECK.md does not exist', async () => {
    const res = await GET(new Request('http://localhost/api'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content: '' });
  });

  it('PUT writes DECK.md, GET reads it back (editor round-trip)', async () => {
    const put = await PUT(putReq({ content: '# Sources\nUse my calendar.' }));
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ ok: true, content: '# Sources\nUse my calendar.' });
    expect(fs.existsSync(path.join(ROOT, DECK_INSTRUCTIONS_FILENAME))).toBe(true);

    const get = await GET(new Request('http://localhost/api'));
    expect(await get.json()).toEqual({ content: '# Sources\nUse my calendar.' });
  });

  it('PUT rejects a non-string body with 400', async () => {
    const res = await PUT(putReq({ content: 123 }));
    expect(res.status).toBe(400);
  });

  it('PUT rejects oversized content with 413', async () => {
    const res = await PUT(putReq({ content: 'x'.repeat(50_001) }));
    expect(res.status).toBe(413);
  });

  it('PUT with a malformed body (no JSON) is a 400, not a crash', async () => {
    const badReq = { json: async () => { throw new Error('bad json'); } } as unknown as NextRequest;
    const res = await PUT(badReq);
    expect(res.status).toBe(400); // body?.content is undefined → not a string → 400
  });
});
