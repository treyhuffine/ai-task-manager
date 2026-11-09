/** Real installers, on an opted-in disposable GitHub-hosted account only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AcceptanceFixture, api, eventually, nativeNavigate } from './acceptance-fixture';
import { localPage } from './acceptance-surfaces';
import { assertDisposableSupervisorAccount } from './platform-qualification';
import { desktopPackageLayout } from './package-layout';
import { serviceStatus } from '../src/lib/service/client';
import { hasLoginSupervision, uninstallService } from '../src/lib/service/install';
import { digestFile } from '../src/lib/service/runtime-manifest';

const mac = process.platform === 'darwin';
assert(mac || process.platform === 'linux');
const platform = mac ? 'macos' : 'linux';
assert(process.env.RUNNER_TEMP);
const temporary = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'ri-installer-'));
const accountHome = os.userInfo().homedir;
assertDisposableSupervisorAccount(process.env, temporary, accountHome);
const repository = path.resolve(__dirname, '..');
const directory = path.join(repository, 'release/desktop');
const installer = path.join(directory, fs.readdirSync(directory).find(name => name.endsWith(mac ? '.dmg' : '.deb'))!);
assert(fs.existsSync(installer));
const mount = path.join(temporary, 'mounted'); fs.mkdirSync(mount);
let installed = path.join(temporary, 'Applications with spaces é', 'Ri.app');
if (mac) fs.mkdirSync(path.dirname(installed));
const output = path.join(repository, 'release/qualification'); fs.mkdirSync(output, { recursive: true });
const report: { checks: string[]; architecture: string; installer: string; sha256: string; appImageSha256?: string; payloadFiles?: number; startedAt: string; finishedAt?: string; passed?: boolean; error?: string; cleanupError?: string; limitations: string[] } = {
  checks: [], architecture: process.arch, installer: path.basename(installer), sha256: digestFile(installer), startedAt: new Date().toISOString(),
  limitations: ['Hosted runner, not the recipient computer', 'Stand-in chat protocol, no real provider account', mac ? 'Browser download and manual Gatekeeper Open Anyway remain a recipient check' : 'AppImage extract-and-run is tested; FUSE mounting and other distributions remain recipient checks'],
};
const pass = (name: string) => { report.checks.push(name); console.info(`[installer] ${name}`); };
let fixture: AcceptanceFixture | undefined;
let mounted = false;
let linuxInstalled = false;
let packageName = '';
const copyApp = () => execFileSync('/usr/bin/ditto', [path.join(mount, 'Ri.app'), installed], { timeout: 180_000 });
const installDeb = (reinstall = false) => {
  execFileSync('sudo', ['apt-get', 'install', '-y', ...(reinstall ? ['--reinstall'] : []), installer], { stdio: 'inherit', timeout: 600_000 });
  linuxInstalled = true;
};
const removeDeb = () => {
  execFileSync('sudo', ['apt-get', 'remove', '-y', packageName], { stdio: 'inherit', timeout: 600_000 });
  linuxInstalled = false;
};
const launchOptions = mac ? {} : { chromiumSandbox: true };
void (async () => {
  try {
    if (mac) {
      execFileSync('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, installer], { timeout: 60_000 });
      mounted = true;
      copyApp();
      execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed], { timeout: 120_000 });
      assert.equal(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', path.join(installed, 'Contents/Info.plist')], { encoding: 'utf8' }).trim(), '13.5');
      pass('Mount the real DMG, copy Ri.app to an Applications folder with spaces and Unicode, and verify its signature');
    } else {
      packageName = execFileSync('dpkg-deb', ['--field', installer, 'Package'], { encoding: 'utf8' }).trim();
      installDeb();
      const files = execFileSync('dpkg', ['--listfiles', packageName], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\n');
      const executable = files.filter(file => file.endsWith('/ri')).map(file => fs.realpathSync(file)).find(file => fs.existsSync(path.join(path.dirname(file), 'resources/app.asar')));
      assert(executable, 'The installed Debian package must contain the Ri executable');
      installed = path.dirname(executable);
      pass('Install the real Debian package and resolve its installed desktop executable');
    }
    const { resources } = desktopPackageLayout(installed);
    const server = path.join(resources, 'server');
    const node = path.join(resources, 'node/bin/node');
    execFileSync(node, [path.join(repository, 'desktop/native-probe.mjs')], { cwd: server, timeout: 35_000 });
    pass('Bundled Node loads the installed native modules without a system Node installation');
    const manifest = JSON.parse(fs.readFileSync(path.join(resources, 'runtime-manifest.json'), 'utf8')) as { files: { name: string }[] };
    const privateFiles = manifest.files.filter(file => /(^|\/)(?:\.git|\.env(?:\.local|\.production)?|data\.db(?:-wal|-shm)?)(?:\/|$)/.test(file.name) || /^server\/(?:personal|config|work|attachments)(?:\/|$)/.test(file.name));
    assert.deepEqual(privateFiles, []);
    assert(!fs.existsSync(path.join(resources, 'release-policy.json')));
    report.payloadFiles = manifest.files.length;
    pass('Runtime inventory contains no private Home, environment or Git files and no configured update feed');
    process.env.RI_DESKTOP_PACKAGE = installed;
    fixture = new AcceptanceFixture('installer-home', { chooseHome: false });
    fixture.env.RI_LOCAL_APPS = '0';
    // systemd discovers units in the real disposable account's .config folder.
    // The Home, runtime store and desktop profile remain under the fixture.
    if (!mac) fixture.env.HOME = accountHome;
    const bin = path.join(fixture.env.HOME, '.local/bin'); fs.mkdirSync(bin, { recursive: true });
    const entry = path.join(bin, 'fixture.cjs');
    fs.writeFileSync(entry, `
const {createInterface}=require('node:readline');
const {randomUUID}=require('node:crypto');
const write=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const id='installer-fixture-'+randomUUID();
if(process.argv.includes('--version')){console.log('2.1.319 (Claude Code)');process.exit(0);}
if(process.argv.includes('auth')){write({loggedIn:true,authMethod:'claude.ai',email:'installer-fixture@example.test'});process.exit(0);}
const reply=()=>{write({type:'system',subtype:'init',session_id:id,model:'sonnet'});write({type:'assistant',session_id:id,message:{content:[{type:'text',text:'Installer harness reply.'}]}});write({type:'result',subtype:'success',session_id:id,result:'Installer harness reply.',is_error:false,total_cost_usd:0,num_turns:1,usage:{input_tokens:1,output_tokens:1}});};
if(!process.argv.includes('--input-format')){reply();process.exit(0);}
createInterface({input:process.stdin}).on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}
if(m.type==='control_request')write({type:'control_response',response:{request_id:m.request_id,subtype:'success',response:{commands:[],agents:[],models:[]}}});
if(m.type==='user')reply();});
`);
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec ${quote(node)} ${quote(entry)} "$@"\n`, { mode: 0o755 });
    await fixture.launchRaw([], launchOptions);
    assert.equal(await fixture.app!.evaluate(() => process.arch), process.arch);
    if (!mac) assert.equal(await fixture.app!.evaluate(({ app }) => app.commandLine.hasSwitch('no-sandbox')), false);
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
    const note = await api<{ id: string }>(page, '/api/notes', 'POST', { title: 'Installer note', body: 'Synthetic fixture body.' });
    const task = await api<{ id: string }>(page, '/api/tasks', 'POST', { title: 'Installer task', rawInput: 'Installer task', status: 'todo' });
    await api(page, `/api/tasks/${task.id}/complete`, 'POST', {});
    await nativeNavigate(page, `${fixture.origin}/note/${note.id}`);
    const body = 'Written in the installed app and kept after reopening.';
    const editor = page.locator('.rich-editor-body[contenteditable="true"]');
    await editor.waitFor();
    await page.waitForFunction(() => document.activeElement?.classList.contains('rich-editor-body'));
    await page.locator('textarea.note-title').fill('Note edited in the app');
    await editor.fill(body);
    await eventually(async () => {
      const saved = await api<{ title: string; body: string }>(page, `/api/notes/${note.id}`);
      return saved.title === 'Note edited in the app' && saved.body.includes(body);
    }, 'editor autosave');
    pass('Tasks complete and real note title/body edits autosave');
    const chat = await api<{ session: { id: string } }>(page, '/api/orchestrator-chat', 'POST', { providerId: 'claude', model: 'sonnet' });
    await api(page, `/api/sessions/${chat.session.id}/messages`, 'POST', { content: 'Installer smoke message' });
    await eventually(async () => (await api<{ role: string; content: string }[]>(page, `/api/sessions/${chat.session.id}/events`)).some(event => event.role === 'assistant' && event.content.includes('Installer harness reply.')), 'stand-in chat reply', 90_000);
    pass('The installed app dispatches a chat and persists a streamed stand-in reply');
    const owner = await serviceStatus(); assert(owner);
    await page.screenshot({ path: path.join(output, `${platform}-${process.arch}-home.png`) });
    await fixture.quit();
    assert.equal((await serviceStatus())?.runId, owner.runId);
    pass('Quitting the viewer leaves its independent Home running');
    if (mac) { fs.rmSync(installed, { recursive: true }); copyApp(); }
    else installDeb(true);
    await fixture.launch([], launchOptions);
    const saved = await api<{ title: string; body: string }>(fixture.page!, `/api/notes/${note.id}`);
    assert.equal(saved.title, 'Note edited in the app'); assert(saved.body.includes(body));
    assert.equal((await api<{ status: string }>(fixture.page!, `/api/tasks/${task.id}`)).status, 'done');
    pass('Reinstalling and reopening preserves the Home, note and completed task');
    if (!mac) {
      await fixture.quit();
      const appImageDirectory = path.join(temporary, 'Portable apps with spaces é'); fs.mkdirSync(appImageDirectory);
      const appImage = path.join(appImageDirectory, 'Ri.AppImage');
      fs.copyFileSync(path.join(directory, fs.readdirSync(directory).find(name => name.endsWith('.AppImage'))!), appImage);
      fs.chmodSync(appImage, 0o755);
      report.appImageSha256 = digestFile(appImage);
      fixture.env.APPIMAGE_EXTRACT_AND_RUN = '1';
      await fixture.launch([], { executable: appImage, chromiumSandbox: true });
      assert.equal(await fixture.app!.evaluate(({ app }) => app.commandLine.hasSwitch('no-sandbox')), false);
      assert.equal((await api<{ title: string }>(fixture.page!, `/api/notes/${note.id}`)).title, saved.title);
      pass('The real AppImage starts in extract-and-run mode with Chromium sandboxing and opens the same saved Home');
      await fixture.quit();
      removeDeb();
      assert(fs.existsSync(path.join(fixture.root, 'data.db')));
      pass('Uninstalling the Debian package keeps the authored Home database');
    }
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error);
    await fixture?.page?.screenshot({ path: path.join(output, `${platform}-${process.arch}-failure.png`), timeout: 5_000 }).catch(() => {});
    throw error;
  } finally {
    try {
      if (fixture) { await fixture.quit(); fixture.select(); if (await hasLoginSupervision()) await uninstallService(); await fixture.cleanup(); }
      if (mounted) execFileSync('/usr/bin/hdiutil', ['detach', mount], { timeout: 60_000 });
      if (linuxInstalled) removeDeb();
    } catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
    report.passed = !report.error && !report.cleanupError;
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, `${platform}-${process.arch}.json`), JSON.stringify(report, null, 2));
    console.info(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
