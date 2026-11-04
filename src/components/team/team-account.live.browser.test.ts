/** Opt-in full-app checks against disposable review Homes. No harness sends. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { teamTRPC } from '@/lib/spaces/remote';

type Preview = { ownerUrl: string; memberUrl?: string; spaceUrl?: string };
const root = process.env.RI_TEAM_ACCOUNT_PREVIEW;
const personalRoot = process.env.RI_TEAM_ACCOUNT_PERSONAL;
const tunnel = process.env.RI_TEAM_ACCOUNT_TUNNEL;
const captures = process.env.RI_ARTIFACT_SCREENSHOTS;
const enabled = Boolean(root);
let browser: Browser;
let preview: Preview;
const errors: string[] = [];
const load = (root: string) => JSON.parse(fs.readFileSync(path.join(root, 'preview.json'), 'utf8')) as Preview;
const token = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get('token')!;
const client = () => teamTRPC(new URL(preview.ownerUrl).origin, token(preview.ownerUrl));

beforeAll(async () => {
  if (!root) return;
  preview = load(root);
  if (!['localhost', '127.0.0.1'].includes(new URL(preview.ownerUrl).hostname)) throw new Error('Use a local synthetic review Home.');
  browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
  if (captures) fs.mkdirSync(captures, { recursive: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function pageFor(width = 1440, member = false) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('ri.client.apiTransport', 'http'));
  await page.goto(member ? preview.memberUrl! : preview.ownerUrl);
  return page;
}
async function capture(page: Page, name: string) {
  if (captures) await page.screenshot({ path: path.join(captures, `${name}.png`), fullPage: true });
}

it.skipIf(!enabled || !tunnel)('creates a verified Beamd address and finishes Connect to My Ri inside Your account', async () => {
  const api = client();
  const before = await api.team.me.query();
  expect(before.team.name).toBe('Field Notes');
  await api.team.address.clear.mutate();
  const page = await pageFor();
  try {
    await page.locator('footer').getByRole('button', { name: 'Connect to My Ri', exact: true }).click();
    await page.getByRole('heading', { name: 'Your account', exact: true }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Connect to My Ri', exact: true }).click();
    const recovery = page.getByRole('region', { name: 'Connect to My Ri: Team address' });
    await recovery.getByRole('button', { name: 'Use Beamd', exact: true }).click();
    await recovery.getByRole('textbox', { name: 'Team prefix', exact: true }).fill(tunnel!);
    await capture(page, 'live-team-account-inline-setup');
    await recovery.getByRole('button', { name: 'Use Beamd address', exact: true }).click();
    await page.getByText('paste it in your own Ri', { exact: false }).waitFor({ timeout: 30_000 });
    const link = new URL((await page.locator('code').innerText()).trim());
    const address = (await api.team.address.get.query()).address!;
    expect(link.origin).toBe(address);
    expect(new URL(page.url()).searchParams.get('settings')).toBe('access');
    expect(await recovery.count()).toBe(0);
    const secret = new URLSearchParams(link.hash.slice(1)).get('sign-in')!;
    const response = await fetch(`${address}/api/team/public/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ kind: 'sign-in', secret }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: 'valid', team: { id: before.team.id } });
    expect((await api.team.me.query()).team.members).toBe(before.team.members);
    await capture(page, 'live-team-account-link-ready');
  } finally { await page.close(); }
}, 90_000);

it.skipIf(!enabled || !tunnel)('shows the saved address as Online only after checking this real Team', async () => {
  const page = await pageFor();
  try {
    await page.locator('footer').getByRole('button', { name: 'Your account', exact: true }).click();
    await page.getByRole('navigation', { name: 'Team settings' }).getByRole('button', { name: 'Team address', exact: true }).click();
    await page.getByText('Online', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await expect.poll(() => page.getByRole('button', { name: 'Check connection', exact: true }).isEnabled()).toBe(true);
    await page.getByText('Verified that this address reaches your team.', { exact: false }).waitFor();
    expect(await client().team.address.status.query()).toMatchObject({ status: 'online', method: 'beamd' });
    await capture(page, 'live-team-address-online');
  } finally { await page.close(); }
}, 60_000);

it.skipIf(!enabled || !tunnel)('keeps a member in Your account and explains owner help when the Team address is missing', async () => {
  const api = client();
  const previous = await api.team.address.get.query();
  await api.team.address.clear.mutate();
  const page = await pageFor(390, true);
  try {
    await page.getByRole('button', { name: 'Space: Field Notes. Switch space', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Your account', exact: true }).click();
    await page.getByRole('button', { name: 'Connect to My Ri', exact: true }).click();
    await page.getByText('Ask a team owner', { exact: false }).waitFor();
    expect(new URL(page.url()).searchParams.get('settings')).toBe('access');
    expect(await page.getByRole('button', { name: 'Use Beamd', exact: true }).count()).toBe(0);
    expect(await page.locator('code').count()).toBe(0);
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await capture(page, 'live-team-account-member-phone');
  } finally {
    await page.close();
    if (previous.autoTunnel) await api.team.address.configureBeamd.mutate({ name: previous.tunnelName });
    else if (previous.address) await api.team.address.set.mutate({ address: previous.address });
  }
}, 60_000);

it.skipIf(!enabled || !tunnel)('replaces cached Online status when a check fails and recovers on retry', async () => {
  const page = await pageFor();
  try {
    await page.locator('footer').getByRole('button', { name: 'Your account', exact: true }).click();
    await page.getByRole('navigation', { name: 'Team settings' }).getByRole('button', { name: 'Team address', exact: true }).click();
    await page.getByText('Online', { exact: true }).waitFor();
    await page.route('**/api/trpc/team.address.status**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Unavailable"}' }));
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await page.getByText('Could not check connection', { exact: true }).waitFor();
    expect(await page.getByText('Verified that this address reaches your team.', { exact: false }).count()).toBe(0);
    await page.unroute('**/api/trpc/team.address.status**');
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await page.getByText('Online', { exact: true }).waitFor();
  } finally { await page.close(); }
}, 45_000);

it.skipIf(!enabled)('keeps Your account available in the collapsed tablet rail', async () => {
  const page = await pageFor(900);
  try {
    await page.locator('footer').getByRole('button', { name: 'Your account', exact: true }).click();
    await page.getByRole('heading', { name: 'Your account', exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get('settings')).toBe('access');
    await capture(page, 'live-team-account-tablet');
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled || !personalRoot)('shows an existing personal Ri connection in both the sidebar and account', async () => {
  const personal = load(personalRoot!);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(personal.ownerUrl);
    await page.goto(personal.spaceUrl!);
    const footer = page.locator('footer');
    await footer.getByText('Connected to My Ri', { exact: true }).waitFor();
    await footer.getByRole('button', { name: 'Your account', exact: true }).click();
    await page.getByText('Connected to My Ri.', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Connect to My Ri', exact: true, includeHidden: true }).count()).toBe(0);
    await capture(page, 'live-team-account-in-personal');
  } finally { await page.close(); }
}, 45_000);

it.skipIf(!enabled)('has no unhandled browser errors', () => { expect(errors).toEqual([]); });
