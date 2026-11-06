/** Install and exercise the actual NSIS output on a disposable hosted runner.
 * No real accounts, public release, login job or personal Home is used. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { AcceptanceFixture, api, eventually } from './acceptance-fixture';
import { localPage } from './acceptance-surfaces';
import { serviceStatus } from '../src/lib/service/client';

assert.equal(process.platform, 'win32');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
const repository = path.resolve(__dirname, '..');
const installer = path.join(repository, 'release/desktop', fs.readdirSync(path.join(repository, 'release/desktop')).find(name => /^Ri-Setup-.*-x64\.exe$/.test(name))!);
assert(fs.existsSync(installer));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-windows-install-'));
const installation = path.join(temporary, 'Program Files', 'Ri preview é');
const report: { checks: string[]; error?: string; limitations: string[] } = { checks: [], limitations: ['Hosted Windows runner, not the old HP', 'Stand-in Claude protocol, no real provider account', 'Reinstall uses the same candidate installer'] };
const pass = (name: string) => { report.checks.push(name); console.info(`[windows] ${name}`); };
const install = () => execFileSync(installer, ['/S', `/D=${installation}`], { windowsVerbatimArguments: true, timeout: 180_000, stdio: 'pipe' });
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
const init=()=>write({type:'system',subtype:'init',session_id:id,model:'claude-sonnet-4-6'});
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
  const note = await api<{ id: string }>(page, '/api/notes', 'POST', { title: 'Windows persistence note', body: 'Synthetic Windows fixture body.' });
  const task = await api<{ id: string }>(page, '/api/tasks', 'POST', { title: 'Windows persistence task' });
  await api(page, `/api/tasks/${task.id}`, 'PATCH', { status: 'done' });
  assert.equal((await api<{ status: string }>(page, `/api/tasks/${task.id}`)).status, 'done');
  pass('Task create and complete, note create and read through the installed server');
  const chat = await api<{ session: { id: string } }>(page, '/api/orchestrator-chat', 'POST', { providerId: 'claude', model: 'claude-sonnet-4-6' });
  await api(page, `/api/sessions/${chat.session.id}/messages`, 'POST', { content: 'Windows smoke message' });
  await eventually(async () => {
    const result = await api<{ role: string; content: string }[]>(page, `/api/sessions/${chat.session.id}/events`);
    return result.some(event => event.role === 'assistant' && event.content.includes('Windows harness reply.'));
  }, 'stand-in chat reply', 90_000);
  pass('Real chat dispatch, Windows process identity, streaming parser and persisted reply with a stand-in CLI');
  fs.mkdirSync(path.join(repository, 'release/qualification'), { recursive: true });
  await page.screenshot({ path: path.join(repository, 'release/qualification/windows-home.png') });
  await fixture.quit();
  await eventually(async () => await serviceStatus() === null, 'app close stops the controller', 75_000);
  pass('Quit stops the app-owned controller and server');
  await fixture.launch();
  assert.equal((await api<{ body: string }>(fixture.page!, `/api/notes/${note.id}`)).body, 'Synthetic Windows fixture body.');
  assert.equal((await api<{ status: string }>(fixture.page!, `/api/tasks/${task.id}`)).status, 'done');
  pass('Reopen retains the same Home, note and completed task');
  await fixture.quit();
  await eventually(async () => await serviceStatus() === null, 'shutdown before reinstall', 75_000);
  install();
  await fixture.launch();
  assert.equal((await api<{ title: string }>(fixture.page!, `/api/notes/${note.id}`)).title, 'Windows persistence note');
  pass('Installing over the existing app preserves authored data');
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
