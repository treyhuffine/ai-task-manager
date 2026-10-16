/**
 * The packaged view, end to end: package the app, import the archive, run
 * the packaged server under AppEngine with fake host capabilities, and drive
 * the built dist/ui.html through AppViewController in real headless Chrome.
 * Screenshots go to artifacts/ (ignored). All records are fictional.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { chromium, type Browser, type Page, type FrameLocator } from 'playwright-core';
import { AppError, type AppPrincipal, type InvocationAccess } from '@ri/app-kit/contract';
import { AppEngine, NativeNodeDriver, type HostServices, type InstalledArtifact } from '@ri/app-kit/runtime';
import { importPackage, prepareHtml, validateArtifact } from '@ri/app-kit/build';
import { buildOfflineAppFixture } from '@ri/app-kit/testing';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const appDir = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(appDir, '../..');
const archive = path.join(repo, 'release/local-apps/dev-catalog/ri-job-search.tar.gz');
const artifacts = path.join(appDir, 'artifacts');
/** Real installed Chrome first, then the same fallbacks the app kit's browser tests use. */
const chrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ...['1234', '1223', '1217'].map((build) => path.join(os.homedir(), `Library/Caches/ms-playwright/chromium-${build}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`)),
].find(fs.existsSync);

const temporary: string[] = [];
const tempDir = (prefix: string) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temporary.push(dir); return dir; };

interface Instance { artifact: InstalledArtifact; principal: AppPrincipal; access: InvocationAccess }
let engine: AppEngine;
let browser: Browser;
let server: http.Server;
let port = 0;
let guest: { html: string; scriptHashes: string[] };
const tasks = new Map<string, { id: string; title: string; status: string }>();
const failing = new Set<string>();

async function setupEngine() {
  const services: HostServices = {
    version: 1,
    authorize() {},
    event() {},
    invocationAccess(instance, context) {
      const known = instances.get(instance.instanceId)!;
      return { ...known.access, actorId: `${context.principal.kind}:${context.principal.id}` };
    },
    async capability(_instance, _context, call) {
      const input = call.input as Record<string, unknown>;
      if (call.name === 'create_task') {
        const id = `0192f0aa-0000-7000-8000-${String(input.operationId).replace(/-/g, '').slice(-12)}`;
        const task = tasks.get(id) ?? { id, title: String(input.title), status: 'todo' };
        tasks.set(id, task);
        return task;
      }
      if (call.name === 'get_task') {
        const task = tasks.get(String(input.id));
        if (!task) throw new AppError('not_found', 'That Ri record is no longer available');
        return task;
      }
      if (call.name === 'ai_text') throw new AppError('unsupported', 'Bounded app AI is not available in this fixture');
      if (call.name === 'extract_text') {
        if (!String(input.mimeType).startsWith('text/')) throw new AppError('unsupported', 'Reading PDF and Word files is available once the app is in use');
        const text = Buffer.from(String(input.base64), 'base64').toString('utf8');
        return { text, truncated: false, characters: text.length };
      }
      if (call.account && failing.has(call.account)) throw new AppError('revoked', 'The connection needs to be reconnected');
      throw new AppError('unsupported', 'No fictional provider for this call');
    },
  };
  engine = new AppEngine(services, new NativeNodeDriver(process.execPath));
}
const instances = new Map<string, Instance>();

/** JS_VIEW_OFFLINE=1 builds this source with the kit's offline fixture builder instead of the portable package, for use while packaging is unavailable. */
const offline = process.env.JS_VIEW_OFFLINE === '1';
let offlineDir = '';
async function install(packageDir: string, principal: AppPrincipal, access: Omit<InvocationAccess, 'actorId'>): Promise<Instance> {
  const instanceId = randomUUID();
  const root = tempDir('ri-job-search-instance-');
  const base = offline ? validateArtifact(offlineDir) : await importPackage(archive, path.join(root, 'package'));
  const artifact: InstalledArtifact = { ...base, instanceId, dataDir: path.join(root, 'data'), cacheDir: path.join(root, 'cache'), logsDir: path.join(root, 'logs') };
  void packageDir;
  const instance = { artifact, principal, access: { ...access, actorId: `${principal.kind}:${principal.id}` } };
  instances.set(instanceId, instance);
  return instance;
}

async function invoke(instance: Instance, action: string, input: unknown, invocationId?: string) {
  return engine.invoke(instance.artifact, action, input, instance.principal, 1, invocationId ?? randomUUID()) as Promise<any>;
}

beforeAll(async () => {
  if (!chrome) throw new Error('The packaged view test needs an installed Chromium browser (Chrome, Brave or Chrome for Testing)');
  let imported: { packageDir: string };
  if (offline) {
    offlineDir = path.join(tempDir('ri-job-search-offline-'), 'package');
    fs.cpSync(appDir, offlineDir, { recursive: true, filter: (source) => !/[\\/](node_modules|dist|artifacts|test|\.ri-build)([\\/]|$)/.test(path.relative(appDir, source) ? `/${path.relative(appDir, source)}` : '') });
    const workflows = fs.readdirSync(path.join(appDir, 'skills')).sort().map((name) => {
      const front = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(appDir, 'skills', name, 'SKILL.md'), 'utf8'))![1];
      return { name: /^name:\s*(.+)$/m.exec(front)![1].trim(), description: /^description:\s*(.+)$/m.exec(front)![1].trim(), file: `skills/${name}/SKILL.md` };
    });
    imported = await buildOfflineAppFixture({ packageDir: offlineDir, driver: new NativeNodeDriver(process.execPath), workflows });
  } else {
    await exec('pnpm', ['--filter', 'ri-job-search', 'package'], { cwd: repo, timeout: 280_000, maxBuffer: 16 * 1024 * 1024 });
    imported = await importPackage(archive, path.join(tempDir('ri-job-search-import-'), 'package'));
  }
  guest = prepareHtml(fs.readFileSync(path.join(imported.packageDir, 'dist/ui.html'), 'utf8'));
  await setupEngine();
  const compiled = await build({ stdin: { contents: `import {AppViewController} from ${JSON.stringify(require.resolve('@ri/app-kit/view-host'))};window.AppViewController=AppViewController;`, resolveDir: appDir }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2023', logLevel: 'silent' });
  const hostScript = compiled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>html,body{margin:0;background:#fafafa}#mount{width:100vw;height:100vh}</style></head><body><div id="mount"></div><script>${hostScript}</script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
  browser = await chromium.launch({ executablePath: chrome, headless: true, chromiumSandbox: true, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR } });
  fs.mkdirSync(artifacts, { recursive: true });
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await engine?.dispose();
  for (const dir of temporary.splice(0)) {
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(fs.realpathSync(os.tmpdir())) && !resolved.startsWith(path.resolve(os.tmpdir()))) throw new Error(`Refusing to remove ${dir}`);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

interface HostState { chat: string[]; locations: string[]; sources: number; contexts: unknown[]; errors: string[]; downloads: unknown[] }

/** Open the packaged view in a page, routing its calls to the packaged server. */
async function openView(instance: Instance, options: { path: string; width: number; height?: number; theme?: 'light' | 'dark' }) {
  const page = await browser.newPage({ viewport: { width: options.width, height: options.height ?? 900 } });
  const external: string[] = [];
  const consoleErrors: string[] = [];
  page.on('request', (request) => { if (!request.url().startsWith(`http://127.0.0.1:${port}`) && !request.url().startsWith('data:') && !request.url().startsWith('about:')) external.push(request.url()); });
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  let current = options.path;
  const contract = instance.artifact.contract;
  await page.exposeFunction('hostInvoke', async (action: string, input: unknown, invocationId: string | null) => {
    try {
      const result = await invoke(instance, action, input, invocationId ?? undefined);
      return { ok: true, result, write: contract.actions.find((item) => item.name === action)?.effect !== 'read' };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });
  await page.exposeFunction('hostOpen', async () => (await invoke(instance, 'open_view', { path: current.split('?')[0], query: Object.fromEntries(new URLSearchParams(current.split('?')[1] ?? '')) })).data);
  await page.exposeFunction('hostLocation', (to: string) => { current = to; });
  await page.goto(`http://127.0.0.1:${port}/`);
  const opened = await invoke(instance, 'open_view', { path: options.path, query: {} });
  await page.evaluate(async ({ guest, data, path, digest, theme }) => {
    const w = window as any;
    w.hostState = { chat: [], locations: [], sources: 0, contexts: [], errors: [], downloads: [] } satisfies HostState;
    const controller = new w.AppViewController(document.getElementById('mount'), {
      call: async (action: string, input: unknown, _signal: AbortSignal, meta?: { invocationId?: string }) => {
        const response = await w.hostInvoke(action, input, meta?.invocationId ?? null);
        if (!response.ok) throw new Error(response.error);
        if (response.write) setTimeout(async () => { await controller.refresh(await w.hostOpen()); }, 30);
        return response.result;
      },
      context: async (envelope: unknown) => { w.hostState.contexts.push(envelope); },
      navigate: async (value: string) => {
        const url = new URL(value, 'https://app.invalid');
        if (url.pathname === '/__host/chat') w.hostState.chat.push(url.searchParams.get('prompt'));
        else if (url.pathname === '/__host/location') { w.hostState.locations.push(url.searchParams.get('to')); await w.hostLocation(url.searchParams.get('to')); }
        else if (url.pathname === '/__host/sources' || url.pathname === '/__host/manage-access') w.hostState.sources++;
      },
      externalLink: () => {},
      error: (error: Error) => w.hostState.errors.push(error.message),
      selectFile: async () => w.nextFile ?? null,
      downloadFile: async (contents: unknown) => { w.hostState.downloads.push(contents); },
    });
    w.controller = controller;
    await controller.open(guest, { id: crypto.randomUUID(), packageDigest: digest, initialData: data, path, query: {}, theme, files: { select: { mimeTypes: ['text/plain', 'application/pdf'], maxBytes: 524288 }, download: { mimeTypes: ['application/json'], maxBytes: 524288 } } });
  }, { guest, data: opened.data, path: options.path, digest: instance.artifact.digest, theme: options.theme ?? 'light' });
  const frame = page.frameLocator('#mount iframe').frameLocator('iframe');
  // The relay frame navigates from about:blank to its srcdoc before creating the view frame. Wait for the rendered view.
  const deadline = Date.now() + 20_000;
  for (;;) {
    const inner = page.frames().find((candidate) => candidate.parentFrame()?.parentFrame() === page.mainFrame());
    if (inner && (await inner.locator('#root > *').count().catch(() => 0)) > 0) break;
    if (Date.now() > deadline) throw new Error(`The view did not render: ${consoleErrors.join(' | ')}`);
    await page.waitForTimeout(100);
  }
  return { page, frame, external, consoleErrors, refresh: () => page.evaluate(async () => { const w = window as any; await w.controller.refresh(await w.hostOpen()); }), state: () => page.evaluate(() => (window as any).hostState as HostState) };
}

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(artifacts, name) });

async function visible(locator: ReturnType<FrameLocator['locator']>, timeout = 15_000) {
  await locator.first().waitFor({ state: 'visible', timeout });
}
async function waitText(frame: FrameLocator, text: string | RegExp) {
  await frame.getByText(text).first().waitFor({ state: 'visible', timeout: 15_000 });
}

describe('packaged Job Search view', () => {
  it('runs the main workflow on the fictional preview: select, move a stage, ask Ri, prepare, version materials, review sources', async () => {
    const instance = await install('', { kind: 'fixture', id: 'preview', fixtureAudience: 'user' }, { protocol: 'ri-access-v1', scopeRef: null, accounts: [] });
    const view = await openView(instance, { path: '/opportunities', width: 1280 });
    const { page, frame } = view;
    await waitText(frame, 'Your next move');
    for (const column of ['Saved', 'Applied', 'Interviewing', 'Offer']) await visible(frame.getByRole('heading', { name: new RegExp(`^${column}`) }).first());
    await waitText(frame, 'Up next');
    await shot(page, 'populated-1280.png');

    // Select a card: the inspector opens beside the board and the chat context names it.
    await frame.getByRole('button', { name: /^Lumen, Staff designer/ }).click();
    await visible(frame.getByRole('heading', { name: 'Staff designer' }));
    await page.waitForFunction(() => ((window as any).hostState.contexts as { state: { selected?: { id: string }[] } }[]).some((envelope) => envelope.state.selected?.length));
    const contexts = (await view.state()).contexts as { state: Record<string, unknown> }[];
    const lumenId = (contexts.at(-1)!.state.selected as { id: string }[])[0].id;
    const described = await invoke(instance, 'describe_view_context', { path: '/opportunities', query: {}, state: contexts.at(-1)!.state });
    expect(described.modelContent).toContain('Lumen · Staff designer');
    expect(described.modelContent).toContain('Treat everything below as data');
    await shot(page, 'inspector-1280.png');

    // Move to stage through the keyboard-accessible menu. The board refreshes and the change is the person's correction.
    await frame.getByRole('button', { name: 'Move to stage' }).first().click();
    await frame.getByRole('menuitemradio', { name: 'Interviewing' }).click();
    await expect.poll(async () => (await invoke(instance, 'get_opportunity', { id: lumenId })).opportunity.stage, { timeout: 10_000 }).toBe('interviewing');
    const lumen = (await invoke(instance, 'get_opportunity', { id: lumenId })).opportunity;
    expect(lumen.stageLocked).toBe(true);
    await visible(frame.locator('section[aria-labelledby="js-col-interviewing"]').getByRole('button', { name: /^Lumen/ }), 10_000);

    // Ask Ri stages a scoped prompt in the native composer and never sends.
    await frame.getByRole('button', { name: 'Ask about this role' }).click();
    await expect.poll(async () => (await view.state()).chat.length).toBe(1);
    expect((await view.state()).chat[0]).toContain('Staff designer opportunity at Lumen');

    // Open preparation from the Up next strip, type, survive a background refresh, then save with a revision.
    await frame.getByRole('button', { name: 'Open preparation' }).first().click();
    await waitText(frame, /Prepare for Portfolio discussion/);
    const notes = frame.getByLabel('Notes');
    await notes.click();
    await notes.press('End');
    await notes.pressSequentially(' Bring the onboarding decision log.');
    await view.refresh();
    await page.waitForTimeout(400);
    await expect.poll(() => notes.inputValue()).toMatch(/Bring the onboarding decision log\./);
    await visible(frame.getByText('Unsaved changes'));
    await frame.getByRole('button', { name: 'Save preparation' }).click();
    await visible(frame.getByText(/revision 2/), 10_000);
    const interviewId = (await invoke(instance, 'list_interviews', { limit: 10, upcoming: true })).items.find((item: { company: string }) => item.company === 'Northstar').id;
    await expect.poll(async () => (await view.state()).locations.some((location) => location.startsWith(`/interviews/${interviewId}`))).toBe(true);
    const preparation = await invoke(instance, 'get_preparation', { interviewId });
    expect(preparation.notes).toContain('Bring the onboarding decision log.');
    expect(preparation.revision).toBe(2);
    await frame.getByRole('button', { name: 'Suggest from my saved evidence' }).click();
    await waitText(frame, 'Extraction unavailable');
    await frame.locator('body').evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await shot(page, 'preparation-1280.png');
    await frame.getByRole('button', { name: 'Prepare with Ri' }).first().click();
    await expect.poll(async () => (await view.state()).chat.length).toBe(2);
    expect((await view.state()).chat[1]).toMatch(/Prepare me for my Portfolio discussion.*Northstar.*Product design résumé v3/);

    // Materials: versions, compare, and editing v4 saves v5 while v3 stays submitted.
    await frame.getByRole('tab', { name: 'Materials' }).click();
    await frame.getByRole('row', { name: /Product design résumé/ }).click();
    await visible(frame.getByRole('heading', { name: 'Product design résumé' }));
    await frame.getByRole('button', { name: 'Compare versions' }).click();
    await visible(frame.getByRole('list', { name: /Changes from v3 to v4/ }));
    await frame.locator('body').evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await shot(page, 'materials-1280.png');
    await frame.getByRole('button', { name: 'Show text' }).click();
    await frame.getByRole('button', { name: 'Edit as a new version' }).click();
    const editor = frame.getByLabel('Text', { exact: true });
    await editor.press('End');
    await editor.pressSequentially('\nPortfolio available on request.');
    await frame.getByRole('button', { name: 'Save as v5' }).click();
    await waitText(frame, /^v5$/);
    const materials = await invoke(instance, 'list_materials', { limit: 50, archived: false });
    const resume = materials.items.find((item: { title: string }) => item.title === 'Product design résumé');
    expect(resume.latestNumber).toBe(5);
    const v3 = resume.versions.find((version: { number: number }) => version.number === 3);
    expect(v3.submitted).toBe(true);
    expect(v3.usedBy.map((use: { company: string }) => use.company).sort()).toEqual(['Lumen', 'Northstar']);
    expect(resume.versions.find((version: { number: number }) => version.number === 5).submitted).toBe(false);

    // Sources: the review queue shows both candidates with evidence and an Ignore choice.
    await frame.getByRole('tab', { name: /Sources/ }).click();
    await waitText(frame, 'Two design roles');
    await visible(frame.getByRole('list', { name: /Evidence for Fieldwork Product lead/ }));
    await visible(frame.getByRole('button', { name: 'Ignore' }).first());
    await shot(page, 'sources-1280.png');

    await frame.getByRole('tab', { name: 'Today' }).click();
    await waitText(frame, 'One interview ahead');
    await shot(page, 'today-1280.png');

    await page.evaluate(() => (window as any).controller.theme('dark'));
    await page.evaluate(() => { document.body.style.background = '#151515'; });
    await frame.getByRole('tab', { name: 'Opportunities' }).click();
    await waitText(frame, 'Up next');
    await shot(page, 'dark-1280.png');

    expect(view.external).toEqual([]);
    expect(view.consoleErrors).toEqual([]);
    expect((await view.state()).errors).toEqual([]);
    await page.close();
  }, 180_000);

  it('fits narrow frames: two columns at 760, stage sections at 390 and 360, detail screens with Back', async () => {
    const instance = await install('', { kind: 'fixture', id: 'preview-narrow', fixtureAudience: 'user' }, { protocol: 'ri-access-v1', scopeRef: null, accounts: [] });
    for (const width of [760, 390, 360]) {
      const view = await openView(instance, { path: '/opportunities', width, height: 844 });
      const { page, frame } = view;
      await waitText(frame, 'Your next move');
      const overflow = await page.evaluate(() => {
        const outer = document.querySelector('#mount iframe') as HTMLIFrameElement;
        return outer.getBoundingClientRect().width;
      });
      expect(overflow).toBeLessThanOrEqual(width);
      await shot(page, `opportunities-${width}.png`);
      await frame.getByRole('button', { name: /^Northstar, Product designer/ }).click();
      await visible(frame.getByRole('button', { name: 'Back to opportunities' }));
      await visible(frame.getByRole('tab', { name: 'Correspondence' }));
      await visible(frame.getByRole('heading', { name: 'Product designer' }));
      await page.waitForTimeout(300);
      await shot(page, `workspace-${width}.png`);
      await frame.getByRole('button', { name: 'Back to opportunities' }).click();
      await visible(frame.getByRole('button', { name: /^Northstar, Product designer/ }));
      if (width === 360) {
        await frame.getByRole('tab', { name: 'Today' }).click();
        await waitText(frame, 'One interview ahead');
        await shot(page, 'today-360.png');
      }
      expect(view.external).toEqual([]);
      expect(view.consoleErrors).toEqual([]);
      await page.close();
    }
  }, 180_000);

  it('shows the empty state for a new owner, saves a job through the dialog, and reports a disconnected account honestly', async () => {
    const owner = await install('', { kind: 'owner-ui', id: 'owner' }, { protocol: 'ri-access-v1', scopeRef: null, accounts: [{ account: 'conn-mail-err', binding: 'mail', actions: ['gmail.get_profile'], automatic: true }] });
    const view = await openView(owner, { path: '/', width: 1280 });
    const { page, frame } = view;
    await waitText(frame, 'Keep your next opportunity together');
    await visible(frame.getByRole('button', { name: 'Save a job' }));
    await visible(frame.getByRole('button', { name: 'Connect email' }));
    await shot(page, 'empty-1280.png');

    // The account's next update fails with a revoked connection: records stay and the view says so.
    failing.add('conn-mail-err');
    const failed = await invoke(owner, 'continue_import', { source: 'account:conn-mail-err' });
    expect(failed.message).toMatch(/reconnected/);

    await frame.getByRole('button', { name: 'Save a job' }).click();
    await frame.getByLabel('Job description').fill('Platform designer at Pinecrest\nLocation: Boulder, CO (Hybrid)\n\nRequirements\n- Five years designing internal platforms.\n- Clear writing for engineering partners.\n\nSalary: $70 to $85 per hour, contract.');
    await frame.getByRole('button', { name: 'Preview' }).click();
    await expect.poll(() => frame.getByLabel('Company').inputValue()).toBe('Pinecrest');
    await expect.poll(() => frame.getByLabel('Role').inputValue()).toBe('Platform designer');
    await waitText(frame, /\$70 to \$85 an hour/);
    await frame.getByRole('button', { name: 'Save job' }).click();
    await waitText(frame, /Five years designing internal platforms/);
    await waitText(frame, /needs to be reconnected in Ri/);
    await shot(page, 'reconnect-1280.png');
    const list = await invoke(owner, 'list_opportunities', { limit: 50, view: 'active' });
    expect(list.items.map((item: { company: string }) => item.company)).toEqual(['Pinecrest']);
    expect(list.coverage.partial).toBe(true);

    const narrow = await openView(owner, { path: '/sources', width: 390, height: 844 });
    await waitText(narrow.frame, 'Reconnect needed');
    await shot(narrow.page, 'error-sources-390.png');
    await narrow.page.close();
    const empty = await install('', { kind: 'owner-ui', id: 'owner-2' }, { protocol: 'ri-access-v1', scopeRef: null, accounts: [] });
    const emptyNarrow = await openView(empty, { path: '/', width: 390, height: 844 });
    await waitText(emptyNarrow.frame, 'Keep your next opportunity together');
    await shot(emptyNarrow.page, 'empty-390.png');
    await emptyNarrow.page.close();
    expect(view.external).toEqual([]);
    expect(view.consoleErrors).toEqual([]);
    await page.close();
  }, 180_000);
});
