import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { githubImageSource, type GithubImageSource } from './image-urls';
import { fetchGithubImage, GITHUB_IMAGE_REVALIDATE_MS } from './repo-image';

const SHA = 'c5d8ea2ecf8587bc5ae8d570fe96f5220e25cf36';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX = 1024;

let root: string;
let cacheDir: string;
let requests: { url: string; headers: Record<string, string>; redirect?: RequestRedirect }[];
let clock: number;

const pinned = (url: string) => githubImageSource(url)!;
const image = (body: BodyInit | null, init: ResponseInit & { type?: string; etag?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set('content-type', init.type ?? 'image/png');
  if (init.etag) headers.set('etag', init.etag);
  return new Response(body, { status: init.status ?? 200, headers });
};
const answering = (answer: (request: { url: string; headers: Record<string, string> }) => Response | Promise<Response>): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    requests.push({ url, headers, redirect: init?.redirect });
    return answer({ url, headers });
  }) as typeof fetch;
const options = (fetcher: typeof fetch, tokens: string[] = ['tok-1']) => ({ tokens, maxBytes: MAX, cacheDir, fetch: fetcher, now: () => clock });

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-github-images-')));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  cacheDir = path.join(root, `cache-${Math.random().toString(36).slice(2)}`);
  requests = [];
  clock = 1_000_000;
});

describe('fetchGithubImage', () => {
  it('fetches the bytes from raw.githubusercontent.com with the credential and keeps a copy', async () => {
    const source = pinned(`https://github.com/o/r/blob/${SHA}/shots/a.png?raw=true`);
    const result = await fetchGithubImage(source, options(answering(() => image(PNG, { etag: '"v1"' }))));
    expect(result).toMatchObject({ ok: true, mime: 'image/png', size: PNG.byteLength });
    if (!result.ok) throw new Error('unreachable');
    expect(fs.readFileSync(result.file)).toEqual(PNG);
    expect(result.file.startsWith(cacheDir)).toBe(true);
    expect(requests).toEqual([{ url: `https://raw.githubusercontent.com/o/r/${SHA}/shots/a.png`, headers: { authorization: 'token tok-1' }, redirect: 'manual' }]);
    expect(JSON.stringify(result)).not.toContain('tok-1');
  });

  it('never follows a redirect, so the credential cannot leave GitHub', async () => {
    const source = pinned('https://raw.githubusercontent.com/o/r/main/a.png');
    const elsewhere = new Response(null, { status: 302, headers: { location: 'https://evil.example/collect' } });
    const result = await fetchGithubImage(source, options(answering(() => elsewhere)));
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.redirect).toBe('manual');
    expect(new URL(requests[0]!.url).host).toBe('raw.githubusercontent.com');
  });

  it('refuses an address off GitHub even when handed a parsed source', async () => {
    const source: GithubImageSource = { ...pinned('https://raw.githubusercontent.com/o/r/main/a.png'), fetchUrl: 'https://evil.example/o/r/main/a.png' };
    const result = await fetchGithubImage(source, options(answering(() => image(PNG))));
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(requests).toEqual([]);
    const http: GithubImageSource = { ...pinned('https://raw.githubusercontent.com/o/r/main/a.png'), fetchUrl: 'http://raw.githubusercontent.com/o/r/main/a.png' };
    expect(await fetchGithubImage(http, options(answering(() => image(PNG))))).toMatchObject({ ok: false, status: 400 });
    expect(requests).toEqual([]);
  });

  it('tries each of the user’s accounts in turn until one can read the repository', async () => {
    const source = pinned('https://raw.githubusercontent.com/o/private/main/a.png');
    const fetch = answering(({ headers }) => headers.authorization === 'token work' ? image(PNG) : new Response('404: Not Found', { status: 404 }));
    expect(await fetchGithubImage(source, options(fetch, ['personal', 'work']))).toMatchObject({ ok: true, mime: 'image/png' });
    expect(requests.map(r => r.headers.authorization)).toEqual(['token personal', 'token work']);
  });

  it('says what to do when no account can read it', async () => {
    const source = pinned('https://raw.githubusercontent.com/o/private/main/a.png');
    const notFound = answering(() => new Response('404: Not Found', { status: 404 }));
    expect(await fetchGithubImage(source, options(notFound, []))).toEqual({ ok: false, status: 404, error: 'Sign in to GitHub with gh to show private images' });
    expect(requests).toEqual([{ url: 'https://raw.githubusercontent.com/o/private/main/a.png', headers: {}, redirect: 'manual' }]);
    expect(await fetchGithubImage(source, options(notFound, ['tok-1']))).toEqual({ ok: false, status: 404, error: 'Not on GitHub, or your account cannot read it' });
    expect(await fetchGithubImage(source, options(answering(() => new Response(null, { status: 401 })), ['expired']))).toEqual({ ok: false, status: 403, error: 'GitHub refused the sign-in' });
  });

  it('shows only images, by what GitHub reports or by name when GitHub only says bytes', async () => {
    expect(await fetchGithubImage(pinned('https://raw.githubusercontent.com/o/r/main/a.png'), options(answering(() => image('<html>', { type: 'text/html; charset=utf-8' }))))).toEqual({ ok: false, status: 415, error: 'Only images are shown here' });
    expect(await fetchGithubImage(pinned('https://raw.githubusercontent.com/o/r/main/notes.txt'), options(answering(() => image('hi', { type: 'text/plain' }))))).toMatchObject({ ok: false, status: 415 });
    expect(await fetchGithubImage(pinned('https://raw.githubusercontent.com/o/r/main/shot.heic'), options(answering(() => image(PNG, { type: 'application/octet-stream' }))))).toMatchObject({ ok: true, mime: 'image/heic' });
    expect(await fetchGithubImage(pinned('https://raw.githubusercontent.com/o/r/main/archive.zip'), options(answering(() => image(PNG, { type: 'application/octet-stream' }))))).toMatchObject({ ok: false, status: 415 });
    // GitHub's word wins over the name.
    expect(await fetchGithubImage(pinned('https://raw.githubusercontent.com/o/r/main/photo'), options(answering(() => image(PNG, { type: 'image/jpeg' }))))).toMatchObject({ ok: true, mime: 'image/jpeg' });
  });

  it('keeps nothing over the size cap, declared or discovered', async () => {
    const big = Buffer.alloc(MAX + 1, 1);
    const declared = answering(() => image(big, { headers: { 'content-length': String(big.byteLength) } }));
    expect(await fetchGithubImage(pinned('https://raw.githubusercontent.com/o/r/main/big.png'), options(declared))).toEqual({ ok: false, status: 413, error: 'Image is too large to show' });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    expect(await fetchGithubImage(pinned('https://raw.githubusercontent.com/o/r/main/big2.png'), options(answering(() => image(stream))))).toMatchObject({ ok: false, status: 413 });
    expect(fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter(f => !f.endsWith('.json')) : []).toEqual([]);
  });

  it('serves a commit-addressed file from its copy without asking GitHub again', async () => {
    const source = pinned(`https://raw.githubusercontent.com/o/r/${SHA}/a.png`);
    const fetch = answering(() => image(PNG));
    await fetchGithubImage(source, options(fetch));
    clock += 10 * GITHUB_IMAGE_REVALIDATE_MS;
    expect(await fetchGithubImage(source, options(fetch))).toMatchObject({ ok: true, size: PNG.byteLength });
    expect(requests).toHaveLength(1);
  });

  it('asks GitHub whether a branch-addressed file changed, once a minute, by ETag', async () => {
    const source = pinned('https://raw.githubusercontent.com/o/r/main/a.png');
    const updated = Buffer.concat([PNG, Buffer.from('v2')]);
    let version = 1;
    const fetch = answering(({ headers }) => {
      if (version === 1) return headers['if-none-match'] === '"v1"' ? new Response(null, { status: 304 }) : image(PNG, { etag: '"v1"' });
      return headers['if-none-match'] === '"v2"' ? new Response(null, { status: 304 }) : image(updated, { etag: '"v2"' });
    });
    expect(await fetchGithubImage(source, options(fetch))).toMatchObject({ size: PNG.byteLength });
    // Within the minute: the copy, no request.
    clock += GITHUB_IMAGE_REVALIDATE_MS - 1;
    expect(await fetchGithubImage(source, options(fetch))).toMatchObject({ size: PNG.byteLength });
    expect(requests).toHaveLength(1);
    // After it: a conditional request, answered 304, and the clock on the copy restarts.
    clock += 1;
    expect(await fetchGithubImage(source, options(fetch))).toMatchObject({ size: PNG.byteLength });
    expect(requests).toHaveLength(2);
    expect(requests[1]!.headers['if-none-match']).toBe('"v1"');
    clock += 1;
    await fetchGithubImage(source, options(fetch));
    expect(requests).toHaveLength(2);
    // The branch moved: new bytes replace the copy.
    version = 2;
    clock += GITHUB_IMAGE_REVALIDATE_MS;
    const result = await fetchGithubImage(source, options(fetch));
    expect(result).toMatchObject({ ok: true, size: updated.byteLength });
    if (!result.ok) throw new Error('unreachable');
    expect(fs.readFileSync(result.file)).toEqual(updated);
  });

  it('shows the last copy when GitHub cannot be reached, and nothing when there is none', async () => {
    const source = pinned('https://raw.githubusercontent.com/o/r/main/a.png');
    const down = answering(() => { throw new TypeError('fetch failed'); });
    expect(await fetchGithubImage(source, options(down))).toEqual({ ok: false, status: 502, error: 'Could not reach GitHub' });
    await fetchGithubImage(source, options(answering(() => image(PNG))));
    clock += 2 * GITHUB_IMAGE_REVALIDATE_MS;
    expect(await fetchGithubImage(source, options(down))).toMatchObject({ ok: true, size: PNG.byteLength });
    expect(await fetchGithubImage(source, options(answering(() => new Response('bad gateway', { status: 502 }))))).toMatchObject({ ok: true, size: PNG.byteLength });
    // Access that went away is not papered over by a copy.
    expect(await fetchGithubImage(source, options(answering(() => new Response(null, { status: 404 }))))).toMatchObject({ ok: false, status: 404 });
  });

  it('downloads once for a card and its lightbox asking together', async () => {
    const source = pinned(`https://raw.githubusercontent.com/o/r/${SHA}/a.png`);
    const fetch = vi.fn(answering(() => image(PNG)));
    const results = await Promise.all([fetchGithubImage(source, options(fetch)), fetchGithubImage(source, options(fetch))]);
    expect(results.every(r => r.ok)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores a copy whose bytes went missing or changed size', async () => {
    const source = pinned(`https://raw.githubusercontent.com/o/r/${SHA}/a.png`);
    const fetch = answering(() => image(PNG));
    const first = await fetchGithubImage(source, options(fetch));
    if (!first.ok) throw new Error('unreachable');
    fs.writeFileSync(first.file, Buffer.alloc(3));
    expect(await fetchGithubImage(source, options(fetch))).toMatchObject({ ok: true, size: PNG.byteLength });
    expect(fs.readFileSync(first.file)).toEqual(PNG);
    fs.rmSync(first.file);
    expect(await fetchGithubImage(source, options(fetch))).toMatchObject({ ok: true, size: PNG.byteLength });
    expect(requests).toHaveLength(3);
  });
});
