/** Real composer and tRPC client against fake APIs. Sends no email and never opens a Home.
 * Run: pnpm exec tsx scripts/email-composer-browser-smoke.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser } from 'playwright-core';
import type { EmailDraft } from '@/db/types';

async function main() {
  const initial: EmailDraft = { version: 1, revision: 0, status: 'draft', connectionId: 'gmail', to: 'alex@example.com', cc: '', bcc: '', subject: 'Friday project update', body: 'Hi Alex,\n\nThe new dashboard is ready for review. Can we walk through it on Friday?\n\nThanks,\nSam', error: null, fromLabel: null, sentAt: null, messageId: null };
  const source = `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import {EmailComposer} from './src/components/chat-ui/email/email-composer';
    function Fixture() {
      const [draft, setDraft] = useState(${JSON.stringify(initial)});
      window.receiveEmailDraft = setDraft;
      return <><p className="mb-3 text-sm text-muted-foreground">I drafted the email. You can edit it here and send it when ready.</p><EmailComposer id="draft" sessionId="chat" initial={draft}/></>;
    }
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Fixture/></QueryClientProvider>);
  `;
  const bundle = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', tsconfig: 'tsconfig.json', define: { 'process.env': '{"NODE_ENV":"production"}' } });
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const appCss = (await fs.readFile('src/app/globals.css', 'utf8')).replace(/@import ['"]tailwindcss['"];/, '@import "tailwindcss" source(none);\n@source "../components";');
  const { css } = await postcss([tailwind()]).process(appCss, { from: path.resolve('src/app/globals.css') });
  const executablePath = [process.env.RI_BROWSER_EXECUTABLE, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find((file): file is string => Boolean(file && existsSync(file)));
  assert(executablePath, 'Install a Chromium browser or set RI_BROWSER_EXECUTABLE');
  const server = createServer((request, response) => {
    if (request.url === '/app.js') { response.setHeader('content-type', 'application/javascript'); response.end(bundle.outputFiles[0].text); }
    else if (request.url === '/app.css') { response.setHeader('content-type', 'text/css'); response.end(css); }
    else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><main id="root" style="max-width:680px;margin:32px auto;padding:16px"></main><script src="/app.js"></script></body></html>'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const output = path.resolve('.work/email-composer'); await fs.mkdir(output, { recursive: true });
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript({ content: "localStorage.setItem('ri.client.apiTransport', 'http');" });
      let draft = { ...initial };
      let sendCount = 0;
      let heldUpdate: (() => void) | undefined;
      let holdNextUpdate = false;
      await page.route('**/api/trpc/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const procedure = url.pathname.split('/').at(-1)!;
        const input = request.method() === 'GET' ? JSON.parse(url.searchParams.get('input') ?? '{}') : request.postDataJSON();
        const reply = (data: unknown) => route.fulfill({ json: { result: { data } } });
        if (procedure === 'email.accounts') return reply([{ id: 'gmail', provider: 'google', label: 'sam@example.com' }, { id: 'outlook', provider: 'microsoft', label: 'sam@work.example.com' }]);
        if (procedure === 'email.get') return reply({ id: 'draft', sessionId: 'chat', draft });
        if (procedure === 'email.update') {
          if (holdNextUpdate) { holdNextUpdate = false; await new Promise<void>(resolve => { heldUpdate = resolve; }); }
          if (input.expectedRevision !== draft.revision) return route.fulfill({ status: 409, json: { error: { message: 'This email changed. Review the latest draft', code: -32009, data: { code: 'CONFLICT', httpStatus: 409, path: procedure } } } });
          draft = { ...draft, ...input.patch, revision: draft.revision + 1 };
          return reply({ id: 'draft', sessionId: 'chat', draft });
        }
        if (procedure === 'email.send') {
          assert.equal(input.expectedRevision, draft.revision);
          sendCount++;
          draft = { ...draft, revision: draft.revision + 2, status: 'sent', fromLabel: 'sam@work.example.com', sentAt: '2026-10-18T15:30:00Z' };
          // The provider accepted it but the browser lost its response. Recovery must read, not resend.
          return route.abort('failed');
        }
        throw new Error(`Unexpected API call: ${procedure}`);
      });
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.getByLabel('Message', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Cc', exact: true }).click();
      await page.getByRole('button', { name: 'Bcc', exact: true }).click();
      await page.getByLabel('Cc', { exact: true }).fill('team@example.com');
      await page.getByLabel('Bcc', { exact: true }).fill('private@example.com');
      await page.getByLabel('From', { exact: true }).selectOption('outlook');
      await page.getByLabel('Message', { exact: true }).fill('A human edited this message.');
      await page.getByText('Saved', { exact: true }).waitFor();
      assert.equal(draft.bcc, 'private@example.com');
      assert.equal(draft.connectionId, 'outlook');
      holdNextUpdate = true;
      await page.getByLabel('Message', { exact: true }).fill('Keep this human edit');
      await page.waitForFunction(() => document.body.textContent?.includes('Saving…'));
      assert(heldUpdate);
      draft = { ...draft, revision: draft.revision + 1, subject: 'Updated by AI', body: 'New AI body' };
      await page.evaluate(value => (window as unknown as { receiveEmailDraft: (value: EmailDraft) => void }).receiveEmailDraft(value), draft);
      heldUpdate();
      await page.getByText('This draft changed while you were editing. Your edits are kept here.', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('Message', { exact: true }).inputValue(), 'Keep this human edit');
      assert.equal(await page.getByLabel('Subject', { exact: true }).inputValue(), 'Updated by AI');
      await page.getByRole('button', { name: 'Keep my edits', exact: true }).click();
      await page.getByText('Saved', { exact: true }).waitFor();
      assert.equal(draft.body, 'Keep this human edit');
      assert.equal(draft.subject, 'Updated by AI');
      assert.equal(await page.locator('body').evaluate(element => element.scrollWidth > window.innerWidth + 1), false, `Overflow at ${width}px`);
      await page.screenshot({ path: path.join(output, `composer-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('heading', { name: 'Email sent', exact: true }).waitFor();
      assert.equal(sendCount, 1);
      assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).count(), 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(output, `sent-${width}.png`), fullPage: true });
      await page.close();
      console.log(`Email composer: editing, AI conflict, Cc/Bcc, account selection and lost-send recovery passed at ${width}px`);
    }
  } finally {
    await browser?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
