import http from 'node:http';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

// Real React effects and Tiptap node views. Run through pnpm iso with
// `env RI_SPACES_BROWSER_TEST=1 pnpm -s vitest run ...browser.test.ts`.
const enabled = process.env.RI_SPACES_BROWSER_TEST === '1';
let browser: Browser;
let server: http.Server;
let address: string;
beforeAll(async () => {
  if (!enabled) return;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, { useState, useMemo } from 'react';
      import { createRoot } from 'react-dom/client';
      import { useSharedBodyFor } from './src/components/team/shared-body-editor';
      import { RichEditor } from './src/components/editor/rich-editor';
      import { TipProvider } from './src/components/ui/tip';
      import { PublishedResultList } from './src/components/spaces/published-results';
      import { setAuthToken } from './src/lib/api/client';
      window.requests = [];
      let release;
      const waiting = new Promise(resolve => { release = resolve; });
      function App() {
        const [id, setId] = useState('A');
        const target = useMemo(() => ({
          draftKey: 'review:' + id, toEditor: body => body,
          write: async input => {
            window.requests.push({ id, ...input });
            if (window.requests.length === 1) await waiting;
            return { body: input.body, bodyRevision: input.expectedBodyRevision + 1 };
          }
        }), [id]);
        const shared = useSharedBodyFor({ id, body: '', bodyRevision: 0 }, target);
        window.review = { ready: shared.ready, status: shared.status, edit: shared.edit, switchDocument: () => setId('B'), changeIdentity: () => setAuthToken('replacement-fixture-identity'), release };
        return <TipProvider><RichEditor content="[[file:team-file.txt]]" editable={false}
          attachmentStore={{ upload: async () => { throw Error('unused'); }, url: name => '/api/space/team-123/attachments/' + name }} />
          <PublishedResultList results={[{ id: 'result', createdAt: '2026-10-12', author: null, links: [],
            summary: '![Published image](/api/attachments/team-image.png)\\n\\n[[file:team-file.txt]]',
            attachments: [{ fileName: 'team-file.txt', originalName: 'trace.txt', mimeType: 'text/plain', size: 4, uploadedAt: '2026-10-12' },
              { fileName: 'team-image.png', originalName: 'image.png', mimeType: 'image/png', size: 10, uploadedAt: '2026-10-12' }] }]}
            fileUrl={name => '/api/space/team-123/attachments/' + name} />
          </TipProvider>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': '{"NODE_ENV":"development"}' }, loader: { '.css': 'empty' },
  });
  server = http.createServer((req, res) => {
    res.setHeader('content-type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
}, 90_000);
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

it.skipIf(!enabled)('keeps pending autosaves bound to their document after switching', async () => {
  const page = await browser.newPage();
  page.on('pageerror', err => console.error(err));
  page.setDefaultTimeout(8_000);
  try {
    await page.goto(address);
    await page.waitForFunction('window.review?.ready');
    await page.evaluate('window.review.edit("first")');
    await page.waitForFunction('window.requests.length === 1');
    await page.evaluate('window.review.edit("second"); window.review.switchDocument()');
    await page.waitForTimeout(100);
    await page.evaluate('window.review.release()');
    await page.waitForFunction('window.requests.length === 2');
    expect(await page.evaluate('window.requests.map(r => ({ id: r.id, body: r.body }))')).toEqual([
      { id: 'A', body: 'first' }, { id: 'A', body: 'second' },
    ]);
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('resolves file markers through the shared editor attachment store', async () => {
  const page = await browser.newPage();
  page.on('pageerror', err => console.error(err));
  page.setDefaultTimeout(8_000);
  try {
    await page.goto(address);
    const link = page.locator('a[download="team-file.txt"]');
    await link.waitFor();
    expect(await link.getAttribute('href')).toBe('/api/space/team-123/attachments/team-file.txt');
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('retains a draft without sending it as a replacement sign-in', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(address);
    await page.waitForFunction('window.review?.ready');
    await page.evaluate('window.review.edit("Original author draft"); window.review.changeIdentity()');
    await page.waitForFunction('window.review.status.status === "failed"');
    expect(await page.evaluate('window.requests')).toEqual([]);
    expect(await page.evaluate('JSON.parse(localStorage.getItem("review:A")).body')).toBe('Original author draft');
  } finally { await page.close(); }
}, 20_000);

it.skipIf(!enabled)('renders published summary images and file markers from their team', async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(8_000);
  try {
    await page.goto(address);
    const image = page.locator('img[alt="Published image"]');
    await image.waitFor({ state: 'attached' });
    expect(await image.getAttribute('src')).toBe('/api/space/team-123/attachments/team-image.png');
    const chip = page.getByRole('button', { name: /trace\.txt/ });
    const request = page.waitForRequest(req => req.url().endsWith('/api/space/team-123/attachments/team-file.txt'));
    await chip.click();
    await request;
    expect(await page.locator('body').innerText()).not.toContain('[[file:team-file.txt]]');
  } finally { await page.close(); }
}, 30_000);
