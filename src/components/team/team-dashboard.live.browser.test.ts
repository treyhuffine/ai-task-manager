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
    expect(await rail.getByRole('button', { name: 'Board', exact: true }).count()).toBe(0);
    expect(await page.getByRole('group', { name: 'Task view', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Open board', exact: true }).click();
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

it.skipIf(!enabled)('puts tasks on the left and expands either panel while keeping the divider and unsent chat draft', async () => {
  const page = await pageFor(1440);
  const a = page.locator('[data-panel]#panel-a');
  const b = page.locator('[data-panel]#panel-b');
  const editor = b.locator('[contenteditable=true]').first();
  try {
    await a.getByText('Review the onboarding prototype', { exact: true }).waitFor();
    await b.getByText('What should we focus on for the release?', { exact: true }).waitFor();
    expect((await a.boundingBox())!.x).toBeLessThan((await b.boundingBox())!.x);
    const separator = page.locator('[data-separator]').first();
    const box = (await separator.boundingBox())!;
    const initial = (await a.boundingBox())!.width;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x - 80, box.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await a.boundingBox())!.width).toBeLessThan(initial - 40);
    const split = (await b.boundingBox())!.width;
    await editor.fill('An unsent team review draft');
    await b.getByRole('button', { name: 'Expand chat', exact: true }).click();
    await expect.poll(async () => (await b.boundingBox())!.width).toBeGreaterThan(1100);
    expect(await a.isVisible()).toBe(false);
    expect(await editor.innerText()).toContain('An unsent team review draft');
    await capture(page, 'team-expanded-chat');
    await b.getByRole('button', { name: 'Restore split view', exact: true }).click();
    await expect.poll(async () => Math.abs((await b.boundingBox())!.width - split)).toBeLessThan(3);
    await a.getByRole('button', { name: 'Expand tasks', exact: true }).click();
    await expect.poll(async () => (await a.boundingBox())!.width).toBeGreaterThan(1100);
    expect(await b.isVisible()).toBe(false);
    await a.getByRole('button', { name: 'Restore split view', exact: true }).click();
    expect(await editor.innerText()).toContain('An unsent team review draft');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    if (await editor.isVisible()) await editor.fill('');
    await page.close();
  }
}, 60_000);

it.skipIf(!enabled)('shows status groups and real deadline order, with persisted grouping and sort choices', async () => {
  const page = await pageFor(1440);
  const panel = page.locator('[data-panel]#panel-a');
  try {
    const tasks = await client().tasks.list.query({ orderBy: 'hardDeadline' });
    const expected = ['in_progress', 'todo', 'consider', 'done', 'archived'].flatMap(status => tasks.filter(task => task.status === status).map(task => task.title));
    await panel.getByRole('button', { name: 'Group by Status', exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Sort by Deadline', exact: true }).waitFor();
    await expect.poll(() => panel.locator('[data-index] p.line-clamp-2').allTextContents()).toEqual(expected);
    await capture(page, 'team-grouped-list');
    await panel.getByRole('button', { name: 'Group by Status', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Assignee', exact: true }).click();
    await panel.getByRole('button', { name: /^Maya[^,]*, [0-9]+ tasks?$/ }).waitFor();
    await capture(page, 'team-list-by-assignee');
    await panel.getByRole('button', { name: 'Sort by Deadline', exact: true }).click();
    await page.getByRole('menuitemradio', { name: /^Updated/ }).click();
    await page.reload();
    await panel.getByRole('button', { name: 'Group by Assignee', exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Sort by Updated', exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Group by Assignee', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Status', exact: true }).click();
    await panel.getByRole('button', { name: 'Status: All', exact: true }).click();
    await page.getByRole('menuitemradio', { name: /^Active/ }).click();
    expect(await panel.getByRole('button', { name: /^Done, [0-9]+ tasks?$/ }).count()).toBe(0);
    expect(await panel.getByRole('button', { name: /^Archived, [0-9]+ tasks?$/ }).count()).toBe(0);
  } finally { await page.close(); }
}, 60_000);

it.skipIf(!enabled || !personalRoot)('uploads and removes a company logo through a connected Team while members have read-only branding', async () => {
  const api = client();
  const original = (await api.userState.list.query({}))?.orchestratorImage ?? null;
  const personal = load(personalRoot!);
  const owner = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  owner.setDefaultTimeout(20_000);
  owner.on('pageerror', error => errors.push(error.message));
  let member: Page | undefined;
  try {
    await owner.goto(personal.ownerUrl);
    await owner.goto(`${personal.spaceUrl}?panel=settings&settings=general`);
    await owner.getByLabel('Team logo file', { exact: true }).setInputFiles({ name: 'Company logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48"><rect width="96" height="48" fill="#167451"/><text x="8" y="34" font-size="30" fill="white">FN</text></svg>') });
    await expect.poll(async () => (await api.userState.list.query({}))?.orchestratorImage?.fileName).not.toBe(original?.fileName);
    const logo = owner.locator('aside button[aria-label="Field Notes, home"] img');
    await logo.waitFor({ state: 'attached' });
    await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    expect(await logo.getAttribute('src')).toMatch(/\/api\/space\/[^/]+\/attachments\//);
    await owner.getByRole('button', { name: 'Change logo', exact: true }).waitFor();
    await capture(owner, 'team-logo-settings');
    member = await pageFor(1280, true);
    await member.goto(`${new URL(preview.ownerUrl).origin}/?panel=settings&settings=general`);
    await member.getByText('Team logo', { exact: true }).waitFor();
    expect(await member.getByRole('button', { name: /Upload logo|Change logo|Remove logo/ }).count()).toBe(0);
    expect(await member.locator('aside button[aria-label="Field Notes, home"] img').getAttribute('src')).toContain('/api/attachments/');
    await owner.getByRole('button', { name: 'Remove logo', exact: true }).click();
    await expect.poll(async () => (await api.userState.list.query({}))?.orchestratorImage).toBeNull();
    await owner.getByRole('button', { name: 'Upload logo', exact: true }).waitFor();
  } finally {
    await member?.close(); await owner.close();
    await api.team.setLogo.mutate({ image: original });
  }
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
      await page.getByRole('button', { name: 'Open board', exact: true }).click();
      await page.getByRole('button', { name: 'Close Board', exact: true }).waitFor();
      await capture(page, 'team-board-phone');
      await page.getByRole('button', { name: 'Close Board', exact: true }).click();
      await page.getByRole('button', { name: 'Open board', exact: true }).waitFor();
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

it.skipIf(!enabled || !personalRoot)('expands personal panels, preserves drafts and tucks the control into More before tabs get cramped', async () => {
  const personal = load(personalRoot!);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  const a = page.locator('[data-panel]#panel-a');
  const b = page.locator('[data-panel]#panel-b');
  const editor = a.locator('[contenteditable=true]').first();
  try {
    await page.goto(personal.ownerUrl);
    await b.getByRole('button', { name: 'Deck', exact: true }).waitFor();
    await b.getByRole('button', { name: 'Long run: 18 miles', exact: true }).waitFor();
    await a.getByRole('button', { name: 'Expand chat', exact: true }).waitFor();
    await editor.fill('A personal draft stays here');
    await a.getByRole('button', { name: 'Expand chat', exact: true }).click();
    expect(await b.isVisible()).toBe(false);
    await expect.poll(async () => (await a.boundingBox())!.width).toBeGreaterThan(1500);
    expect(await editor.innerText()).toContain('A personal draft stays here');
    await capture(page, 'personal-expanded-chat');
    await page.setViewportSize({ width: 1440, height: 900 });
    await a.getByRole('button', { name: 'Restore split view', exact: true }).click();
    await expect.poll(() => b.isVisible()).toBe(true);
    const split = (await a.boundingBox())!.width;
    expect(await a.getByRole('button', { name: 'Expand chat', exact: true }).count()).toBe(0);
    for (const name of ['Chat', 'Deck', 'Tasks', 'Notes', 'More']) await a.getByRole('button', { name, exact: true }).waitFor();
    await a.getByRole('button', { name: /^Stream\b/ }).waitFor();
    const bar = a.getByRole('button', { name: 'Chat', exact: true }).locator('..');
    expect(await bar.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await a.getByRole('button', { name: 'More', exact: true }).click();
    await a.getByRole('button', { name: 'Expand panel', exact: true }).click();
    await a.getByRole('button', { name: 'Restore split view', exact: true }).waitFor();
    expect(await editor.innerText()).toContain('A personal draft stays here');
    await a.getByRole('button', { name: 'Restore split view', exact: true }).click();
    await expect.poll(async () => Math.abs((await a.boundingBox())!.width - split)).toBeLessThan(3);
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await bar.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, 'personal-panel-controls');
  } finally {
    if (await editor.isVisible()) await editor.fill('');
    await page.close();
  }
}, 60_000);

it.skipIf(!enabled)('renders without unhandled browser errors', () => { expect(errors).toEqual([]); });
