/**
 * The packaged view, end to end: package the app into the dev catalog,
 * import the archive, run the packaged server under the kit's AppEngine with
 * fictional host capabilities, and drive the built dist/ui.html through the
 * real AppViewController in headless Chromium. Screenshots go to artifacts/
 * (ignored by git). Every person, company and message is invented.
 *
 * PEOPLE_VIEW_OFFLINE=1 builds the same sources with the kit's offline
 * builder (the same build worker, without the portable lockfile) for use
 * while packaging is unavailable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { AppPrincipal, InvocationAccess } from '@ri/app-kit/contract';
import { AppEngine, NativeNodeDriver, type HostServices, type InstalledArtifact } from '@ri/app-kit/runtime';
import { importPackage, validateArtifact } from '@ri/app-kit/build';
import { buildOfflineAppFixture } from '@ri/app-kit/testing';
import { CHROME, openHarness, type Harness } from './view-harness.js';
import { fakeHost, mail, OWNER, OWNER_WORK, type FakeAccount, type FakeOptions } from './fakes.js';

const exec = promisify(execFile);
const appDir = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(appDir, '../..');
const archive = path.join(repo, 'release/local-apps/dev-catalog/ri-people.tar.gz');
const out = path.join(appDir, 'artifacts');
const offline = process.env.PEOPLE_VIEW_OFFLINE === '1';

const temporary: string[] = [];
const tempDir = (prefix: string) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temporary.push(dir); return dir; };

type Grants = InvocationAccess['accounts'];
interface Instance { artifact: InstalledArtifact; principal: AppPrincipal; grants: Grants; host: ReturnType<typeof fakeHost> }
const instances = new Map<string, Instance>();
let base: InstalledArtifact;
let engine: AppEngine;
let html = '';
let readActions = new Set<string>();

const services: HostServices = {
  version: 1,
  authorize() {},
  event() {},
  invocationAccess(instance, context) {
    const known = instances.get(instance.instanceId)!;
    return { protocol: 'ri-access-v1', actorId: `${context.principal.kind}:${context.principal.id}`, scopeRef: null, accounts: known.grants };
  },
  async capability(instance, _context, call) {
    return instances.get(instance.instanceId)!.host.capability(call.name, call.input, { account: call.account, binding: call.binding });
  },
};

function install(principal: AppPrincipal, grants: Grants = [], world: Record<string, FakeAccount> = {}, options: FakeOptions = {}): Instance {
  const root = tempDir('ri-people-instance-');
  const instanceId = randomUUID();
  const artifact: InstalledArtifact = { ...base, instanceId, dataDir: path.join(root, 'data'), cacheDir: path.join(root, 'cache'), logsDir: path.join(root, 'logs') };
  const instance = { artifact, principal, grants, host: fakeHost(world, { ai: 'unsupported', ...options }) };
  instances.set(instanceId, instance);
  return instance;
}
const invoke = (instance: Instance, action: string, input: unknown, invocationId?: string, principal: AppPrincipal = instance.principal) =>
  engine.invoke(instance.artifact, action, input, principal, 1, invocationId ?? randomUUID()) as Promise<any>;
const view = (instance: Instance, options: { width: number; height?: number; path?: string }) =>
  openHarness({ html, invoke: (action, input, invocationId) => invoke(instance, action, input, invocationId), readActions, ...options });

const preview: AppPrincipal = { kind: 'fixture', id: 'preview', fixtureAudience: 'user' };
const owner: AppPrincipal = { kind: 'owner-ui', id: 'owner' };
const schedule: AppPrincipal = { kind: 'job', id: 'schedule-1' };
const grant = (account: string, binding: 'mail' | 'calendar'): Grants[number] => ({ account, binding, actions: [], automatic: true });

beforeAll(async () => {
  if (!CHROME) throw new Error('The packaged view test needs Chromium (Playwright\'s build, Chrome or Brave)');
  let packageDir: string;
  if (offline) {
    packageDir = path.join(tempDir('ri-people-offline-'), 'package');
    fs.cpSync(appDir, packageDir, { recursive: true, filter: (source) => !/^(node_modules|dist|artifacts|test|\.ri-build|contract\.json)(\/|$)/.test(path.relative(appDir, source)) });
    const workflows = fs.readdirSync(path.join(appDir, 'skills')).sort().map((name) => {
      const front = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(appDir, 'skills', name, 'SKILL.md'), 'utf8'))![1]!;
      return { name: /^name:\s*(.+)$/m.exec(front)![1]!.trim(), description: /^description:\s*(.+)$/m.exec(front)![1]!.trim(), file: `skills/${name}/SKILL.md` };
    });
    await buildOfflineAppFixture({ packageDir, driver: new NativeNodeDriver(process.execPath), workflows });
    base = validateArtifact(packageDir) as unknown as InstalledArtifact;
  } else {
    try {
      await exec('pnpm', ['--filter', 'ri-people', 'package'], { cwd: repo, timeout: 280_000, maxBuffer: 16 * 1024 * 1024 });
    } catch (error) {
      const output = `${(error as { stdout?: string }).stdout ?? ''}${(error as { stderr?: string }).stderr ?? ''}`;
      throw new Error(`pnpm --filter ri-people package failed. Set PEOPLE_VIEW_OFFLINE=1 to build from source while packaging is unavailable.\n${output.slice(-1500)}`);
    }
    base = await importPackage(archive, path.join(tempDir('ri-people-import-'), 'package')) as unknown as InstalledArtifact;
    packageDir = base.packageDir;
  }
  html = fs.readFileSync(path.join(packageDir, 'dist/ui.html'), 'utf8');
  readActions = new Set(base.contract.actions.filter((action) => action.effect === 'read').map((action) => action.name));
  engine = new AppEngine(services, new NativeNodeDriver(process.execPath));
  fs.mkdirSync(out, { recursive: true });
}, 300_000);

afterAll(async () => {
  await engine?.dispose();
  const tmp = [path.resolve(os.tmpdir()), fs.realpathSync(os.tmpdir())];
  for (const dir of temporary.splice(0)) {
    const resolved = path.resolve(dir);
    if (!tmp.some((root) => resolved.startsWith(`${root}${path.sep}`))) throw new Error(`Refusing to remove ${dir}`);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

const shot = (harness: Harness, name: string) => harness.screenshot(path.join(out, name));

describe('packaged People view', () => {
  it('runs the main workflow on the fictional preview: select and pin two people, move an opportunity, stage an Ask Ri draft, at every width and in dark mode', async () => {
    const instance = install(preview);
    const harness = await view(instance, { width: 1280 });
    try {
      const ui = harness.view;
      await ui.getByRole('heading', { name: 'Coming up' }).waitFor();
      await ui.locator('.pe-record-title', { hasText: 'Maya Chen' }).waitFor();
      await shot(harness, 'people-today-1280.png');

      // Select two people and pin them. The pinned filter then returns exactly them.
      const pinnedNames = async () => (await invoke(instance, 'list_people', { filters: { pinned: true }, limit: 50 })).items.map((item: { name: string }) => item.name).sort();
      const pinnedBefore: string[] = await pinnedNames();
      expect(pinnedBefore).not.toContain('Elena Park');
      expect(pinnedBefore).not.toContain('Sam Okafor');
      await ui.getByRole('tab', { name: 'People' }).click();
      await ui.getByRole('table').waitFor();
      await ui.getByRole('button', { name: 'Select', exact: true }).click();
      await ui.getByRole('checkbox', { name: 'Select Elena Park' }).check();
      await ui.getByRole('checkbox', { name: 'Select Sam Okafor' }).check();
      await ui.getByText('2 selected').waitFor();
      await ui.getByRole('button', { name: 'Change selected' }).click();
      await ui.getByRole('menuitem', { name: 'Pin', exact: true }).click();
      await ui.getByText('2 of 2 updated').waitFor({ state: 'attached' });
      expect(await pinnedNames()).toEqual([...pinnedBefore, 'Elena Park', 'Sam Okafor'].sort());
      await ui.getByRole('button', { name: 'Done selecting' }).click();
      await ui.getByRole('row', { name: /Jordan Bell/ }).click();
      await ui.locator('.pe-record-title', { hasText: 'Jordan Bell' }).waitFor();
      await shot(harness, 'people-directory-1280.png');

      // A company workspace.
      await ui.getByRole('tab', { name: 'Companies' }).click();
      await ui.getByRole('row', { name: /Fieldwork/ }).click();
      await ui.locator('.pe-record-title', { hasText: 'Fieldwork' }).waitFor();
      await shot(harness, 'people-company-1280.png');

      // Move an opportunity with the keyboard-friendly menu and see the board refresh.
      await ui.getByRole('tab', { name: 'Pipelines' }).click();
      await ui.getByRole('heading', { name: 'Client work' }).waitFor();
      // The non-drag path, by keyboard only.
      const card = ui.getByRole('article', { name: 'Product setup review' });
      await card.getByRole('button', { name: 'Move to stage' }).focus();
      await harness.page.keyboard.press('Enter');
      await ui.getByRole('menuitemradio', { name: 'Discussing' }).focus();
      await harness.page.keyboard.press('Enter');
      await ui.getByRole('listitem', { name: 'Discussing, 2' }).getByRole('article', { name: 'Product setup review' }).waitFor();
      await ui.getByRole('listitem', { name: 'Exploring, 0' }).waitFor();
      const moved = await invoke(instance, 'list_opportunities', { limit: 50 });
      expect(moved.items.find((item: { title: string }) => item.title === 'Product setup review').stageLabel).toBe('Discussing');
      await shot(harness, 'people-pipeline-1280.png');

      await ui.getByRole('tab', { name: 'Follow-ups' }).click();
      await ui.getByRole('radio', { name: 'I owe' }).waitFor();
      await shot(harness, 'people-followups-1280.png');
      await ui.getByRole('tab', { name: 'Sources' }).click();
      await ui.getByRole('heading', { name: 'Extract relationship context' }).waitFor();
      await shot(harness, 'people-sources-1280.png');

      // Ask Ri stages a draft in Ri's composer. Nothing is sent.
      await ui.getByRole('tab', { name: 'Today' }).click();
      await ui.locator('.pe-record-title', { hasText: 'Maya Chen' }).waitFor();
      const before = harness.prompts.length;
      await ui.locator('.pe-record-head').getByRole('button', { name: 'Ask Ri' }).click();
      await expect.poll(() => harness.prompts.length).toBe(before + 1);
      expect(harness.prompts.at(-1)).toMatch(/Maya Chen/);
      expect(harness.calls.some((item) => /send|message/i.test(item.action))).toBe(false);

      await harness.theme('dark');
      await shot(harness, 'people-dark-1280.png');
      await harness.theme('light');

      await harness.resize(760, 900);
      await ui.getByRole('tab', { name: 'People' }).click();
      await ui.getByRole('table').waitFor();
      await shot(harness, 'people-760.png');

      // Search survives opening a record and coming back.
      await ui.getByRole('searchbox', { name: 'Search people' }).fill('field');
      await expect.poll(async () => ui.getByRole('row').count()).toBe(3);
      await ui.getByRole('row', { name: /Priya Shah/ }).click();
      await ui.getByRole('button', { name: 'Back to people' }).click();
      expect(await ui.getByRole('searchbox', { name: 'Search people' }).inputValue()).toBe('field');
      await expect.poll(async () => ui.getByRole('row').count()).toBe(3);

      // 200% text size on a company workspace.
      await harness.resize(1280, 900);
      await ui.getByRole('searchbox', { name: 'Search people' }).fill('');
      await ui.getByRole('tab', { name: 'Companies' }).click();
      await ui.getByRole('row', { name: /Northstar/ }).click();
      await ui.locator('.pe-record-title', { hasText: 'Northstar' }).waitFor();
      await harness.guest().evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      await shot(harness, 'people-company-text-200.png');
      await harness.guest().evaluate(() => { document.documentElement.style.fontSize = ''; });

      await harness.resize(390, 844);
      await ui.getByRole('tab', { name: 'Today' }).click();
      await ui.getByRole('heading', { name: 'Coming up' }).waitFor();
      await shot(harness, 'people-390.png');

      await harness.resize(360, 760);
      await ui.getByRole('button', { name: /Maya Chen/ }).first().click();
      await ui.getByRole('button', { name: 'Back to today' }).waitFor();
      expect(await harness.guest().evaluate(() => window.scrollY)).toBeLessThan(400);
      await shot(harness, 'people-360.png');
    } finally {
      await harness.close();
    }
  }, 240_000);

  it('opens a new owner on the welcome screen with three ways in, and Connect asks Ri for access', async () => {
    const instance = install(owner);
    const harness = await view(instance, { width: 1280 });
    try {
      const ui = harness.view;
      await ui.getByRole('heading', { name: 'Connect email and calendar' }).waitFor();
      await ui.getByRole('heading', { name: 'Import contacts' }).waitFor();
      await ui.getByRole('heading', { name: 'Add a person' }).waitFor();
      await shot(harness, 'people-empty-1280.png');
      await ui.getByRole('button', { name: 'Connect email and calendar' }).click();
      await expect.poll(() => harness.hostLinks.some((link) => link.includes('/__host/manage-access'))).toBe(true);
      await ui.getByRole('button', { name: 'Add a person' }).click();
      await ui.getByRole('dialog').getByLabel('Name').fill('Robin Vale');
      await ui.getByRole('dialog').getByRole('button', { name: 'Add person' }).click();
      await ui.locator('.pe-record-title', { hasText: 'Robin Vale' }).waitFor();
      await harness.resize(390, 844);
      await shot(harness, 'people-person-390.png');
    } finally {
      await harness.close();
    }
  }, 120_000);

  it('shows partial coverage honestly when one account needs reconnecting', async () => {
    const now = Date.now();
    const recent = (days: number) => new Date(now - days * 864e5).toISOString();
    const world: Record<string, FakeAccount> = {
      personal: {
        email: OWNER,
        mail: [
          mail('p1', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], subject: 'Portfolio discussion', body: 'I would be happy to introduce you to the research lead.', sent: true, date: recent(5), messageId: '<p1@personal.example>' }),
          mail('p2', { from: 'Maya Chen <maya@northstar.example>', to: [OWNER], subject: 'Re: Portfolio discussion', body: 'Thank you. Could you bring an example of a complex product decision?\n\nBest,\nMaya Chen\nDesign lead, Northstar', date: recent(4), inReplyTo: '<p1@personal.example>' }),
          mail('p3', { from: 'Design Weekly <news@designweekly.example>', to: [OWNER], subject: 'This week in design', body: 'Read more', date: recent(3), headers: { 'List-Unsubscribe': '<https://designweekly.example/u>', 'List-Id': 'weekly.designweekly.example' } }),
        ],
        events: [{ id: 'e1', summary: 'Portfolio discussion', start: new Date(now + 864e5).toISOString(), end: new Date(now + 864e5 + 36e5).toISOString(), attendees: [{ email: OWNER, self: true, organizer: true }, { email: 'maya@northstar.example', displayName: 'Maya Chen' }] }],
      },
      work: { email: OWNER_WORK, mail: [] },
    };
    const grants = [grant('personal', 'mail'), grant('personal', 'calendar'), grant('work', 'mail')];
    const instance = install(owner, grants, world, { revoked: new Set(['work']) });
    for (let index = 0; index < 30; index++) {
      const result = await invoke(instance, 'run_background_step', {}, undefined, schedule);
      if (!result.ran) break;
    }
    const harness = await view(instance, { width: 1280 });
    try {
      const ui = harness.view;
      await ui.getByText('1 account needs reconnecting').waitFor();
      await ui.locator('.pe-record-title', { hasText: 'Maya Chen' }).waitFor();
      await shot(harness, 'people-partial-1280.png');
      await ui.getByRole('tab', { name: 'Sources' }).click();
      await ui.getByText('Reconnect needed').first().waitFor();
      await shot(harness, 'people-sources-partial-1280.png');
    } finally {
      await harness.close();
    }
  }, 120_000);
});
