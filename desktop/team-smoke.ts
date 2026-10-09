/** Real Electron, real team services, disposable roots (docs/homes-spec.md §3.1, P6.2/P6.5).
 *
 *   pnpm desktop:team-smoke [--personal] [--production] [--join <team origin>]
 *   (with --join, set RI_TEAM_SMOKE_INVITE to an invitation link made in that team.
 *   --production serves from the production build, `node desktop/launch.mjs --build-only`)
 *
 * A fresh desktop with no personal Ri:
 *   1. Create a team from the welcome's quiet action: the team gets its own
 *      root, service and window, signed in as its owner, and no personal
 *      database is made. Its page has no desktop bridge.
 *   2. Quit and relaunch: the saved team opens directly.
 *   3. With --join, join another team from Connect to Ri with an invitation:
 *      its name shows first, local agents are never offered, and it opens in
 *      its own window.
 *   4. Then that team's host goes out of reach: the next launch says why on
 *      the welcome, and the team hosted here still opens from it.
 *
 * With --personal, a desktop that already holds a personal Ri, with an
 * unsaved draft open in it, creates a team from the Window menu (and with
 * --join, joins one there too). The team opens in its own window, the setup
 * page steps aside, and the personal Ri's page, draft, data, Home choice and
 * service are exactly as they were.
 *
 * Every service it started is stopped at the end.
 *
 * Electron runs on its own with a DevTools port, and the checks speak plain
 * CDP to each renderer: Playwright's Electron and CDP attachment wait on the
 * main window, which never loads a page of its own.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import electron from 'electron';
import getPort from 'get-port';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { AcceptanceFixture } from './acceptance-fixture';
import { serviceStatus, stopService } from '../src/lib/service/client';

const joinIndex = process.argv.indexOf('--join');
const joinOrigin = joinIndex > 0 ? process.argv[joinIndex + 1] : null;
const personal = process.argv.includes('--personal');
const production = process.argv.includes('--production');
/** A production desktop takes only HTTPS team links: a plain HTTP one is refused, with why. */
const refusesPlainHttp = production && !!joinOrigin?.startsWith('http:');
const PLAIN_HTTP_REFUSED = "Use the team's HTTPS link. Plain HTTP works only for local development.";
const fixture = new AcceptanceFixture(personal ? 'team-desktop-personal' : 'team-desktop', { chooseHome: personal, source: true, development: !production });
const stateDir = fixture.env.RI_DESKTOP_STATE_DIR!;
const checks: string[] = [];
const passed = (name: string) => { checks.push(name); console.info(`[team-smoke] ${name}`); };
let electronProcess: ChildProcess | undefined;
let port = 0;
let inspectPort = 0;

interface Target { id: string; type: string; url: string; webSocketDebuggerUrl: string }

/** One renderer over CDP: evaluate, and capture. */
class Renderer {
  private socket: WebSocket;
  private next = 0;
  private waiting = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>();
  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (message.id !== undefined) this.waiting.get(message.id)?.(message);
    });
  }
  static async open(target: Target) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await once(socket, 'open');
    return new Renderer(socket);
  }
  private send(method: string, params: object = {}, timeoutMs = 10_000): Promise<unknown> {
    const id = ++this.next;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      // A renderer with no document (the main window never loads one) never answers.
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.waiting.set(id, (message) => {
        clearTimeout(timer);
        this.waiting.delete(id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      });
    });
  }
  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }) as { result: { value: T }; exceptionDetails?: { text: string } };
    if (result.exceptionDetails) throw new Error(`In the page: ${result.exceptionDetails.text}`);
    return result.result.value;
  }
  async until(expression: string, timeout = 60_000, what = expression) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.evaluate<boolean>(`(() => { try { return !!(${expression}); } catch { return false; } })()`).catch(() => false)) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`Timed out waiting for ${what}`);
  }
  async screenshot(file: string) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png' }).catch(() => null) as { data: string } | null;
    if (shot) fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  }
  close() { this.socket.close(); }
}

async function targets(): Promise<Target[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return ((await response.json()) as Target[]).filter((target) => target.type === 'page');
}

async function launch() {
  port = await getPort({ host: '127.0.0.1' });
  inspectPort = await getPort({ host: '127.0.0.1' });
  const child = spawn(String(electron), [`--remote-debugging-port=${port}`, `--inspect=${inspectPort}`, path.resolve(__dirname, '../dist/desktop/main.cjs')], {
    cwd: fixture.base,
    env: fixture.env as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  electronProcess = child;
  const log = (data: Buffer) => fs.appendFileSync(path.join(fixture.base, 'electron.log'), data);
  child.stdout?.on('data', log);
  child.stderr?.on('data', log);
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await targets();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

async function companion(): Promise<Renderer> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    for (const target of await targets()) {
      if (!target.url || !target.url.startsWith('data:')) continue;
      const renderer = await Renderer.open(target);
      if (await renderer.evaluate<boolean>(`document.documentElement.dataset.riLocalView === 'companion'`).catch(() => false)) return renderer;
      renderer.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('The welcome never showed');
}

async function teamRenderer(origin: (url: URL) => boolean, timeout = 360_000): Promise<Renderer> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const target of await targets()) {
      try {
        if (origin(new URL(target.url))) return await Renderer.open(target);
      } catch {
        // about:blank, data: pages
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('The team never opened in its own window');
}

/** The first page renderer where `expression` holds. */
async function rendererWhere(expression: string, timeout: number, what: string): Promise<Renderer> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const target of await targets()) {
      if (!target.url.startsWith('https:')) continue;
      const renderer = await Renderer.open(target);
      if (await renderer.evaluate<boolean>(`(() => { try { return !!(${expression}); } catch { return false; } })()`).catch(() => false)) return renderer;
      renderer.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Click an application menu item, as a person would, through Electron's main process. */
async function menu(label: string) {
  const response = await fetch(`http://127.0.0.1:${inspectPort}/json/list`);
  const [target] = (await response.json()) as Target[];
  const main = await Renderer.open(target);
  try {
    const clicked = await main.evaluate<boolean>(`(() => {
      const { Menu } = process.mainModule.require('electron');
      const find = (items) => { for (const item of items) { if (item.label === ${JSON.stringify(label)}) return item; const inner = item.submenu && find(item.submenu.items); if (inner) return inner; } return null; };
      const item = find(Menu.getApplicationMenu().items);
      if (!item) return false;
      item.click();
      return true;
    })()`);
    assert.ok(clicked, `No ${label} in the application menu`);
  } finally {
    main.close();
  }
}

async function quit() {
  if (!electronProcess) return;
  const exited = once(electronProcess, 'exit');
  electronProcess.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 60_000))]);
  if (electronProcess.exitCode === null) electronProcess.kill('SIGKILL');
  electronProcess = undefined;
}

async function stopTeamServices() {
  const teamsDir = path.join(stateDir, 'teams');
  if (!fs.existsSync(teamsDir)) return;
  for (const name of fs.readdirSync(teamsDir)) {
    const root = path.join(teamsDir, name);
    Object.assign(process.env, { RI_ROOT: root, RI_DB_PATH: '', RI_CONFIG_DIR: '', RI_WORK_DIR: '' });
    await stopService().catch(() => {});
    assert.equal(await serviceStatus(), null, `The team service in ${root} was left running`);
  }
  fixture.select();
}

const value = (id: string, text: string) =>
  `(() => { const el = document.getElementById(${JSON.stringify(id)}); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input')); return true; })()`;
const click = (id: string) => `(() => { document.getElementById(${JSON.stringify(id)}).click(); return true; })()`;
const text = (needle: string) => `document.body && document.body.innerText.includes(${JSON.stringify(needle)})`;
const localTeam = (url: URL) => url.protocol === 'https:' && url.hostname === 'localhost';

/** On a failure, what every open page showed: its text and a screenshot. */
async function diagnose() {
  const pages = await targets().catch(() => [] as Target[]);
  for (const [index, target] of pages.entries()) {
    const renderer = await Renderer.open(target).catch(() => null);
    if (!renderer) continue;
    const shown = await renderer.evaluate<string>(`document.body ? document.body.innerText : ''`).catch(() => '(no document)');
    fs.writeFileSync(path.join(fixture.base, `failure-${index}.txt`), `${target.url.slice(0, 120)}\n\n${shown}`);
    await renderer.screenshot(path.join(fixture.base, `failure-${index}.png`));
    renderer.close();
  }
}

/** Paste a plain HTTP invitation into a production desktop: nothing is joined, and it says why. */
async function refusedPlainHttp(page: Renderer, invite: string) {
  await page.evaluate(value('pairing', invite));
  await page.until(`document.getElementById('error').textContent === ${JSON.stringify(PLAIN_HTTP_REFUSED)}`, 30_000, 'the plain HTTP refusal');
  assert.equal(await page.evaluate<boolean>(`document.getElementById('link-destination').hidden`), true);
  passed('a production desktop refuses a plain HTTP invitation and says why');
}

/** Everything about the personal Ri that a team must never touch. */
async function personalState() {
  const db = new Database(path.join(fixture.root, 'data.db'), { readonly: true, fileMustExist: true });
  try {
    const rows = (sql: string) => db.prepare(sql).all();
    return JSON.stringify({
      home: rows('SELECT id, kind, name FROM home'),
      tasks: rows('SELECT id, updated_at FROM tasks ORDER BY id'),
      notes: rows('SELECT id, updated_at FROM notes ORDER BY id'),
      devices: rows('SELECT id, revoked_at FROM devices ORDER BY id'),
      keys: rows('SELECT id, role, revoked_at FROM api_keys ORDER BY id'),
      config: fs.readdirSync(path.join(fixture.root, '.config')).filter((name) => /^(desktop-role|connection|team)\.json$/.test(name))
        .map((name) => [name, fs.readFileSync(path.join(fixture.root, '.config', name), 'utf8')]),
      service: (await serviceStatus())?.pid ?? null,
    });
  } finally {
    db.close();
  }
}

async function runPersonal() {
  await launch();
  const app = await rendererWhere(`document.documentElement.dataset.riAuthority === 'personal' && document.body.innerText.length > 0`, 600_000, 'the personal Ri');
  const personalOrigin = await app.evaluate<string>('location.origin');
  await app.evaluate(`(localStorage.setItem('ri:document-draft:v1:team-smoke', 'Unsaved words'), true)`);
  // Some personal work for a team to leave alone, made the way the app makes it.
  const post = (procedure: string, input: object) =>
    `fetch('/api/trpc/${procedure}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(input))} }).then((r) => r.status)`;
  assert.equal(await app.evaluate<number>(post('tasks.create', { title: 'Personal errand', rawInput: 'Personal errand' })), 200);
  assert.equal(await app.evaluate<number>(post('notes.create', { title: 'Private note', body: 'Only mine' })), 200);
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const page = await app.evaluate<string>('location.href');
  const before = await personalState();
  const seeded = JSON.parse(before) as { service: number | null; tasks: unknown[]; notes: unknown[] };
  assert.ok(seeded.service, 'The personal service is running');
  assert.equal(seeded.tasks.length, 1);
  assert.equal(seeded.notes.length, 1);
  passed('a desktop holding a personal Ri, with a task, a note and an unsaved draft in it');
  const untouched = async (after: string) => {
    assert.equal(await app.evaluate<string>('location.href'), page, 'The personal page stayed where it was');
    assert.equal(await app.evaluate<string>(`localStorage.getItem('ri:document-draft:v1:team-smoke')`), 'Unsaved words');
    assert.equal(await personalState(), before, `The personal Ri changed after ${after}`);
    assert.equal(fs.existsSync(path.join(fixture.root, '.config', 'team.json')), false);
  };
  const setupStepsAside = async () => {
    const deadline = Date.now() + 15_000;
    while ((await targets()).some((t) => t.url.startsWith('data:')) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal((await targets()).some((t) => t.url.startsWith('data:')), false, 'The setup page stepped aside for the personal Ri');
  };

  await menu('Create a Team…');
  const create = await companion();
  await create.until(`!document.getElementById('create-team').hidden`, 10_000, 'the Create a team form');
  await create.evaluate(value('team-name', 'Family'));
  await create.evaluate(value('owner-name', 'Ana'));
  await create.evaluate(click('create-team-button'));
  const team = await teamRenderer((url) => localTeam(url) && url.origin !== personalOrigin);
  await team.until(text('Task Board'), 300_000, "the team's Task Board");
  assert.equal(await team.evaluate<string>(`document.documentElement.dataset.riAuthority`), 'team');
  assert.equal(await team.evaluate<string>(`typeof window.riDesktop`), 'undefined');
  create.close();
  await setupStepsAside();
  passed('created a team from the Window menu, in its own window, and the setup page stepped aside');
  await untouched('creating a team');
  passed('the personal Ri, its page, draft, data, Home choice and service are as they were');
  await team.screenshot(path.join(fixture.base, 'personal-hosted-team.png'));
  team.close();

  if (joinOrigin) {
    const invite = process.env.RI_TEAM_SMOKE_INVITE;
    assert.ok(invite, 'Set RI_TEAM_SMOKE_INVITE to an invitation link from the --join team');
    await menu('Join a Team…');
    const join = await companion();
    await join.until(`!document.getElementById('connect').hidden`, 10_000, 'the link form');
    assert.equal(await join.evaluate<string>(`document.getElementById('heading').textContent`), 'Join a team');
    if (refusesPlainHttp) {
      await refusedPlainHttp(join, invite);
      await untouched('refusing a link');
      join.close();
      app.close();
      return;
    }
    await join.evaluate(value('pairing', invite));
    await join.until(`!document.getElementById('link-destination').hidden`, 30_000, "the invitation's destination");
    assert.equal(await join.evaluate<boolean>(`document.getElementById('run-work-label').hidden`), true);
    await join.evaluate(value('member-name', 'Bo'));
    await join.screenshot(path.join(fixture.base, 'personal-join-team.png'));
    await join.evaluate(click('connect-home'));
    const joined = await teamRenderer((url) => url.origin === new URL(joinOrigin).origin);
    await joined.until(text('Task Board'), 120_000, "the joined team's Task Board");
    join.close();
    await setupStepsAside();
    passed('joined a team from Join a Team…, beside the personal Ri');
    await untouched('joining a team');
    passed('the personal Ri is still as it was');
    joined.close();
  }
  app.close();
}

async function run() {
  let failure: unknown;
  try {
    if (personal) {
      await runPersonal();
      return;
    }
    // 1. Create a team from the welcome.
    await launch();
    const setup = await companion();
    await setup.until(`!document.getElementById('welcome').hidden`, 60_000, 'the welcome');
    assert.equal(await setup.evaluate<string>(`document.getElementById('choose-connect').textContent`), 'Connect to Ri');
    await setup.evaluate(click('choose-create-team'));
    await setup.until(`!document.getElementById('create-team').hidden`, 30_000, 'the Create a team form');
    await setup.evaluate(value('team-name', 'Family'));
    await setup.evaluate(value('owner-name', 'Ana'));
    await setup.screenshot(path.join(fixture.base, 'create-team-form.png'));
    await setup.evaluate(click('create-team-button'));
    const hosted = await teamRenderer(localTeam);
    await hosted.until(text('Task Board'), 300_000, "the team's Task Board");
    await hosted.until(text('Family'), 30_000, "the team's name");
    passed('created a team hosted here and opened its Task Board as its owner');
    assert.equal(await hosted.evaluate<string>(`typeof window.riDesktop`), 'undefined', 'A team page must not get the desktop bridge');
    assert.equal(await hosted.evaluate<string>(`document.documentElement.dataset.riAuthority`), 'team');
    assert.equal(await hosted.evaluate<string>(`location.hash`), '', 'The sign-in key must leave the address');
    passed('the team page has no desktop bridge, and its key left the address');
    assert.equal(fs.existsSync(path.join(fixture.root, 'data.db')), false, 'A team-only desktop must not make a personal database');
    const teamsJson = path.join(stateDir, 'teams.json');
    const saved = JSON.parse(fs.readFileSync(teamsJson, 'utf8')) as { teams: Array<{ name: string; hosted: { root: string } | null }>; pending: unknown };
    assert.equal(saved.pending, null);
    assert.equal(saved.teams[0]?.name, 'Family');
    assert.equal(fs.statSync(teamsJson).mode & 0o777, 0o600);
    assert.ok(fs.existsSync(path.join(saved.teams[0].hosted!.root, '.config', 'team.json')), 'The team has its own marked root');
    passed('no personal database, and the team saved privately with its own root');
    await hosted.screenshot(path.join(fixture.base, 'hosted-team.png'));
    // Settings fits its window: making an invitation (a long link) never
    // widens it into a sideways scroll.
    await hosted.evaluate(`(document.querySelector('button[aria-label="Settings"]').click(), true)`);
    const settings = `document.querySelector('[data-slot="dialog-content"]')`;
    await hosted.until(`${settings} && [...${settings}.querySelectorAll('button')].some((b) => b.textContent.includes('Invite people'))`, 60_000, 'Settings');
    await hosted.evaluate(`([...${settings}.querySelectorAll('button')].find((b) => b.textContent.includes('Invite people')).click(), true)`);
    await hosted.until(`${settings}.querySelector('code')`, 30_000, 'the invitation link');
    const sideways = await hosted.evaluate<string[]>(`[${settings}, ...${settings}.querySelectorAll('*')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && !['hidden', 'clip'].includes(getComputedStyle(el).overflowX) && !el.classList.contains('sr-only'))
      .map((el) => el.tagName + ' ' + el.scrollWidth + '>' + el.clientWidth)`);
    assert.deepEqual(sideways, [], 'Settings scrolls sideways');
    await hosted.screenshot(path.join(fixture.base, 'hosted-settings.png'));
    passed("the team's Settings fits its window, invitation link and all");
    hosted.close();
    setup.close();

    // 2. Relaunch: the saved team opens directly.
    await quit();
    await launch();
    const reopened = await teamRenderer(localTeam);
    await reopened.until(text('Task Board'), 300_000, "the reopened team's Task Board");
    passed('a relaunch opened the saved team directly');
    reopened.close();

    // 3. Join another team with an invitation.
    if (joinOrigin) {
      const invite = process.env.RI_TEAM_SMOKE_INVITE;
      assert.ok(invite, 'Set RI_TEAM_SMOKE_INVITE to an invitation link from the --join team');
      // The welcome stays loaded behind the team's window: Connect to Ri.
      const connect = await companion();
      await connect.evaluate(click('choose-connect'));
      if (refusesPlainHttp) {
        await refusedPlainHttp(connect, invite);
        connect.close();
        return;
      }
      await connect.evaluate(value('pairing', invite));
      await connect.until(`!document.getElementById('link-destination').hidden`, 30_000, "the invitation's destination");
      const destination = await connect.evaluate<string>(`document.getElementById('link-destination').textContent`);
      assert.match(destination, /^Invitation to join /);
      assert.equal(await connect.evaluate<boolean>(`document.getElementById('run-work-label').hidden`), true, 'A team never offers local execution');
      await connect.evaluate(value('member-name', 'Bo'));
      await connect.screenshot(path.join(fixture.base, 'join-team.png'));
      await connect.evaluate(click('connect-home'));
      const joined = await teamRenderer((url) => url.origin === new URL(joinOrigin).origin);
      await joined.until(text('Task Board'), 120_000, "the joined team's Task Board");
      const joinedName = destination.replace('Invitation to join ', '');
      passed(`joined ${joinedName} from Connect to Ri with an invitation`);
      await joined.screenshot(path.join(fixture.base, 'joined-team.png'));
      joined.close();
      connect.close();

      // 4. The joined team's host is out of reach at the next launch.
      await quit();
      const teamsJson = path.join(stateDir, 'teams.json');
      const file = JSON.parse(fs.readFileSync(teamsJson, 'utf8')) as { teams: Array<{ name: string; origin: string; hosted: unknown }> };
      const closed = await getPort({ host: '127.0.0.1' });
      for (const team of file.teams) if (!team.hosted) team.origin = `http://127.0.0.1:${closed}`;
      fs.writeFileSync(teamsJson, JSON.stringify(file, null, 2), { mode: 0o600 });
      await launch();
      const welcome = await companion();
      await welcome.until(`!document.getElementById('team-issue').hidden`, 120_000, 'why the team did not open');
      const issue = await welcome.evaluate<string>(`document.getElementById('team-issue').textContent`);
      assert.ok(issue.startsWith(`Couldn't reach ${joinedName}. The computer hosting it may be asleep or offline.`), issue);
      await welcome.screenshot(path.join(fixture.base, 'unreachable-team.png'));
      passed(`an unreachable ${joinedName} says why on the welcome at launch`);
      const openFamily = `[...document.querySelectorAll('#team-list button')].find((b) => b.textContent === 'Open Family')`;
      await welcome.until(`${openFamily} && !${openFamily}.disabled`, 60_000, 'Open Family, ready to click');
      await welcome.evaluate(`(${openFamily}.click(), true)`);
      const recovered = await teamRenderer(localTeam);
      await recovered.until(text('Task Board'), 300_000, "the hosted team's Task Board");
      passed('the team hosted here still opens from the welcome');
      recovered.close();
      welcome.close();
    }
  } catch (error) {
    failure = error;
    await diagnose().catch(() => {});
  } finally {
    await quit().catch(() => electronProcess?.kill('SIGKILL'));
    await stopTeamServices().catch((error) => { failure ??= error; });
    await stopService().catch(() => {});
    fs.writeFileSync(path.join(fixture.base, 'team-smoke.json'), JSON.stringify({ checks, passed: !failure, error: failure ? String(failure) : undefined }, null, 2));
    console.info(JSON.stringify({ checks, artifacts: fixture.base, passed: !failure, error: failure ? String(failure) : undefined }, null, 2));
  }
  if (failure) throw failure;
}

run().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
