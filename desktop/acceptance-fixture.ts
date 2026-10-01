import { writeDesktopHomeIntent } from '../src/lib/service/desktop-role-intent';
/** Shared isolated-home fixture for packaged desktop acceptance checks.
 * No builds, OS login jobs, real accounts, tunnels or external providers. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { demoEnvironment } from './config';
import { desktopPackageLayout } from './package-layout';
import { serviceStatus, stopService } from '../src/lib/service/client';
import { HOTKEYS, type Hotkey } from '../src/constants/commands';

export async function bounded<T>(promise: Promise<T>, description: string, timeout = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

export async function eventually(check: () => Promise<boolean>, description: string, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await bounded(check(), description, Math.max(1, deadline - Date.now()))) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}

export async function hotkey(page: Page, name: keyof typeof HOTKEYS) {
  const key: Hotkey = HOTKEYS[name];
  await page.keyboard.press([key.meta && (process.platform === 'darwin' ? 'Meta' : 'Control'), key.shift && 'Shift', key.key].filter(Boolean).join('+'));
}

export async function api<T>(page: Page, route: string, method = 'GET', body?: unknown): Promise<T> {
  return bounded(page.evaluate(async ({ route, method, body }) => {
    const response = await fetch(route, {
      method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${await response.text()}`);
    return response.json();
  }, { route, method, body }), `${method} ${route} renderer request`, 20_000);
}

/** Navigate through a real renderer link and Electron's save guard. */
export async function nativeNavigate(page: Page, target: string, report: Record<string, unknown> = {}) {
  await page.waitForFunction(platform => document.documentElement.dataset.riDesktop === platform, process.platform);
  assert.equal(new URL(target).origin, new URL(page.url()).origin, 'Acceptance navigation must stay on the fixture origin');
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.waitForFunction(() => !document.body.inert);
    // CDP Page.navigate can abort/stopLoading the guard's replacement loadURL.
    await bounded(page.evaluate(target => {
      const link = document.createElement('a');
      link.href = target; document.body.append(link); link.click(); link.remove();
    }, target), 'renderer navigation dispatch', 10_000);
    try { await page.waitForURL(target, { timeout: 20_000 }); break; }
    catch (error) {
      if (attempt === 1) throw error;
      const retries = (report.navigationRetries ??= []) as unknown[];
      retries.push(await bounded(page.evaluate(() => ({ url: location.href, bodyInert: document.body.inert,
        readyState: document.readyState, desktop: document.documentElement.dataset.riDesktop,
        draftKeys: Object.keys(localStorage).filter(key => key.startsWith('ri:document-draft:v1:')) })), 'navigation diagnostics', 5_000));
    }
  }
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(platform => document.documentElement.dataset.riDesktop === platform, process.platform);
}

/** Invoke native Reload, allowing one recorded retry if pending saves veto it. */
export async function nativeReload(app: ElectronApplication, page: Page, report: Record<string, unknown> = {}) {
  await page.waitForFunction(platform => document.documentElement.dataset.riDesktop === platform, process.platform);
  const previous = await bounded(page.evaluate(() => performance.timeOrigin), 'reload document identity', 5_000);
  for (let attempt = 0; attempt < 2; attempt++) {
    await bounded(app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload()), 'native reload dispatch', 10_000);
    try { await page.waitForFunction(prior => performance.timeOrigin !== prior, previous, { timeout: 10_000 }); break; }
    catch (error) {
      if (attempt === 1) throw error;
      const retries = (report.reloadRetries ??= []) as unknown[];
      retries.push(await bounded(page.evaluate(() => ({ url: location.href, bodyInert: document.body.inert,
        draftKeys: Object.keys(localStorage).filter(key => key.startsWith('ri:document-draft:v1:')) })), 'reload diagnostics', 5_000));
    }
  }
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(platform => document.documentElement.dataset.riDesktop === platform, process.platform);
}

export class AcceptanceFixture {
  readonly base: string;
  readonly root: string;
  readonly env: Record<string, string>;
  readonly executable: string;
  readonly source: boolean;
  readonly report: Record<string, unknown>;
  app?: ElectronApplication;
  page?: Page;
  origin?: string;

  constructor(name: string, options: { chooseHome?: boolean; source?: boolean; development?: boolean } = {}) {
    this.source = options.source === true;
    assert(!options.development || this.source, 'Development acceptance requires a source viewer');
    const packaged = process.env.RI_DESKTOP_PACKAGE;
    assert(packaged || this.source, 'Set RI_DESKTOP_PACKAGE to an already built package directory (.app on macOS, linux-unpacked on Linux).');
    const layout = packaged ? desktopPackageLayout(packaged) : undefined;
    this.executable = this.source ? electron as unknown as string : layout!.executable;
    assert(fs.existsSync(this.executable), `No packaged executable at ${this.executable}`);
    this.base = fs.mkdtempSync(path.join(os.tmpdir(), `ri-${name}-`));
    this.root = path.join(this.base, 'home');
    const home = path.join(this.base, 'os-home');
    fs.mkdirSync(home);
    const inherited = { ...process.env };
    // Keep test controls out of child application state. A packaged app has no
    // access to the contributor's dotfiles or harnesses through HOME/PATH.
    for (const key of Object.keys(inherited)) {
      if (/^(?:RI_|OPENAI_|ANTHROPIC_|GROQ_|BEAMD_|CLAUDE_|CODEX_|CURSOR_|OPENCODE_)/.test(key)) delete inherited[key];
    }
    this.env = Object.fromEntries(Object.entries(demoEnvironment(path.resolve(__dirname, '..'), {
      ...inherited, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'),
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      RI_DESKTOP_STATE_DIR: path.join(this.base, 'desktop-state'), RI_DESKTOP_ROOT: this.root,
      RI_INSTALL_ROOT: path.join(this.base, 'runtime'), RI_DESKTOP_SMOKE: '1',
    }, options.development ? 'development' : 'production')).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    // Empty values prevent Next from filling provider secrets back from a
    // source checkout's .env.local during isolated acceptance.
    for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY', 'BEAMD_API_KEY']) this.env[key] = '';
    if (this.source) this.env.RI_DESKTOP_NODE = process.execPath;
    const manifest = layout && !this.source ? JSON.parse(fs.readFileSync(path.join(layout.resources, 'runtime-manifest.json'), 'utf8')) : undefined;
    this.report = {
      name, artifacts: this.base, platform: process.platform, startedAt: new Date().toISOString(),
      package: this.source ? 'source Electron and runtime' : path.resolve(packaged!), runtimeId: manifest?.id,
      asarSha256: layout && !this.source ? createHash('sha256').update(fs.readFileSync(path.join(layout.resources, 'app.asar'))).digest('hex') : undefined,
      checks: [],
    };
    this.select();
    if (options.chooseHome !== false) writeDesktopHomeIntent();
  }

  select() {
    for (const key of ['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR', 'RI_INSTALL_ROOT']) delete process.env[key];
    Object.assign(process.env, this.env);
  }

  async launchRaw(args: string[] = [], options: { source?: boolean } = {}) {
    this.select();
    assert(!this.app, 'Quit the current viewer before reopening it');
    console.info(`[acceptance] Launching ${this.source || options.source ? 'source' : 'packaged'} viewer with temporary home ${this.root}`);
    this.app = await _electron.launch({ executablePath: options.source || this.source ? electron as unknown as string : this.executable, args: options.source || this.source ? [path.resolve(__dirname, '../dist/desktop/main.cjs'), ...args] : args, cwd: this.base, env: this.env, timeout: 240_000 });
    const page = await this.app.firstWindow({ timeout: 30_000 });
    page.setDefaultTimeout(30_000);
    // Electron can cancel beforeunload before Chromium's CDP dialog reply.
    // Playwright's automatic handler otherwise turns that benign race into
    // an unhandled "No dialog is showing" rejection outside our cleanup.
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
    // Refuse renderer requests to external services during these checks.
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return /^https?:$/.test(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? route.abort() : route.continue();
    });
    this.page = page;
    return page;
  }

  async launch(args: string[] = []) {
    const started = Date.now();
    const page = await this.launchRaw(args);
    await page.waitForURL(url => url.protocol === 'https:', { timeout: 240_000 });
    this.origin = new URL(page.url()).origin;
    if (new URL(page.url()).pathname === '/welcome') {
      await page.getByText('Welcome to Ri', { exact: true }).waitFor();
      await api(page, '/api/user-state', 'PATCH', { onboardedAt: new Date().toISOString() });
      await this.navigate('/');
    }
    await page.locator('aside:visible').first().waitFor();
    assert.equal(await page.evaluate(() => window.riDesktop?.platform), process.platform);
    assert.equal(await page.evaluate(() => typeof window.riDesktop?.settings), 'function', 'Local Home viewer requires its settings bridge');
    assert.equal(await page.evaluate(() => typeof window.riDesktop?.notifications), 'function', 'Local Home viewer requires its notification bridge');
    assert.equal((await serviceStatus())?.phase, 'running');
    const launches = (this.report.launches ??= []) as unknown[];
    launches.push({ readyMs: Date.now() - started, origin: this.origin });
    console.info('[acceptance] Viewer and local service are ready');
    return page;
  }

  async navigate(route: string) {
    assert(this.page && this.origin, 'Launch before navigating');
    await nativeNavigate(this.page, new URL(route, this.origin).href, this.report);
  }

  async reload() {
    assert(this.app && this.page, 'Launch before reloading');
    await nativeReload(this.app, this.page, this.report);
  }

  check(name: string, detail?: unknown) {
    (this.report.checks as unknown[]).push({ name, ...(detail === undefined ? {} : { detail }) });
    console.info(`[acceptance] ${name}`);
  }

  async quit() {
    if (!this.app) return;
    const app = this.app;
    await bounded(Promise.all([app.waitForEvent('close', { timeout: 30_000 }), app.evaluate(({ app }) => app.quit())]), 'native viewer quit', 35_000);
    this.app = undefined;
    this.page = undefined;
  }

  async cleanup() {
    // Failed assertions must not strand a renderer or its detached service.
    if (this.page && !this.page.isClosed()) await bounded(this.page.context().setOffline(false), 'cleanup network reset', 5_000).catch(() => {});
    try { await this.quit(); }
    catch { this.app?.process().kill('SIGKILL'); this.app = undefined; }
    this.select();
    await stopService();
    assert.equal(await serviceStatus(), null, 'Acceptance service was left running');
    // Preserve the small data home, logs and screenshots for investigation.
    // The immutable runtime is identified in the report and remains in the
    // input package, so repeated acceptance runs need not keep duplicate GBs.
    fs.rmSync(path.join(this.base, 'runtime'), { recursive: true, force: true });
  }
}

export async function acceptance(name: string, run: (fixture: AcceptanceFixture) => Promise<void>, options: { source?: boolean; development?: boolean; chooseHome?: boolean } = {}) {
  const fixture = new AcceptanceFixture(name, options);
  let failure: unknown;
  try { await run(fixture); }
  catch (error) {
    failure = error;
    fixture.report.error = error instanceof Error ? error.stack : String(error);
    fixture.report.renderer = fixture.page ? await bounded(fixture.page.evaluate(() => ({
      url: location.href, readyState: document.readyState, desktop: document.documentElement.dataset.riDesktop,
      bodyInert: document.body.inert, activeElement: document.activeElement?.tagName,
      visibility: document.visibilityState, hasFocus: document.hasFocus(),
      editors: [...document.querySelectorAll('[contenteditable]')].map(element => ({ editable: element.getAttribute('contenteditable'), label: element.getAttribute('aria-label'), disabled: element.getAttribute('aria-disabled') })),
      activeInputs: [...document.querySelectorAll('[data-active-input]')].map(element => element.getAttribute('data-active-input')),
      draftKeys: Object.keys(localStorage).filter(key => key.startsWith('ri:document-draft:v1:')),
    })), 'failed renderer diagnostics', 5_000).catch(() => undefined) : undefined;
    await fixture.page?.screenshot({ path: path.join(fixture.base, 'failure.png'), timeout: 5_000 }).catch(() => {});
  }
  finally {
    try { await fixture.cleanup(); fixture.report.serviceStopped = true; }
    catch (error) { failure ??= error; fixture.report.cleanupError = String(error); }
    fixture.report.passed = !failure;
    fixture.report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(fixture.base, 'report.json'), JSON.stringify(fixture.report, null, 2));
    console.info(JSON.stringify(fixture.report, null, 2));
  }
  if (failure) throw failure;
}
