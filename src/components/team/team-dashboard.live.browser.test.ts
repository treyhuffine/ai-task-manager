/** Full app through real HTTP/tRPC, ordinary components and synthetic Homes. No provider sends. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { teamTRPC } from '@/lib/spaces/remote';

type Preview = { ownerUrl: string; memberUrl?: string; taskId?: string; noteId?: string; assistantId?: string; spaceUrl?: string };
const root = process.env.RI_TEAM_DASHBOARD_PREVIEW;
const enabled = Boolean(root);
const personalRoot = process.env.RI_TEAM_DASHBOARD_PERSONAL;
const captures = process.env.RI_ARTIFACT_SCREENSHOTS;
let browser: Browser;
let preview: Preview;
const errors: string[] = [];
const load = (root: string) => JSON.parse(fs.readFileSync(path.join(root, 'preview.json'), 'utf8')) as Preview;
const token = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get('token')!;
const client = () => teamTRPC(new URL(preview.ownerUrl).origin, token(preview.ownerUrl));

beforeAll(async () => {
  if (!root) return;
  preview = load(root);
  if (!['localhost', '127.0.0.1'].includes(new URL(preview.ownerUrl).hostname)) throw new Error('Use a local synthetic preview.');
  browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
  if (captures) fs.mkdirSync(captures, { recursive: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function pageFor(width: number, member = false, mac = false, http = false) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  if (http) await page.addInitScript(() => localStorage.setItem('ri.client.apiTransport', 'http'));
  if (mac) await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.riDesktop = 'darwin'; }); });
  await page.goto(member ? preview.memberUrl! : preview.ownerUrl);
  return page;
}
async function capture(page: Page, name: string) { if (captures) await page.screenshot({ path: path.join(captures, `${name}.png`), fullPage: true }); }

it.skipIf(!enabled)('uses the normal rail, direct main chat, Recent and full Board without personal destinations', async () => {
  const page = await pageFor(1440);
  try {
    const rail = page.locator('aside');
    await rail.getByRole('tab', { name: 'Recent', exact: true }).waitFor();
    await page.getByText('The onboarding review is the next decision.', { exact: false }).first().waitFor();
    expect(await page.getByRole('button', { name: 'Deck', exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Quick capture', exact: true }).count()).toBe(0);
    await capture(page, 'team-desktop');
    await rail.getByRole('tab', { name: 'Recent', exact: true }).click();
    await rail.getByText('Onboarding prototype', { exact: true }).click();
    await page.getByRole('button', { name: 'Close chat', exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get('session')).toBeTruthy();
    await page.getByRole('button', { name: 'Close chat', exact: true }).click();
    await rail.getByRole('button', { name: 'Board', exact: true }).click();
    await page.getByRole('button', { name: 'Close Board', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Tasks', exact: true }).last().click();
    await page.getByText('Review the onboarding prototype', { exact: true }).last().waitFor();
    await capture(page, 'team-board');
    await page.getByRole('button', { name: 'Close Board', exact: true }).click();
    await rail.getByRole('button', { name: 'Notes', exact: true }).click();
    await page.getByText('Launch working notes', { exact: true }).waitFor();
    await rail.getByRole('button', { name: 'Field Notes, home', exact: true }).click();
    expect(new URL(page.url()).searchParams.get('view')).toBe('chat');
    await page.getByText('What should we focus on for the release?', { exact: true }).waitFor();
  } finally { await page.close(); }
}, 60_000);

it.skipIf(!enabled)('shares the full resizable task editor, nested navigation, autosave, assignment and full document expansion', async () => {
  const api = client();
  const original = await api.tasks.get.query({ id: preview.taskId! });
  const page = await pageFor(1440, false, true);
  try {
    await page.goto(`${new URL(preview.ownerUrl).origin}/?task=${preview.taskId}`);
    const title = page.getByRole('textbox', { name: 'Task title', exact: true });
    await title.waitFor();
    expect(await page.getByText('Shared with Field Notes', { exact: true }).isVisible()).toBe(true);
    const sheet = page.locator('[data-slot=sheet-content]');
    expect((await sheet.boundingBox())!.y).toBeGreaterThanOrEqual(39);
    await title.fill('Onboarding review, shared editor');
    await expect.poll(async () => (await api.tasks.get.query({ id: preview.taskId! })).title).toBe('Onboarding review, shared editor');
    await page.getByRole('button', { name: 'Assigned to', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Luis Arroyo', exact: true }).click();
    await expect.poll(async () => (await api.tasks.get.query({ id: preview.taskId! })).assigneeMemberId).not.toBe(original.assigneeMemberId);
    await page.getByText('Launch working notes', { exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('note')).toBe(preview.noteId);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect.poll(() => title.inputValue()).toBe('Onboarding review, shared editor');
    await page.getByRole('link', { name: 'Open full page', exact: true }).click();
    await expect.poll(async () => (await sheet.boundingBox())!.width).toBe(1440);
    await page.reload();
    await title.waitFor();
    expect(await title.inputValue()).toBe('Onboarding review, shared editor');
    await capture(page, 'team-task');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await sheet.waitFor({ state: 'hidden' });
  } finally {
    await api.tasks.update.mutate({ id: original.id, patch: { title: original.title, assigneeMemberId: original.assigneeMemberId } });
    await page.close();
  }
}, 60_000);

it.skipIf(!enabled)('keeps shared body conflicts and the member delete boundary in the common note editor', async () => {
  const api = client();
  const original = await api.notes.get.query({ id: preview.noteId! });
  const page = await pageFor(1280, true, false, true);
  let release: (() => void) | undefined;
  let held = false;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  try {
    await page.goto(`${new URL(preview.ownerUrl).origin}/?note=${preview.noteId}`);
    const body = page.locator('.rich-editor-body[contenteditable=true]').first();
    await body.waitFor();
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    expect(await page.getByRole('menuitem', { name: 'Delete for everyone', exact: true }).count()).toBe(0);
    await page.keyboard.press('Escape');
    // Hold this member’s write until the other browser has committed its edit.
    await page.route('**/api/trpc/notes.update', async route => { held = true; await barrier; await route.continue(); });
    await body.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' Local member draft');
    await expect.poll(() => held).toBe(true);
    const current = await api.notes.get.query({ id: original.id });
    await api.notes.update.mutate({ id: original.id, patch: { body: original.body + '\n\nOwner edit from another browser' }, expectedBodyRevision: current.bodyRevision });
    release!();
    await page.getByText('Someone else changed this while you were editing. Your text is kept.', { exact: true }).waitFor();
    expect(await body.innerText()).toContain('Local member draft');
    await capture(page, 'team-note-conflict');
    await page.getByRole('button', { name: 'Use theirs', exact: true }).click();
    await expect.poll(() => body.innerText()).toContain('Owner edit from another browser');
  } finally {
    release?.();
    await page.close();
    const current = await api.notes.get.query({ id: original.id });
    await api.notes.update.mutate({ id: original.id, patch: { body: original.body }, expectedBodyRevision: current.bodyRevision });
  }
}, 60_000);

it.skipIf(!enabled).each([390, 900])('keeps tasks, notes and selected agent navigation at %ipx through reload and history', async width => {
  const page = await pageFor(width);
  try {
    await page.goto(`${new URL(preview.ownerUrl).origin}/?view=notes`);
    await page.getByText('Launch working notes', { exact: true }).waitFor();
    if (width === 390) {
      const nav = page.getByRole('navigation', { name: 'Home', exact: true });
      await nav.getByRole('button', { name: 'Chat', exact: true }).click();
      await page.getByText('What should we focus on for the release?', { exact: true }).waitFor();
      await nav.getByRole('button', { name: 'Notes', exact: true }).click();
      await page.getByText('Launch working notes', { exact: true }).waitFor();
      await page.reload();
      await page.getByText('Launch working notes', { exact: true }).waitFor();
      await nav.getByRole('button', { name: 'Tasks', exact: true }).click();
      await page.getByText('Review the onboarding prototype', { exact: true }).first().waitFor();
      await nav.getByRole('button', { name: /Agents$/ }).click();
      await page.getByText('Product', { exact: true }).first().waitFor();
      await page.getByRole('button', { name: /Product.*execution/ }).click();
      await expect.poll(() => new URL(page.url()).searchParams.has('agent')).toBe(true);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('agents');
      await page.getByText('Product', { exact: true }).first().waitFor();
      await page.goBack();
      await expect.poll(() => new URL(page.url()).searchParams.has('agent')).toBe(true);
      await page.goForward();
      await page.getByText('Product', { exact: true }).first().waitFor();
    } else {
      await page.goto(`${new URL(preview.ownerUrl).origin}/?agent=${preview.assistantId}&tab=files`);
      await page.getByRole('tab', { name: 'Files', exact: true }).waitFor();
      expect(new URL(page.url()).searchParams.get('agent')).toBe(preview.assistantId);
      await page.reload();
      await page.getByRole('tab', { name: 'Files', exact: true }).waitFor();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, `team-${width}`);
  } finally { await page.close(); }
}, 60_000);

it.skipIf(!enabled)('leaves content and history readable when Team AI is off', async () => {
  const api = client();
  await api.team.ai.setEnabled.mutate({ enabled: false });
  const page = await pageFor(1280);
  try {
    await page.getByText('Review the onboarding prototype', { exact: true }).first().waitFor();
    await page.getByText('What should we focus on for the release?', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.getByRole('button', { name: /What should we focus on/ }).click();
    await page.getByText('What should we focus on for the release?', { exact: true }).waitFor();
    await page.goto(`${new URL(preview.ownerUrl).origin}/?note=${preview.noteId}`);
    await page.locator('.rich-editor-body[contenteditable=true]').first().waitFor();
  } finally { await api.team.ai.setEnabled.mutate({ enabled: true }); await page.close(); }
}, 60_000);

it.skipIf(!enabled || !personalRoot)('preserves the personal dashboard and keeps connected-Team agent navigation inside its document', async () => {
  const personal = load(personalRoot!);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(personal.ownerUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Deck', exact: true }).first().waitFor();
    await page.getByRole('button', { name: /^Stream\b/ }).last().waitFor();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: /Quick Capture/ }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Quick Capture/ }).waitFor({ state: 'hidden' });
    await capture(page, 'personal-dashboard');
    await page.goto(personal.spaceUrl!);
    await page.getByText('Review the onboarding prototype', { exact: true }).first().waitFor();
    const prefix = new URL(personal.spaceUrl!).pathname;
    await page.locator('aside').getByRole('tab', { name: 'Recent', exact: true }).click();
    await page.getByText('Onboarding prototype', { exact: true }).first().click();
    expect(new URL(page.url()).pathname).toBe(prefix);
    expect(new URL(page.url()).searchParams.has('session')).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: 'Close chat', exact: true }).waitFor();
    await page.getByText('The onboarding prototype is ready for review.', { exact: false }).first().waitFor();
    expect(new URL(page.url()).pathname).toBe(prefix);
    await capture(page, 'connected-team-chat');
  } finally { await page.close(); }
}, 60_000);

it.skipIf(!enabled)('renders without unhandled browser errors', () => { expect(errors).toEqual([]); });
