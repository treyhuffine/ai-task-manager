/** Install and exercise the actual NSIS output on a disposable hosted runner.
 * No real accounts, public release, login job or personal Home is used. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { AcceptanceFixture, api, eventually, nativeNavigate } from './acceptance-fixture';
import { localPage } from './acceptance-surfaces';
import { serviceStatus } from '../src/lib/service/client';
import { windowsProcesses } from '../src/lib/utils/windows-processes';

assert.equal(process.platform, 'win32');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
const repository = path.resolve(__dirname, '..');
const installer = path.join(repository, 'release/desktop', fs.readdirSync(path.join(repository, 'release/desktop')).find(name => /^Ri-Setup-.*-x64\.exe$/.test(name))!);
assert(fs.existsSync(installer));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-windows-install-'));
const installation = path.join(temporary, 'Program Files', 'Ri preview é');
const report: { checks: string[]; error?: string; limitations: string[] } = { checks: [], limitations: ['Hosted Windows runner, not the old HP', 'Stand-in Claude protocol, no real provider account', 'Higher installer version uses the same server build to isolate installer upgrade behavior'] };
const pass = (name: string) => { report.checks.push(name); console.info(`[windows] ${name}`); };
const install = (candidate = installer) => {
  const result = spawnSync(candidate, ['/S', `/D=${installation}`], { windowsVerbatimArguments: true, timeout: 180_000, stdio: 'pipe' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr?.toString());
};
let fixture: AcceptanceFixture | undefined;
try {
  install();
  assert(fs.existsSync(path.join(installation, 'Ri.exe')));
  pass('Per-user NSIS installation into a path with spaces and Unicode');
  process.env.RI_DESKTOP_PACKAGE = installation;
  fixture = new AcceptanceFixture('windows-home', { chooseHome: false });
  fixture.env.RI_LOCAL_APPS = '0';
  const npm = path.join(fixture.env.APPDATA, 'npm');
  fs.mkdirSync(npm, { recursive: true });
  // Exercise real Windows .cmd discovery and the real agentex stream parser.
  // The stand-in itself is ordinary JS and never ships inside the installer.
  fs.writeFileSync(path.join(npm, 'claude.cmd'), '@echo off\r\nnode "%~dp0fixture.js" %*\r\n');
  fs.writeFileSync(path.join(npm, 'fixture.js'), `
const {createInterface}=require('node:readline');
const {randomUUID}=require('node:crypto');
const write=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const id='windows-fixture-'+randomUUID();
if(process.argv.includes('--version')){console.log('2.1.295 (Claude Code)');process.exit(0);}
if(process.argv.includes('auth')){write({loggedIn:true,authMethod:'claude.ai',email:'windows-fixture@example.test'});process.exit(0);}
const init=()=>write({type:'system',subtype:'init',session_id:id,model:'sonnet'});
const reply=()=>{init();write({type:'assistant',session_id:id,message:{content:[{type:'text',text:'Windows harness reply.'}]}});write({type:'result',subtype:'success',session_id:id,result:'Windows harness reply.',is_error:false,total_cost_usd:0,num_turns:1,usage:{input_tokens:1,output_tokens:1}});};
if(!process.argv.includes('--input-format')){reply();process.exit(0);}
createInterface({input:process.stdin}).on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}
 if(m.type==='control_request')write({type:'control_response',response:{request_id:m.request_id,subtype:'success',response:{commands:[],agents:[],models:[]}}});
 if(m.type==='user')reply();});
`);
  fixture.select();
  await fixture.launchRaw();
  const setup = await localPage(fixture.app!, 'companion');
  assert(!fs.existsSync(path.join(fixture.root, 'data.db')), 'First launch must wait for the Home choice');
  await setup.locator('#create-home').click();
  const page = fixture.page!;
  await page.waitForURL(url => url.protocol === 'https:', { timeout: 240_000 });
  await page.waitForFunction(() => window.riDesktop?.platform === 'win32');
  fixture.origin = new URL(page.url()).origin;
  pass('First-run Home choice, real migrations, HTTPS sign-in and native bridge');
  const auth = await api<{ binary: { installed: boolean }; hasSubscription: boolean }>(page, '/api/harness/auth', 'POST', { harness: 'claude', fresh: true });
  assert.equal(auth.binary.installed, true); assert.equal(auth.hasSubscription, true);
  pass('Windows npm cmd shim discovery and harness authentication inspection');
  await page.evaluate(() => window.riDesktop!.setupHarness!({ harness: 'codex', action: 'install' }));
  const codex = await api<{ binary: { installed: boolean }; hasSubscription: boolean }>(page, '/api/harness/auth', 'POST', { harness: 'codex', fresh: true });
  assert.equal(codex.binary.installed, true); assert.equal(codex.hasSubscription, false);
  pass('Install the real Codex CLI using bundled Node/npm, then discover its native Windows binary without a sign-in');
  const note = await api<{ id: string }>(page, '/api/notes', 'POST', { title: 'Windows persistence note', body: 'Synthetic Windows fixture body.' });
  const task = await api<{ id: string }>(page, '/api/tasks', 'POST', { title: 'Windows persistence task', rawInput: 'Windows persistence task', status: 'todo' });
  await api(page, `/api/tasks/${task.id}/complete`, 'POST', {});
  assert.equal((await api<{ status: string }>(page, `/api/tasks/${task.id}`)).status, 'done');
  pass('Task create and complete, note create and read through the installed server');
  await nativeNavigate(page, `${fixture.origin}/note/${note.id}`);
  const noteTitle = page.locator('textarea.note-title');
  await noteTitle.waitFor();
  await noteTitle.fill('Windows note edited in the app');
  await eventually(async () => (await api<{ title: string }>(page, `/api/notes/${note.id}`)).title === 'Windows note edited in the app', 'editor autosave');
  pass('The installed note editor opens and autosaves a real user edit');
  const chat = await api<{ session: { id: string } }>(page, '/api/orchestrator-chat', 'POST', { providerId: 'claude', model: 'sonnet' });
  await api(page, `/api/sessions/${chat.session.id}/messages`, 'POST', { content: 'Windows smoke message' });
  await eventually(async () => {
    const result = await api<{ role: string; content: string }[]>(page, `/api/sessions/${chat.session.id}/events`);
    return result.some(event => event.role === 'assistant' && event.content.includes('Windows harness reply.'));
  }, 'stand-in chat reply', 90_000);
  pass('Real chat dispatch, Windows process identity, streaming parser and persisted reply with a stand-in CLI');
  await nativeNavigate(page, `${fixture.origin}/`);
  await page.getByRole('button', { name: 'More', exact: true }).first().click();
  await page.getByRole('button', { name: 'Terminal', exact: true }).first().click();
  const terminal = page.locator('.xterm-helper-textarea').first();
  await terminal.waitFor({ state: 'attached' });
  await terminal.focus();
  const proof = path.join(fixture.root, 'terminal-proof.json');
  const sessionCli = path.join(fixture.root, '.work/bin/ri.cmd');
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  await page.keyboard.type(`& ${quote(sessionCli)} agent describe_paths | Set-Content -LiteralPath ${quote(proof)}`);
  await page.keyboard.press('Enter');
  await eventually(async () => fs.existsSync(proof) && fs.statSync(proof).size > 0, 'PowerShell runs the pinned session CLI', 30_000);
  const paths = JSON.parse(fs.readFileSync(proof, 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(paths.ok, true); assert.equal(paths.result.appRoot, fixture.root);
  pass('Browser WebSocket terminal runs native PowerShell and the pinned ri.cmd against this Home');
  fs.mkdirSync(path.join(repository, 'release/qualification'), { recursive: true });
  await page.screenshot({ path: path.join(repository, 'release/qualification/windows-home.png') });
  const controller = (await serviceStatus())!;
  const beforeQuit = await windowsProcesses();
  const ownedPids = new Set([controller.pid]);
  let previousSize = 0;
  while (previousSize !== ownedPids.size) {
    previousSize = ownedPids.size;
    for (const child of beforeQuit) if (ownedPids.has(child.ppid)) ownedPids.add(child.pid);
  }
  const ownedBirthIds = new Set(beforeQuit.filter(child => ownedPids.has(child.pid)).map(child => child.birthId));
  await fixture.quit();
  await eventually(async () => await serviceStatus() === null, 'app close stops the controller', 75_000);
  await eventually(async () => !(await windowsProcesses()).some(child => ownedBirthIds.has(child.birthId)), 'owned server, harness and terminal processes exit', 30_000);
  pass('Quit stops the app-owned controller, server, harnesses and terminal processes');
  await fixture.launch();
  assert.equal((await api<{ body: string }>(fixture.page!, `/api/notes/${note.id}`)).body, 'Synthetic Windows fixture body.');
  assert.equal((await api<{ status: string }>(fixture.page!, `/api/tasks/${task.id}`)).status, 'done');
  pass('Reopen retains the same Home, note and completed task');
  await fixture.quit();
  await eventually(async () => await serviceStatus() === null, 'shutdown before reinstall', 75_000);
  install();
  await fixture.launch();
  assert.equal((await api<{ title: string }>(fixture.page!, `/api/notes/${note.id}`)).title, 'Windows note edited in the app');
  pass('Installing over the existing app preserves authored data');
  await fixture.quit();
  await eventually(async () => await serviceStatus() === null, 'shutdown before version upgrade', 75_000);
  const upgradeDirectory = path.join(repository, 'release/windows-upgrade-test');
  const upgrade = path.join(upgradeDirectory, fs.readdirSync(upgradeDirectory).find(name => /^Ri-Setup-.*-x64\.exe$/.test(name))!);
  install(upgrade);
  await fixture.launch();
  assert.equal((await api<{ title: string }>(fixture.page!, `/api/notes/${note.id}`)).title, 'Windows note edited in the app');
  assert.equal((await api<{ status: string }>(fixture.page!, `/api/tasks/${task.id}`)).status, 'done');
  pass('A higher-version installer upgrades the application and keeps tasks and notes');
  await fixture.quit();
  await eventually(async () => await serviceStatus() === null, 'shutdown before uninstall', 75_000);
  const uninstaller = path.join(installation, fs.readdirSync(installation).find(name => /^Uninstall.*\.exe$/.test(name))!);
  execFileSync(uninstaller, ['/S'], { timeout: 120_000, stdio: 'pipe' });
  await eventually(async () => !fs.existsSync(path.join(installation, 'Ri.exe')), 'uninstaller removes software', 120_000);
  assert(fs.existsSync(path.join(fixture.root, 'data.db')));
  pass('Uninstall removes software and keeps the Home database');
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await fixture?.cleanup();
  const directory = path.join(repository, 'release/qualification');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'windows.json'), JSON.stringify(report, null, 2));
}
