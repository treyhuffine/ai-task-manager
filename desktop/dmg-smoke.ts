/** The real DMG, on a disposable GitHub-hosted Mac account only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AcceptanceFixture, api, eventually, nativeNavigate } from './acceptance-fixture';
import { localPage } from './acceptance-surfaces';
import { assertDisposableSupervisorAccount } from './platform-qualification';
import { serviceStatus } from '../src/lib/service/client';
import { hasLoginSupervision, uninstallService } from '../src/lib/service/install';

assert.equal(process.platform, 'darwin');
assert(process.env.RUNNER_TEMP);
const temporary = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'ri-dmg-install-'));
assertDisposableSupervisorAccount(process.env, temporary, os.userInfo().homedir);
const repository = path.resolve(__dirname, '..');
const directory = path.join(repository, 'release/desktop');
const dmg = path.join(directory, fs.readdirSync(directory).find(name => name.endsWith('.dmg'))!);
assert(fs.existsSync(dmg));
const mount = path.join(temporary, 'mounted'); fs.mkdirSync(mount);
const installed = path.join(temporary, 'Applications with spaces é', 'Ri.app');
fs.mkdirSync(path.dirname(installed));
const output = path.join(repository, 'release/qualification'); fs.mkdirSync(output, { recursive: true });
const report: { checks: string[]; architecture: string; installer: string; startedAt: string; finishedAt?: string; passed?: boolean; error?: string; cleanupError?: string; limitations: string[] } = {
  checks: [], architecture: process.arch, installer: path.basename(dmg), startedAt: new Date().toISOString(),
  limitations: ['Hosted Mac, not the recipient Mac', 'Stand-in chat protocol, no real provider account', 'Browser download and manual Gatekeeper Open Anyway remain a recipient check'],
};
const pass = (name: string) => { report.checks.push(name); console.info(`[dmg] ${name}`); };
let fixture: AcceptanceFixture | undefined;
let mounted = false;
const copyApp = () => execFileSync('/usr/bin/ditto', [path.join(mount, 'Ri.app'), installed], { timeout: 180_000 });
void (async () => {
  try {
    execFileSync('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg], { timeout: 60_000 });
    mounted = true;
    copyApp();
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed], { timeout: 120_000 });
    assert.equal(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', path.join(installed, 'Contents/Info.plist')], { encoding: 'utf8' }).trim(), '13.5');
    pass('Mount the real DMG, copy Ri.app to an Applications folder with spaces and Unicode, and verify its signature');
    const resources = path.join(installed, 'Contents/Resources');
    const server = path.join(resources, 'server');
    const node = path.join(resources, 'node/bin/node');
    execFileSync(node, [path.join(repository, 'desktop/native-probe.mjs')], { cwd: server, timeout: 35_000 });
    pass('Bundled Node loads the installed native modules without a system Node installation');
    process.env.RI_DESKTOP_PACKAGE = installed;
    fixture = new AcceptanceFixture('dmg-home', { chooseHome: false });
    fixture.env.RI_LOCAL_APPS = '0';
    const bin = path.join(fixture.env.HOME, '.local/bin'); fs.mkdirSync(bin, { recursive: true });
    const entry = path.join(bin, 'fixture.cjs');
    fs.writeFileSync(entry, `
const {createInterface}=require('node:readline');
const {randomUUID}=require('node:crypto');
const write=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const id='mac-fixture-'+randomUUID();
if(process.argv.includes('--version')){console.log('2.1.319 (Claude Code)');process.exit(0);}
if(process.argv.includes('auth')){write({loggedIn:true,authMethod:'claude.ai',email:'mac-fixture@example.test'});process.exit(0);}
const reply=()=>{write({type:'system',subtype:'init',session_id:id,model:'sonnet'});write({type:'assistant',session_id:id,message:{content:[{type:'text',text:'Mac DMG harness reply.'}]}});write({type:'result',subtype:'success',session_id:id,result:'Mac DMG harness reply.',is_error:false,total_cost_usd:0,num_turns:1,usage:{input_tokens:1,output_tokens:1}});};
if(!process.argv.includes('--input-format')){reply();process.exit(0);}
createInterface({input:process.stdin}).on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}
if(m.type==='control_request')write({type:'control_response',response:{request_id:m.request_id,subtype:'success',response:{commands:[],agents:[],models:[]}}});
if(m.type==='user')reply();});
`);
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec ${quote(node)} ${quote(entry)} "$@"\n`, { mode: 0o755 });
    await fixture.launchRaw();
    assert.equal(await fixture.app!.evaluate(() => process.arch), process.arch);
    const setup = await localPage(fixture.app!, 'companion');
    assert(!fs.existsSync(path.join(fixture.root, 'data.db')));
    await setup.locator('#create-home').click();
    const page = fixture.page!;
    // The hosted Mac took eleven minutes to verify one runtime inventory.
    // First install also stages that runtime before the Home can start.
    await page.waitForURL(url => url.protocol === 'https:', { timeout: 20 * 60_000 });
    await page.waitForFunction(() => !!window.riDesktop?.setupHarness);
    fixture.origin = new URL(page.url()).origin;
    pass('First-run Home choice creates a Home, starts its service and opens the native app');
    await nativeNavigate(page, `${fixture.origin}/?settings=models`);
    const row = page.locator('[data-harness-row="codex"]');
    await row.locator('[data-slot="accordion-trigger"]').click();
    await row.getByRole('button', { name: 'Install Codex', exact: true }).click();
    await row.getByRole('button', { name: 'Sign in to Codex', exact: true }).waitFor({ timeout: 180_000 });
    pass('Settings installs the real Codex CLI with bundled npm and offers browser sign-in');
    const note = await api<{ id: string }>(page, '/api/notes', 'POST', { title: 'Mac installer note', body: 'Synthetic fixture body.' });
    const task = await api<{ id: string }>(page, '/api/tasks', 'POST', { title: 'Mac installer task', rawInput: 'Mac installer task', status: 'todo' });
    await api(page, `/api/tasks/${task.id}/complete`, 'POST', {});
    await nativeNavigate(page, `${fixture.origin}/note/${note.id}`);
    const body = 'Written in the installed Mac app and kept after reopening.';
    const editor = page.locator('.rich-editor-body[contenteditable="true"]');
    await editor.waitFor();
    await page.waitForFunction(() => document.activeElement?.classList.contains('rich-editor-body'));
    await page.locator('textarea.note-title').fill('Mac note edited in the app');
    await editor.fill(body);
    await eventually(async () => {
      const saved = await api<{ title: string; body: string }>(page, `/api/notes/${note.id}`);
      return saved.title === 'Mac note edited in the app' && saved.body.includes(body);
    }, 'editor autosave');
    pass('Tasks complete and real note title/body edits autosave');
    const chat = await api<{ session: { id: string } }>(page, '/api/orchestrator-chat', 'POST', { providerId: 'claude', model: 'sonnet' });
    await api(page, `/api/sessions/${chat.session.id}/messages`, 'POST', { content: 'Mac DMG smoke message' });
    await eventually(async () => (await api<{ role: string; content: string }[]>(page, `/api/sessions/${chat.session.id}/events`)).some(event => event.role === 'assistant' && event.content.includes('Mac DMG harness reply.')), 'stand-in chat reply', 90_000);
    pass('The installed app dispatches a chat and persists a streamed stand-in reply');
    const owner = await serviceStatus(); assert(owner);
    await page.screenshot({ path: path.join(output, `macos-${process.arch}-home.png`) });
    await fixture.quit();
    assert.equal((await serviceStatus())?.runId, owner.runId);
    pass('Quitting the Mac viewer leaves its independent Home running');
    fs.rmSync(installed, { recursive: true }); copyApp();
    await fixture.launch();
    const saved = await api<{ title: string; body: string }>(fixture.page!, `/api/notes/${note.id}`);
    assert.equal(saved.title, 'Mac note edited in the app'); assert(saved.body.includes(body));
    assert.equal((await api<{ status: string }>(fixture.page!, `/api/tasks/${task.id}`)).status, 'done');
    pass('Replacing Ri.app and reopening preserves the Home, note and completed task');
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error);
    await fixture?.page?.screenshot({ path: path.join(output, `macos-${process.arch}-failure.png`), timeout: 5_000 }).catch(() => {});
    throw error;
  } finally {
    try {
      if (fixture) { await fixture.quit(); fixture.select(); if (await hasLoginSupervision()) await uninstallService(); await fixture.cleanup(); }
      if (mounted) execFileSync('/usr/bin/hdiutil', ['detach', mount], { timeout: 60_000 });
    } catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
    report.passed = !report.error && !report.cleanupError;
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, `macos-${process.arch}.json`), JSON.stringify(report, null, 2));
    console.info(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
