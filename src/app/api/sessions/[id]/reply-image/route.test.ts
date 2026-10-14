import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { githubImageCacheDir } from '@/lib/github/repo-image';

/**
 * A GitHub repository image in a reply loads through the home with the user's
 * credential, only when this chat's agent wrote that exact address, and the
 * credential reaches GitHub alone. The database is real; GitHub and the
 * credential are stubbed.
 */

const TEST_DB = path.join(os.tmpdir(), `ri-reply-image-route-${process.pid}.db`);
const SHA = 'c5d8ea2ecf8587bc5ae8d570fe96f5220e25cf36';
const GITHUB = `https://github.com/InsiderFinance/insiderfinance-app/blob/${SHA}/459/after-overview.jpg?raw=true`;
const RAW = `https://raw.githubusercontent.com/InsiderFinance/insiderfinance-app/${SHA}/459/after-overview.jpg`;
let JPEG: Buffer;

const requests: { url: string; authorization: string | null }[] = [];
const tokens: string[] = [];
let folder: string;

vi.mock('@/lib/github/credentials', () => ({
  cachedGithubTokens: async () => [...tokens],
}));

beforeAll(async () => {
  JPEG = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#4a90d9' } }).jpeg().toBuffer();
});

beforeEach(async () => {
  requests.length = 0;
  tokens.length = 0;
  tokens.push('gho_secret');
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-reply-image-folder-'));
  // A commit-addressed copy is final, so each test starts without one.
  fs.rmSync(githubImageCacheDir(), { recursive: true, force: true });
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
  process.env.RI_DB_PATH = TEST_DB;
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const authorization = new Headers(init?.headers).get('authorization');
    requests.push({ url, authorization });
    if (url === RAW && authorization === 'token gho_secret') return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg', etag: '"v1"' } });
    return new Response('404: Not Found', { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(folder, { recursive: true, force: true });
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
});

async function seed(reply: string) {
  const q = await import('@/lib/db/queries');
  const ws = q.createWorkspace({ name: 'insiderfinance-app', cwd: folder, isGit: false, filesToCopy: [], status: 'active' });
  const chat = q.createChatSession({ type: 'orchestration', workspaceId: ws.id, harness: 'claude', status: 'active' });
  q.insertChatEvent({ sessionId: chat.id, role: 'assistant', source: 'agent', content: reply, createdAt: new Date().toISOString() });
  return chat;
}

async function get(sessionId: string, target: string, thumbnail = false) {
  const { GET } = await import('./route');
  const search = new URLSearchParams({ path: target });
  if (thumbnail) search.set('thumbnail', '1');
  const request = new NextRequest(`http://127.0.0.1/api/sessions/${sessionId}/reply-image?${search}`);
  return GET(request, { params: Promise.resolve({ id: sessionId }) });
}

describe('GET /api/sessions/:id/reply-image for a GitHub repository image', () => {
  it('serves the image the agent showed, fetched from GitHub with the credential, like a local one', async () => {
    const chat = await seed(`Before and after:\n\n![Guide overview](${GITHUB})`);
    const response = await get(chat.id, GITHUB);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(JPEG);
    expect(requests).toEqual([{ url: RAW, authorization: 'token gho_secret' }]);
    // Nothing about the credential reaches the browser.
    for (const [, value] of response.headers) expect(value).not.toContain('gho_secret');
  });

  it('makes a thumbnail of it, and answers 304 to a browser that has one', async () => {
    const chat = await seed(`![Guide overview](${GITHUB})`);
    const thumbnail = await get(chat.id, GITHUB, true);
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get('content-type')).toBe('image/webp');
    const etag = thumbnail.headers.get('etag');
    expect(etag).toMatch(/^".+"$/);
    const { GET } = await import('./route');
    const again = await GET(new NextRequest(`http://127.0.0.1/api/sessions/${chat.id}/reply-image?path=${encodeURIComponent(GITHUB)}&thumbnail=1`, { headers: { 'if-none-match': etag! } }), { params: Promise.resolve({ id: chat.id }) });
    expect(again.status).toBe(304);
    // A commit-addressed file is final: one download served both.
    expect(requests).toHaveLength(1);
  });

  it('refuses an address the agent never wrote, before any credential is used', async () => {
    const chat = await seed('No images in this reply.');
    const response = await get(chat.id, GITHUB);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Only GitHub images this chat's agent showed in a reply are shown." });
    expect(requests).toEqual([]);
    // A different file in the same repository is a different address.
    const other = await get(chat.id, GITHUB.replace('after-overview', 'before-overview'));
    expect(other.status).toBe(403);
    expect(requests).toEqual([]);
  });

  it("says why when the user's accounts cannot read it, and the card can still open GitHub", async () => {
    const chat = await seed(`![Guide overview](${GITHUB})`);
    tokens.length = 0;
    tokens.push('gho_other');
    const response = await get(chat.id, GITHUB);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not on GitHub, or your account cannot read it' });
    tokens.length = 0;
    const signedOut = await get(chat.id, GITHUB);
    expect(signedOut.status).toBe(404);
    expect(await signedOut.json()).toEqual({ error: 'Sign in to GitHub with gh to show private images' });
    expect(requests.map(r => r.authorization)).toEqual(['token gho_other', null]);
  });

  it('still serves a local image from the chat folder, and 404s an unknown chat', async () => {
    fs.writeFileSync(path.join(folder, 'shot.jpg'), JPEG);
    const chat = await seed('Local: shot.jpg');
    const local = await get(chat.id, 'shot.jpg');
    expect(local.status).toBe(200);
    expect(local.headers.get('content-type')).toBe('image/jpeg');
    expect(requests).toEqual([]);
    const missing = await get('no-such-chat', GITHUB);
    expect(missing.status).toBe(404);
    expect(requests).toEqual([]);
  });
});
