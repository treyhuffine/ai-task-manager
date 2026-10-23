/** Exercise the real gallery and its isolated production-component fixtures without a Home.
 * Run pnpm exec tsx scripts/chat-ui-gallery-browser-smoke.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import path from 'node:path';
import { chromium, type Frame } from 'playwright-core';
import { buildChatUiGallery } from './build-chat-ui-gallery';
import { CHAT_UI_EXAMPLES } from '@/components/chat-ui/gallery/catalog';

async function waitForText(frame: Frame, value: string) {
  try { await frame.getByText(value, { exact: true }).waitFor(); await settleAnimations(frame); }
  catch (error) {
    console.error('Preview content:', (await frame.locator('[data-gallery-example], [role="dialog"]').allInnerTexts()).join('\n').slice(0, 8000));
    console.error('Focused control:', await frame.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') })));
    throw error;
  }
}

async function settleAnimations(frame: Frame) {
  // Fixtures enter with the same card/dialog animations as the app. Wait in
  // their document so a click cannot land between animation and resize frames.
  await frame.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished));
  });
}
async function htmlCardReady(frame: Frame) {
  // Artifact thumbnails mount only near the viewport. Selecting an example
  // in the tall sidebar can scroll its preview away before this wait starts.
  await (await frame.frameElement()).scrollIntoViewIfNeeded();
  await frame.getByRole('button', { name: 'Open HTML: review-plan.html', exact: true }).scrollIntoViewIfNeeded();
  // Capture is bounded and may deliberately fall back to the full preview.
  // The interaction below still opens that document and exercises its script.
  try { await frame.getByTitle('Thumbnail: review-plan.html').or(frame.getByText('Open to preview', { exact: true })).waitFor(); }
  catch (error) {
    console.error('HTML card state:', await frame.locator('body').innerText());
    console.error('HTML card DOM:', await frame.locator('[data-artifact-card]').evaluate(button => button.parentElement?.outerHTML));
    throw error;
  }
}

async function main() {
  const focusedExample = process.argv.find(argument => argument.startsWith('--example='))?.slice('--example='.length);
  if (focusedExample) assert(CHAT_UI_EXAMPLES.some(example => example.id === focusedExample), 'Choose a known gallery example');
  if (!process.argv.includes('--skip-build')) await buildChatUiGallery();
  const source = `import React from 'react';import{createRoot}from'react-dom/client';import{ChatUiGallery}from'./src/components/chat-ui/gallery/gallery';import{TipProvider}from'./src/components/ui/tip';createRoot(document.getElementById('root')).render(<TipProvider><ChatUiGallery/></TipProvider>);`;
  const bundle = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, jsx: 'automatic', platform: 'browser', define: { 'process.env': '{"NODE_ENV":"production"}' }, plugins: [{ name: 'fixture-link', setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'gallery-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'gallery-test' }, () => ({ contents: 'import{createElement}from"react";export default function Link(props){return createElement("a",props)}', loader: 'js', resolveDir: process.cwd() }));
  } }] });
  const css = (await fs.readFile('public/chat-ui-gallery/email.html', 'utf8')).match(/<style>([\s\S]*?)<\/style>/)![1];
  const server = createServer(async (request, response) => {
    if (request.url?.startsWith('/chat-ui-gallery/')) {
      const file = path.basename(new URL(request.url, 'http://localhost').pathname);
      if (!CHAT_UI_EXAMPLES.some(example => `${example.id}.html` === file)) { response.writeHead(404); response.end(); return; }
      response.setHeader('content-type', 'text/html'); response.end(await fs.readFile(path.join('public/chat-ui-gallery', file))); return;
    }
    if (request.url === '/app.js') { response.setHeader('content-type', 'application/javascript'); response.end(bundle.outputFiles[0].text); return; }
    if (request.url?.startsWith('/api/')) { response.writeHead(500); response.end('No real API is available in this test'); return; }
    response.setHeader('content-type', 'text/html'); response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const executablePath = [process.env.RI_BROWSER_EXECUTABLE, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find((file): file is string => Boolean(file && existsSync(file)));
  assert(executablePath, 'Install Chromium or set RI_BROWSER_EXECUTABLE');
  const browser = await chromium.launch({ executablePath, headless: true });
  const output = path.resolve('.work/chat-ui-gallery'); await fs.mkdir(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [], realRequests: string[] = [], diagnostics: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('Gallery browser error:', error.message); });
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) realRequests.push(request.url()); });
    await page.exposeFunction('galleryDiagnostic', (message: string) => { diagnostics.push(message); console.error('Gallery fixture error:', message); });
    await page.addInitScript(() => window.addEventListener('message', event => { if (event.data?.type === 'ri-chat-gallery-diagnostic') (window as unknown as { galleryDiagnostic(message: string): void }).galleryDiagnostic(event.data.message); }));
    await page.goto(`http://127.0.0.1:${address.port}/gallery`);

    async function select(id: string, state?: string) {
      const example = CHAT_UI_EXAMPLES.find(example => example.id === id)!;
      if (await page.getByRole('button', { name: example.name, exact: false }).isVisible()) await page.getByRole('button', { name: example.name, exact: false }).click();
      else await page.getByLabel('Select an example').selectOption(id);
      if (state) await page.getByLabel('Example state').selectOption(state);
      const handle = await page.getByTitle(`${example.name} interactive example`).elementHandle();
      assert(handle);
      const frame = await handle.contentFrame(); assert(frame);
      await frame.locator(`[data-gallery-example="${id}"][data-gallery-state="${state ?? example.states[0].id}"]`).waitFor();
      await page.getByRole('status').filter({ hasText: 'Opening example' }).waitFor({ state: 'hidden' });
      await frame.waitForLoadState('load');
      await settleAnimations(frame);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      return frame;
    }
    async function exerciseSharedChat() {
      let frame = await select('shared-chat');
      await frame.getByRole('textbox', { name: 'Example shared message', exact: true }).fill('A message in the shared example');
      await frame.getByRole('button', { name: 'Model and settings: Balanced example', exact: true }).click();
      await settleAnimations(frame);
      await frame.getByRole('option', { name: 'Fast example', exact: true }).click();
      try { await frame.getByRole('button', { name: 'Model and settings: Fast example', exact: true }).waitFor(); }
      catch (error) {
        console.error('Shared model state:', await frame.locator('body').innerText());
        await page.screenshot({ path: path.join(output, 'shared-model-failure.png'), fullPage: true });
        throw error;
      }
      await frame.getByRole('button', { name: 'Send example', exact: true }).click();
      await waitForText(frame, 'A message in the shared example');
      frame = await select('shared-chat', 'off');
      assert.equal(await frame.getByRole('textbox', { name: 'Example shared message', exact: true }).isEditable(), false);
      await waitForText(frame, 'I can review the release note.');
    }
    async function exerciseChatMessages() {
      let frame = await select('chat-messages');
      await frame.getByRole('link', { name: 'Request from Prepare the runner handoff in Research agent. Open chat', exact: true }).waitFor();
      const sentLink = frame.getByRole('link', { name: 'Sent to Review date handling in Research agent. Open chat', exact: true });
      assert.equal(await sentLink.getAttribute('href'), '/?session=019a0000-0000-7000-8000-000000000005&message=gallery-received&history=1');
      assert.equal(await frame.getByText('Request ID:', { exact: false }).count(), 0, 'Transport wrapper stays out of the visible message');
      frame = await select('chat-messages', 'reply');
      await frame.getByRole('link', { name: 'Reply from Review date handling in Research agent. Open chat', exact: true }).waitFor();
      await frame.getByText('Original request', { exact: true }).click();
      await frame.getByText('Please review the date handling', { exact: false }).first().waitFor();
      frame = await select('chat-messages', 'deleted');
      await frame.getByText('Deleted chat', { exact: true }).waitFor();
      assert.equal(await frame.getByRole('link', { name: /^Request from/ }).count(), 0, 'Deleted sender is not a broken link');
    }
    async function exerciseCoordination() {
      const failure = await select('coordination', 'forward-failed');
      await failure.getByLabel('Shared message delivery', {exact:true}).waitFor();
      await failure.getByText('Send failed', {exact:true}).waitFor();
      assert.equal(await failure.getByText(/Approval allows this send/).count(), 0);
      assert((await failure.getByRole('link', {name:/Destination/}).getAttribute('href'))?.includes('message=gallery-coordination-event'));
      await page.screenshot({path:path.join(output, `coordination-forward-failed-${page.viewportSize()!.width}.png`),fullPage:true});
      let frame = await select('coordination', 'approval');
      await frame.getByRole('button', { name: 'Allow once', exact: true }).click();
      await waitForText(frame, 'Authorized and queued');
      await page.getByRole('button', { name: 'Reset example', exact: true }).click();
      frame = await select('coordination', 'approval');
      await frame.getByRole('button', { name: 'Deny', exact: true }).click();
      await waitForText(frame, 'The receiving work was not started');
      await page.getByRole('button', { name: 'Reset example', exact: true }).click();
      frame = await select('coordination', 'approval');
      await frame.getByRole('button', { name: 'Always allow in this chat', exact: true }).click();
      await frame.getByRole('button', { name: 'Coordination: Allow automatically', exact: true }).waitFor();

      frame = await select('coordination', 'held');
      const release = frame.getByRole('button', { name: /Release Hold/ });
      assert.equal(await release.getAttribute('aria-pressed'), 'true');
      await release.click();
      await frame.getByRole('button', { name: 'Hold this chat', exact: true }).waitFor();
      await waitForText(frame, 'Hold released. No real agent started');
      await frame.getByRole('button', { name: /^Coordination:/ }).click();
      await frame.getByLabel('Coordination for chat', { exact: true }).selectOption('allow');
      await frame.getByText('Effective setting: Allow automatically, from chat.', { exact: true }).waitFor();
      await frame.getByRole('button', { name: /^Coordination:/ }).click();

      frame = await select('coordination', 'long');
      await frame.getByText('Show full message', { exact: true }).click();
      await frame.getByText('Collapse message', { exact: true }).waitFor();
      assert(await frame.locator('details').evaluate(element => element.hasAttribute('open')));
      await frame.getByText('Collapse message', { exact: true }).click();
      assert.equal(await frame.locator('details').evaluate(element => element.hasAttribute('open')), false);

      frame = await select('coordination', 'shared');
      await frame.getByRole('button', { name: 'Send to chat', exact: true }).click();
      let dialog = frame.getByRole('dialog');
      await dialog.getByLabel('Search chats', { exact: true }).fill('no matching chat');
      await dialog.getByText('No matching chats.', { exact: true }).waitFor();
      await dialog.getByLabel('Search chats', { exact: true }).fill('date');
      await dialog.getByLabel('Filter by agent', { exact: true }).selectOption('019a0000-0000-7000-8000-000000000003');
      await dialog.getByRole('button', { name: /^Review date handling/ }).click();
      assert.equal(await dialog.getByRole('button', { name: /^Model and settings:/ }).count(), 0, 'Existing destinations keep their model settings');
      await dialog.getByRole('textbox', { name: 'Your directions, optional', exact: true }).fill('Compare the full review with your implementation.');
      await page.screenshot({ path: path.join(output, `coordination-forward-existing-${page.viewportSize()!.width}.png`), fullPage: true });
      await dialog.getByRole('button', { name: 'Send to chat', exact: true }).click();
      await waitForText(frame, 'Example message shared. No real chat was created');
      await dialog.waitFor({ state: 'detached' });

      await frame.getByRole('button', { name: 'Send to chat', exact: true }).click();
      dialog = frame.getByRole('dialog');
      await dialog.getByLabel('New chat', { exact: true }).check();
      await dialog.getByLabel('Filter by agent', { exact: true }).selectOption('019a0000-0000-7000-8000-000000000003');
      await dialog.getByRole('button', { name: /^Model and settings: Example claude model/ }).click();
      await frame.getByRole('option', { name: 'Example codex model', exact: true }).click();
      await dialog.getByRole('button', { name: /^Model and settings: Example codex model/ }).click();
      await frame.getByRole('button', { name: 'Effort: Medium', exact: true }).click();
      await frame.getByRole('menuitemradio', { name: /^High/ }).click();
      await dialog.getByRole('button', { name: /^Model and settings: Example codex model, High effort/ }).waitFor();
      await frame.waitForFunction(() => !document.querySelector('[data-slot="popover-content"]'));
      await page.screenshot({ path: path.join(output, `coordination-forward-new-${page.viewportSize()!.width}.png`), fullPage: true });
      await dialog.getByRole('button', { name: 'Send to chat', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
    }
    for (const example of CHAT_UI_EXAMPLES.filter(example => !focusedExample || example.id === focusedExample)) {
      for (const state of example.states) {
        const frame = await select(example.id, state.id);
        assert((await frame.locator('body').innerText()).trim().length > 0, `${example.id}/${state.id} rendered`);
      }
      console.log(`Rendered ${example.id} in all states`);
    }
    if (focusedExample) {
      if (focusedExample === 'shared-chat') await exerciseSharedChat();
      if (focusedExample === 'chat-messages') await exerciseChatMessages();
      if (focusedExample === 'coordination') {
        await exerciseCoordination();
        await page.setViewportSize({ width: 390, height: 1050 });
        await exerciseCoordination();
      }
      const focusedStates: readonly { id: string }[] = CHAT_UI_EXAMPLES.find(example => example.id === focusedExample)!.states;
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1050 });
        for (const exampleState of focusedStates) {
          for (const theme of ['light', 'dark']) {
            await select(focusedExample, exampleState.id);
            await page.getByRole('button', { name: theme, exact: true }).click();
            const active = await (await page.locator('iframe').first().elementHandle())!.contentFrame(); assert(active);
            await active.locator(`html[data-theme="${theme}"] [data-gallery-example]`).waitFor();
            if (focusedExample === 'html') await htmlCardReady(active);
            assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > innerWidth + 1), false, `Parent fits at ${width}`);
            assert.equal(await active.locator('body').evaluate(body => body.scrollWidth > innerWidth + 1), false, `${exampleState.id} fits at ${width}`);
            await page.screenshot({ path: path.join(output, `${focusedExample}-${exampleState.id}-${width}-${theme}.png`), fullPage: true });
          }
        }
      }
      assert.deepEqual(errors, [], 'No browser exceptions');
      assert.deepEqual(diagnostics, [], 'Every operation has a local fixture');
      assert.deepEqual(realRequests, [], 'No interaction reaches a real API');
      console.log(`${focusedExample}: interactions and all states passed on desktop and phone in both themes`);
      return;
    }
    let frame = await select('server-form');
    await frame.getByRole('button', { name: 'Submit', exact: true }).click();
    await waitForText(frame, 'Enter a project name.');
    await frame.getByRole('textbox', { name: 'Project name', exact: true }).fill('Friday release');
    await frame.getByRole('switch', { name: 'Ready for review', exact: true }).click();
    await frame.getByRole('button', { name: 'Submit', exact: true }).click();
    await waitForText(frame, 'Sent.');
    await waitForText(frame, 'Example form answered. No service received it');
    await page.getByRole('button', { name: 'Reset example', exact: true }).click();
    frame = await select('server-form');
    await frame.getByRole('button', { name: 'Decline', exact: true }).click();
    await waitForText(frame, 'Declined.');
    frame = await select('server-form', 'accepted');
    await waitForText(frame, "You answered Review Board's form");
    frame = await select('server-form', 'expired');
    assert.equal(await frame.getByRole('button', { name: 'Submit', exact: true }).count(), 0);
    await waitForText(frame, 'This form waited too long and closed.');
    await exerciseSharedChat();
    frame = await select('email');
    await frame.getByLabel('Message', { exact: true }).fill('A message typed in the gallery');
    await waitForText(frame, 'Saved');
    await frame.getByRole('button', { name: 'Send', exact: true }).click();
    await frame.getByRole('heading', { name: 'Email sent', exact: true }).waitFor();
    await waitForText(frame, 'Simulated send complete. No email was sent');
    assert.equal(await frame.evaluate(() => { try { return Boolean(parent.document); } catch { return false; } }), false, 'Example cannot read its parent document');
    await page.getByRole('button', { name: 'Reset example', exact: true }).click();
    frame = await select('email');
    await frame.getByText('Email draft', { exact: true }).waitFor();

    frame = await select('questions');
    await frame.getByRole('button', { name: /Video call/ }).click();
    await frame.getByRole('button', { name: /Video call/, pressed: true }).waitFor();
    await frame.getByRole('button', { name: /Submit/ }).click();
    await waitForText(frame, 'Example answer: Video call');
    frame = await select('permissions');
    await frame.getByRole('button', { name: /Allow/ }).click();
    await waitForText(frame, 'Example permission allowed');
    frame = await select('approvals');
    await frame.getByRole('button', { name: 'Approve once', exact: true }).click();
    await waitForText(frame, 'Example request approved. No account action ran');
    frame = await select('connections');
    await frame.getByRole('button', { name: /Allow/ }).click();
    await waitForText(frame, 'Example access granted. No account permissions changed');
    frame = await select('edits');
    await frame.getByRole('button', { name: /view changes/ }).click();
    await frame.getByRole('dialog').waitFor();
    await settleAnimations(frame);
    await frame.getByRole('button', { name: /Undo/ }).click();
    await waitForText(frame, 'Example note restored to its earlier version');
    await exerciseChatMessages();
    frame = await select('files');
    await frame.getByRole('button', { name: /friday-agenda/ }).click();
    await frame.getByText('1. Look at the new dashboard', { exact: false }).waitFor();
    await frame.getByRole('button', { name: 'Open PDF: friday-review.pdf' }).scrollIntoViewIfNeeded();
    await frame.getByRole('img', { name: 'First page of friday-review.pdf' }).waitFor();
    await frame.getByRole('button', { name: 'Open PDF: friday-review.pdf' }).click();
    await frame.getByRole('img', { name: 'Page 1 of friday-review.pdf' }).waitFor();
    await frame.getByRole('dialog').getByRole('link', { name: 'Download' }).waitFor();
    await frame.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    // Beside the chat: the PDF opens as a tab, × puts it away, its card brings it back, and the switch moves it.
    frame = await select('files', 'beside');
    await frame.getByRole('button', { name: 'Open PDF: friday-review.pdf' }).click();
    const beside = frame.getByRole('region', { name: 'friday-review.pdf, beside the chat' });
    await beside.getByRole('img', { name: 'Page 1 of friday-review.pdf' }).waitFor();
    await frame.getByRole('button', { name: 'Close friday-review.pdf' }).click();
    await beside.waitFor({ state: 'detached' });
    await frame.getByRole('button', { name: 'Open PDF: friday-review.pdf' }).click();
    await beside.getByRole('button', { name: 'Show large' }).click();
    await frame.getByRole('dialog').getByRole('img', { name: 'Page 1 of friday-review.pdf' }).waitFor();
    await frame.getByRole('dialog').getByRole('button', { name: 'Show beside the chat' }).click();
    await beside.waitFor();
    frame = await select('html');
    await htmlCardReady(frame);
    await frame.getByRole('button', { name: 'Open HTML: review-plan.html' }).click();
    const htmlHandle = await frame.getByTitle('HTML preview: review-plan.html').elementHandle();
    const documentFrame = await htmlHandle!.contentFrame(); assert(documentFrame);
    await documentFrame.waitForLoadState('load');
    await settleAnimations(frame);
    await documentFrame.getByRole('button', { name: 'Record an example decision' }).click();
    await documentFrame.getByText('1 decisions recorded', { exact: true }).waitFor();
    frame = await select('handoffs');
    await frame.getByRole('button', { name: 'Accept', exact: true }).click();
    await waitForText(frame, 'Example handoff accepted');
    await frame.getByRole('button', { name: 'Request changes', exact: true }).click();
    await frame.locator('[contenteditable="true"]').fill('Please include the release date');
    await frame.getByRole('button', { name: 'Send feedback', exact: true }).click();
    await waitForText(frame, 'Example feedback saved');
    await frame.getByRole('button', { name: 'Update handoff', exact: true }).click();
    await waitForText(frame, 'Example handoff update requested. No agent was started');
    frame = await select('connected-app');
    await frame.getByText('Opening app…', { exact: true }).waitFor({ state: 'hidden' });
    await frame.getByText('Loading interface…', { exact: true }).waitFor({ state: 'hidden' });
    const appFrame = frame.frameLocator('iframe[aria-label="App view"]').frameLocator('iframe');
    await appFrame.getByLabel('Hours', { exact: true }).fill('10');
    await appFrame.getByRole('button', { name: 'Recalculate', exact: true }).click();
    await appFrame.getByText('$1200', { exact: true }).waitFor();
    await waitForText(frame, 'The example app shared its selection with the example chat');
    await frame.getByRole('button', { name: 'Open beside chat', exact: true }).click();
    await frame.getByRole('button', { name: 'Close app', exact: true }).click();
    frame = await select('app-kit', 'forms');
    await frame.getByText('Kit gallery · Fictional records', { exact: true }).waitFor();

    await page.goto(`http://127.0.0.1:${address.port}/gallery#email?state=sent`);
    frame = await select('email', 'sent');
    await frame.getByRole('heading', { name: 'Email sent', exact: true }).waitFor();
    await page.getByText('Where this UI lives', { exact: true }).click();
    await page.locator('code').getByText('src/components/chat-ui/email/email-composer.tsx', { exact: true }).waitFor();

    await page.getByLabel('Search chat interfaces').fill('zzzz-no-interface');
    await page.getByRole('heading', { name: 'No matching interfaces' }).waitFor();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('button', { name: /^Connected app/ }).click();
    await page.getByRole('heading', { name: 'Interactive app results', exact: true }).waitFor();
    await page.getByRole('button', { name: /^All sources/ }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1050 });
      for (const id of ['email', 'shared-chat', 'server-form', 'questions', 'approvals', 'chat-messages', 'html', 'connected-app', 'app-kit']) {
        await select(id);
        for (const theme of ['light', 'dark']) {
          await page.getByRole('button', { name: theme, exact: true }).click();
          const iframe = page.locator('iframe').first(); await iframe.waitFor();
          await iframe.scrollIntoViewIfNeeded();
          const active = await (await iframe.elementHandle())!.contentFrame(); assert(active);
          await active.locator('[data-gallery-example]').waitFor();
          await active.locator(`html[data-theme="${theme}"]`).waitFor();
          if (id === 'html') await htmlCardReady(active);
          if (id === 'connected-app') await active.frameLocator('iframe[aria-label="App view"]').frameLocator('iframe').getByLabel('Hours', { exact: true }).waitFor();
          assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > innerWidth + 1), false, `${id}: parent overflow at ${width}`);
          assert.equal(await active.locator('body').evaluate(body => body.scrollWidth > innerWidth + 1), false, `${id}: preview overflow at ${width}`);
          await page.screenshot({ path: path.join(output, `${id}-${width}-${theme}.png`), fullPage: true });
        }
      }
      await select('chat-messages', 'long');
      const longPreview = await (await page.locator('iframe').first().elementHandle())!.contentFrame(); assert(longPreview);
      assert.equal(await longPreview.locator('body').evaluate(body => body.scrollWidth > innerWidth + 1), false, `Long chat name fits at ${width}`);
      await page.screenshot({ path: path.join(output, `chat-messages-long-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, [], 'No browser exceptions');
    assert.deepEqual(diagnostics, [], 'Every requested operation has a local fixture');
    assert.deepEqual(realRequests, [], 'No gallery interaction reaches an API');
    console.log('Gallery interactions, light/dark desktop/phone layouts and isolation passed');
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
