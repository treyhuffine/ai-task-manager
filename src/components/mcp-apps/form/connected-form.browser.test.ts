/**
 * A server's form, filled by a person: the real component, real Tailwind CSS
 * and Bits & Bolts' real forms, in Chromium. The Home is a fixture that
 * records each answer. Screenshots land in `RI_FORM_SHOTS` when it is set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { bitsAndBoltsForms } from '@/test/fixtures/bits-and-bolts-forms';

const ids = {
  review: '01900aaa-0000-7000-8000-000000000001', pick: '01900aaa-0000-7000-8000-000000000002', implicit: '01900aaa-0000-7000-8000-000000000003',
  local: '01900aaa-0000-7000-8000-000000000004', reference: '01900aaa-0000-7000-8000-000000000005',
};
const chatId = '01900bbb-0000-7000-8000-000000000001';
const form = (id: string, message: string, schema: unknown, extra: Record<string, unknown> = {}) => ({
  id, app: 'Bits & Bolts', serverId: 'bb', message, schema, status: 'open', expiresAt: Date.now() + 60_000, place: 'chat', chatId, viewId: null, local: false, folders: [], ...extra,
});
const forms: Record<string, ReturnType<typeof form>> = {
  [ids.review]: form(ids.review, 'Review M6 hex bolt', bitsAndBoltsForms.reviewForm),
  [ids.pick]: form(ids.pick, 'Choose a CAD part', bitsAndBoltsForms.pickFile),
  [ids.implicit]: form(ids.implicit, 'Choose CAD references', bitsAndBoltsForms.pickReferences('implicit')),
  [ids.local]: form(ids.local, 'Choose CAD references', bitsAndBoltsForms.pickReferences('single'), { local: true, folders: [{ label: 'Parts', uri: 'file:///Users/me/parts' }] }),
  [ids.reference]: form(ids.reference, 'M6 hex bolt: A fastener for the main joint.\n\nM6 washer: Spreads the load.', bitsAndBoltsForms.reference),
};
const answers: { formId: string; answer: { action: string; content?: unknown } }[] = [];
const shots = process.env.RI_FORM_SHOTS;

let server: http.Server, browser: Browser, origin = '';
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import {ConnectedForm} from '@/components/mcp-apps/form/connected-form';
    const formId = new URL(location.href).searchParams.get('form');
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
      <div style={{width: 560, padding: 16}}><p className="text-sm">Here is what Bits & Bolts needs:</p><ConnectedForm formId={formId}/></div>
    </QueryClientProvider>);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' } });
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    const reply = (data: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result: { data } })); };
    if (url.pathname.startsWith('/api/trpc/')) {
      const method = url.pathname.slice('/api/trpc/'.length);
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const input = req.method === 'GET' ? JSON.parse(url.searchParams.get('input') ?? '{}') : JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (method === 'connectedApps.forms.get') return reply(forms[input.formId]);
      if (method === 'connectedApps.forms.answer') {
        answers.push(input);
        forms[input.formId] = { ...forms[input.formId]!, status: input.answer.action === 'accept' ? 'accepted' : 'declined' };
        return reply({ status: forms[input.formId]!.status, errors: {} });
      }
      if (method === 'connectedApps.forms.file') return reply({ uri: `file:///Users/me/parts/${input.pick.path}`, name: path.basename(input.pick.path) });
      if (method === 'connectedApps.forms.preview') return reply({ contents: [{ uri: input.uri, mimeType: 'text/markdown', text: '# M6 hex bolt\n\nA fastener for the main joint.' }] });
      if (method === 'transport.capabilities') return reply({ websocket: false });
      res.statusCode = 500; res.end(`Unexpected ${method}`); return;
    }
    if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0]!.text); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('content-type', 'text/css'); res.end(css.css); return; }
    res.setHeader('content-type', 'text/html'); res.end('<html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true });
}, 60_000);
afterAll(async () => { await browser?.close(); server?.closeAllConnections(); await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()); });

async function open(formId: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 640, height: 1000 } });
  await page.goto(`${origin}/?form=${formId}`);
  await page.getByText('Bits & Bolts is asking').waitFor();
  return page;
}
const shot = async (page: Page, name: string) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true }); } };
const lastAnswer = () => answers.at(-1)!;

describe('a server form in Ri', () => {
  it('fills the review form: a default, an enum, suggestions on a string and on a list, a switch and a bounded number', async () => {
    const page = await open(ids.review);
    await shot(page, 'review-form');
    await page.getByRole('button', { name: 'Submit' }).click();
    // Nothing reaches the Home until the answer is valid, and each field says what it needs.
    await expect.poll(() => page.getByRole('alert').allTextContents()).toEqual(expect.arrayContaining(['This is required.']));
    expect(answers.filter(a => a.formId === ids.review)).toHaveLength(0);
    await page.getByRole('radio', { name: 'high' }).click();
    await page.getByRole('button', { name: 'Prototype' }).click();
    await page.getByRole('button', { name: 'Clearance' }).click();
    await page.getByLabel('Add to Checks').fill('custom-gasket');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('switch', { name: 'Ready for review' }).click();
    await page.getByLabel('Tolerance (mm)').fill('12');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect.poll(() => page.getByRole('alert').allTextContents()).toEqual(['Use 10 or less.']);
    await page.getByLabel('Tolerance (mm)').fill('0.5');
    await shot(page, 'review-form-filled');
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.getByText('Sent.').waitFor();
    expect(lastAnswer()).toEqual({ formId: ids.review, answer: { action: 'accept', content: {
      reference: 'cad://parts/hex-bolt', priority: 'high', purpose: 'prototype', checks: ['clearance', 'custom-gasket'], approved: true, tolerance: 0.5,
    } } });
    await page.close();
  });

  it('shows every option as an image once one has a thumbnail, with a fallback for the rest', async () => {
    const page = await open(ids.pick);
    const options = page.getByRole('radio');
    await expect.poll(() => options.count()).toBe(2);
    expect(await page.locator('img').count()).toBe(1);
    await expect.poll(() => page.getByText('Spreads the load.').isVisible()).toBe(true);
    await shot(page, 'pick-file-thumbnails');
    await page.getByRole('radio', { name: /M6 washer/ }).click();
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.getByText('Sent.').waitFor();
    expect(lastAnswer()).toEqual({ formId: ids.pick, answer: { action: 'accept', content: { part: 'washer' } } });
    await page.close();
  });

  it('keeps every item of an implicit selection until the person removes it, and previews a linked resource', async () => {
    const page = await open(ids.implicit);
    await page.getByRole('button', { name: 'Preview M6 hex bolt' }).click();
    await page.getByRole('dialog').getByText('A fastener for the main joint.', { exact: false }).last().waitFor();
    await shot(page, 'implicit-preview');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Remove M6 washer' }).click();
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.getByText('Sent.').waitFor();
    expect(lastAnswer()).toEqual({ formId: ids.implicit, answer: { action: 'accept', content: { references: ['cad://parts/hex-bolt'] } } });
    await page.close();
  });

  it('adds a file from the chat\'s agent folder for a server on this computer', async () => {
    const page = await open(ids.local);
    await page.getByLabel('File path inside it').fill('bracket.step');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByText('bracket.step', { exact: true }).waitFor();
    await shot(page, 'local-file');
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.getByText('Sent.').waitFor();
    expect(lastAnswer()).toEqual({ formId: ids.local, answer: { action: 'accept', content: { references: 'file:///Users/me/parts/bracket.step' } } });
    await page.close();
  });

  it('shows a message-only form with OK and Decline', async () => {
    const page = await open(ids.reference);
    await page.getByText('Spreads the load.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Decline' }).click();
    await page.getByText('Declined.').waitFor();
    expect(lastAnswer()).toEqual({ formId: ids.reference, answer: { action: 'decline' } });
    await page.close();
  });
});
