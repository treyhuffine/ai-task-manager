/**
 * Real-browser integration tests. Hermetic: drives about:blank + setContent, no
 * network. Opt-in and gated on a browser being installed, so the default
 * `pnpm test` stays fast and deterministic.
 *
 *   FLOW_BROWSER_E2E=1 pnpm test src/lib/browser/browser.integration.test.ts
 *   (or `pnpm test:browser`)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectBrowsers } from './chromium';
import { listBrowserProfiles } from './config';
import { getSession, getActivePage, listTabs, selectTab, closeTab } from './runtime';
import { readPage, detectBlocked, isInterstitial } from './read';
import { performAct, performBatch } from './act';
import { isBrowserOpen, closeBrowser } from './session';
import { importCookies } from './cookie-import';
import { saveAttachment, attachmentPath } from '@/lib/attachments/save';
import { writeAuthConfig } from '@/lib/auth/config-file';

const RUN = process.env.FLOW_BROWSER_E2E === '1' && detectBrowsers().length > 0;
const T = 30_000;

function ref(snapshot: string, needle: string): string {
  const line = snapshot.split('\n').find((l) => l.includes(needle) && l.includes('[ref='));
  const m = line && /\[ref=([a-z0-9]+)\]/.exec(line);
  if (!m) throw new Error(`no ref for "${needle}" in:\n${snapshot}`);
  return m[1];
}

describe.skipIf(!RUN)('browser integration (e2e)', () => {
  let root: string;

  beforeAll(async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flow-browser-e2e-')));
    process.env.FLOW_ROOT = root;
    const session = await getSession({ headless: true });
    await (await getActivePage(session)).goto('about:blank');
  }, 45_000);

  afterAll(async () => {
    await closeBrowser().catch(() => {});
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  async function blankPage() {
    const session = await getSession({ headless: true });
    const page = await getActivePage(session);
    await page.goto('about:blank');
    return { session, page };
  }

  it('detects an installed browser', () => {
    expect(detectBrowsers().length).toBeGreaterThan(0);
  });

  it(
    'connect-or-launch lifecycle: launch, persist across disconnect, kill',
    async () => {
      const session = await getSession({ headless: true });
      expect(await isBrowserOpen()).toBe(true);
      // Dropping our client must NOT kill the browser.
      await session.agent.browser.close();
      expect(await isBrowserOpen()).toBe(true);
    },
    T,
  );

  it(
    'snapshot gives aria-refs and act types/clicks through them',
    async () => {
      const { session, page } = await blankPage();
      await page.setContent('<input aria-label="Name"><button aria-label="Go">go</button>');
      const snap = await readPage(page, { mode: 'snapshot' });
      expect(snap.refCount).toBeGreaterThanOrEqual(2);
      await performAct(session, { kind: 'type', ref: ref(snap.content, 'Name'), text: 'Ada' });
      expect(await page.evaluate(() => (document.querySelector('input') as HTMLInputElement).value)).toBe('Ada');
      const clicked = await performAct(session, { kind: 'click', ref: ref(snap.content, 'Go') });
      expect(clicked.ok).toBe(true);
    },
    T,
  );

  it(
    'text mode extracts article body',
    async () => {
      const { page } = await blankPage();
      await page.setContent('<article><h1>Hello</h1><p>' + 'Body text. '.repeat(40) + '</p></article>');
      const res = await readPage(page, { mode: 'text' });
      expect(res.content.length).toBeGreaterThan(100);
      expect(res.content).toContain('Body text.');
    },
    T,
  );

  it(
    'screenshot returns a set-of-marks image',
    async () => {
      const { page } = await blankPage();
      await page.setContent('<a href="#" aria-label="One">a</a><button aria-label="Two">b</button>');
      const res = await readPage(page, { mode: 'screenshot' });
      expect(res.image && res.image.length).toBeGreaterThan(0);
      expect(res.marks?.length).toBeGreaterThanOrEqual(2);
    },
    T,
  );

  it(
    'hover fires hover handlers',
    async () => {
      const { session, page } = await blankPage();
      await page.setContent('<button aria-label="H">h</button><div id="o"></div>');
      await page.evaluate(() =>
        document.querySelector('button')!.addEventListener('mouseover', () => (document.getElementById('o')!.textContent = 'y')),
      );
      const snap = await readPage(page, { mode: 'snapshot' });
      await performAct(session, { kind: 'hover', ref: ref(snap.content, 'H') });
      expect(await page.evaluate(() => document.getElementById('o')?.textContent)).toBe('y');
    },
    T,
  );

  it(
    'evaluate runs and returns a value',
    async () => {
      const { session } = await blankPage();
      const res = await performAct(session, { kind: 'evaluate', fn: '6 * 7' });
      expect(res.evalResult).toBe(42);
    },
    T,
  );

  it(
    'wait resolves on a selector that appears',
    async () => {
      const { session, page } = await blankPage();
      await page.evaluate(() =>
        setTimeout(() => {
          const d = document.createElement('div');
          d.id = 'late';
          d.textContent = 'x';
          document.body.append(d);
        }, 200),
      );
      await performAct(session, { kind: 'wait', selector: '#late', ms: 5000 });
      expect(await page.evaluate(() => !!document.getElementById('late'))).toBe(true);
    },
    T,
  );

  it(
    'dialogs: dismiss by default, accept on request, prompt text',
    async () => {
      const { session, page } = await blankPage();
      await page.setContent('<button aria-label="C">c</button><div id="o"></div>');
      await page.evaluate(() =>
        document.querySelector('button')!.addEventListener('click', () => (document.getElementById('o')!.textContent = confirm('?') ? 'a' : 'd')),
      );
      const snap = await readPage(page, { mode: 'snapshot' });
      const cref = ref(snap.content, 'C');
      const dismissed = await performAct(session, { kind: 'click', ref: cref, acceptDialog: false });
      expect(dismissed.dialog?.type).toBe('confirm');
      expect(await page.evaluate(() => document.getElementById('o')?.textContent)).toBe('d');
      await performAct(session, { kind: 'click', ref: cref, acceptDialog: true });
      expect(await page.evaluate(() => document.getElementById('o')?.textContent)).toBe('a');
    },
    T,
  );

  it(
    'tabs: a click opens a new tab, auto-switch, list/select/close',
    async () => {
      const { session, page } = await blankPage();
      await page.setContent('<button aria-label="Open">o</button>');
      await page.evaluate(() => document.querySelector('button')!.addEventListener('click', () => window.open('about:blank', '_blank')));
      const snap = await readPage(page, { mode: 'snapshot' });
      const opened = await performAct(session, { kind: 'click', ref: ref(snap.content, 'Open') });
      expect(opened.newTab).toBeTruthy();
      const tabs = await listTabs(session);
      expect(tabs.length).toBeGreaterThanOrEqual(2);
      expect(tabs[tabs.length - 1].active).toBe(true);
      selectTab(session, 0);
      expect((await listTabs(session))[0].active).toBe(true);
      await closeTab(session, tabs.length - 1);
    },
    T,
  );

  it(
    'download is captured as a Flow attachment',
    async () => {
      const { session, page } = await blankPage();
      await page.setContent('<a aria-label="DL" download="r.txt" href="data:text/plain,Body">d</a>');
      const snap = await readPage(page, { mode: 'snapshot' });
      const res = await performAct(session, { kind: 'click', ref: ref(snap.content, 'DL') });
      expect(res.downloads.length).toBe(1);
      expect(fs.readFileSync(attachmentPath(res.downloads[0].fileName), 'utf8')).toBe('Body');
    },
    T,
  );

  it(
    'upload sets a file input from a Flow attachment',
    async () => {
      const { session, page } = await blankPage();
      const att = await saveAttachment({ data: Buffer.from('hi'), originalName: 'u.txt' });
      await page.setContent('<input type="file" aria-label="Up">');
      const snap = await readPage(page, { mode: 'snapshot' });
      await performAct(session, { kind: 'upload', ref: ref(snap.content, 'Up'), attachmentFile: att.fileName });
      expect(await page.evaluate(() => (document.querySelector('input') as HTMLInputElement).files?.length)).toBe(1);
    },
    T,
  );

  it(
    'batch runs a sequence in one call',
    async () => {
      const { session, page } = await blankPage();
      await page.setContent('<input aria-label="A" id="a"><button aria-label="B" id="b">b</button><div id="o"></div>');
      await page.evaluate(() =>
        document.getElementById('b')!.addEventListener('click', () => (document.getElementById('o')!.textContent = (document.getElementById('a') as HTMLInputElement).value)),
      );
      const snap = await readPage(page, { mode: 'snapshot' });
      const res = await performBatch(session, [
        { kind: 'type', ref: ref(snap.content, 'A'), text: 'Zed' },
        { kind: 'click', ref: ref(snap.content, 'B') },
      ]);
      expect(res.steps.every((s) => s.ok)).toBe(true);
      expect(await page.evaluate(() => document.getElementById('o')?.textContent)).toBe('Zed');
    },
    T,
  );

  it(
    'blocked-on-act reports a login wall',
    async () => {
      const { session, page } = await blankPage();
      await page.setContent('<input type="password"><button aria-label="N">n</button>');
      const snap = await readPage(page, { mode: 'snapshot' });
      const res = await performAct(session, { kind: 'hover', ref: ref(snap.content, 'N') });
      expect(res.blocked?.kind).toBe('login');
    },
    T,
  );

  it(
    'pdf mode files the page as a PDF attachment',
    async () => {
      const { page } = await blankPage();
      await page.setContent('<h1>PDF</h1><p>body</p>');
      const res = await readPage(page, { mode: 'pdf' });
      expect(res.attachment?.mimeType).toBe('application/pdf');
      const bytes = fs.readFileSync(attachmentPath(res.attachment!.fileName));
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
    },
    T,
  );

  it(
    'back, forward, and reload navigate history',
    async () => {
      const { session, page } = await blankPage();
      await page.goto('data:text/html,<h1>PageA</h1>');
      await page.goto('data:text/html,<h1>PageB</h1>');
      await performAct(session, { kind: 'back' });
      expect(await page.evaluate(() => document.body.innerText)).toContain('PageA');
      await performAct(session, { kind: 'forward' });
      expect(await page.evaluate(() => document.body.innerText)).toContain('PageB');
      expect((await performAct(session, { kind: 'reload' })).ok).toBe(true);
    },
    T,
  );

  it(
    'detects a Cloudflare interstitial as a challenge (and clears on a normal page)',
    async () => {
      const { page } = await blankPage();
      await page.setContent('<title>Just a moment...</title><body>Checking your browser before you access the site.</body>');
      expect(await isInterstitial(page)).toBe(true);
      expect((await detectBlocked(page))?.kind).toBe('challenge');
      await page.setContent('<title>Real Page</title><h1>Hello</h1>');
      expect(await isInterstitial(page)).toBe(false);
      expect(await detectBlocked(page)).toBeUndefined();
    },
    T,
  );

  it('lists profiles including the default agent profile', () => {
    const profiles = listBrowserProfiles();
    expect(profiles.some((p) => p.name === 'agent' && p.isDefault)).toBe(true);
  });

  it.skipIf(process.platform !== 'darwin')(
    'cookie import errors cleanly for a missing profile (no Keychain)',
    async () => {
      await expect(importCookies({ domain: 'example.com', chromeProfile: '__flow_nope__' })).rejects.toMatchObject({
        code: 'not_found',
      });
    },
    T,
  );

  // Last: closes the browser as a side effect, so it must run after the rest.
  it(
    'idle auto-close closes the browser after the idle window',
    async () => {
      writeAuthConfig({ browserIdleCloseMs: 800 });
      await closeBrowser().catch(() => {});
      const { getSession: gs, forgetSession } = await import('./runtime');
      forgetSession('agent');
      await gs({ headless: true });
      expect(await isBrowserOpen()).toBe(true);
      await new Promise((r) => setTimeout(r, 1600));
      expect(await isBrowserOpen()).toBe(false);
    },
    T,
  );
});
