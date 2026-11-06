/** Install and exercise the actual NSIS output on a disposable hosted runner.
 * No real accounts, public release, login job or personal Home is used. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { AcceptanceFixture, api, eventually, nativeNavigate } from './acceptance-fixture';
import { localPage } from './acceptance-surfaces';
import { serviceStatus } from '../src/lib/service/client';
import { windowsProcesses } from '../src/lib/utils/windows-processes';
import { servicePaths } from '../src/lib/service/paths';
import { redactServiceLine } from '../src/lib/service/logging';
import { PAIRING_TOKEN_FRAGMENT_KEY } from '../src/constants/app';
import { copyNextVectorExtension } from './package-files.mjs';
import type { HarnessAuthResponse } from '../src/lib/server/operations/harness/auth';

assert.equal(process.platform, 'win32');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
const repository = path.resolve(__dirname, '..');
const installer = path.join(repository, 'release/desktop', fs.readdirSync(path.join(repository, 'release/desktop')).find(name => /^Ri-Setup-.*-x64\.exe$/.test(name))!);
assert(fs.existsSync(installer));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-windows-install-'));
const installation = path.join(temporary, 'Program Files', 'Ri preview é');
const unpacked = process.env.RI_WINDOWS_UNPACKED === '1';
const report: { checks: string[]; startupWindows: string[]; output: string[]; harnessVersions: Record<string, string>; diagnostics?: unknown; error?: string; cleanupError?: string; passed?: boolean; startedAt: string; finishedAt?: string; installer: string; limitations: string[] } = {
  checks: [], startupWindows: [], output: [], harnessVersions: {}, startedAt: new Date().toISOString(), installer: path.basename(installer),
  limitations: ['Hosted Windows runner, not the old HP', 'Stand-in Claude protocol, no real provider account', 'Higher installer version uses the same server build to isolate installer upgrade behavior'],
};
if (unpacked) report.limitations.push('Current desktop shell and agentex resolver over an unpacked retained runtime, exact installer and NSIS installation/upgrade/uninstall not qualified');
const pass = (name: string) => { report.checks.push(name); console.info(`[windows] ${name}`); };
const install = async (candidate = installer) => {
  if (unpacked) {
    // The hosted image has full 7-Zip. Builder's reduced 7za cannot read NSIS.
    const sevenZip = path.join(process.env.ProgramFiles!, '7-Zip', '7z.exe');
    assert(fs.existsSync(sevenZip), 'The hosted Windows image must provide full 7-Zip');
    const run = promisify(execFile);
    await run(sevenZip, ['e', '-y', candidate, '-ir!*app-64.7z', `-o${temporary}`], { windowsHide: true, timeout: 60_000 });
    assert(fs.existsSync(path.join(temporary, 'app-64.7z')), 'NSIS payload extraction must produce app-64.7z');
    await run(sevenZip, ['x', '-y', path.join(temporary, 'app-64.7z'), `-o${installation}`], { windowsHide: true, timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 });
    const builder = createRequire(require.resolve('electron-builder'));
    const asar = createRequire(builder.resolve('app-builder-lib/package.json'))('@electron/asar');
    const archive = path.join(installation, 'resources/app.asar');
    const shell = path.join(temporary, 'current-shell');
    asar.extractAll(archive, shell);
    const bundles = fs.readdirSync(shell).filter(name => name.endsWith('.cjs'));
    assert(bundles.length > 0);
    for (const name of bundles) fs.copyFileSync(path.join(repository, 'dist/desktop', name), path.join(shell, name));
    await asar.createPackage(shell, `${archive}.new`);
    fs.renameSync(`${archive}.new`, archive);
    fs.cpSync(path.join(repository, 'dist/desktop'), path.join(installation, 'resources/server/dist/desktop'), { recursive: true });
    const server = path.join(installation, 'resources/server');
    const sdk = path.join(server, '.next-desktop/node_modules/@agentex');
    for (const directory of [path.join(server, 'node_modules/@agentex/agent'), ...fs.readdirSync(sdk).filter(name => name.startsWith('agent-')).map(name => path.join(sdk, name))]) {
      fs.copyFileSync(require.resolve('@agentex/agent/utils/binary'), path.join(directory, 'dist/utils/binary.js'));
    }
    // Exercise the current packaging layout while reusing the web build.
    copyNextVectorExtension(server);
    await run(path.join(installation, 'resources/node/node.exe'), [path.join(repository, 'desktop/native-probe.mjs')], {
      cwd: path.join(installation, 'resources/server'), windowsHide: true, timeout: 35_000,
    });
    return;
  }
  const child = spawn(candidate, ['/S', `/D=${installation}`], { windowsVerbatimArguments: true, stdio: 'ignore' });
  const diagnostics = setInterval(() => {
    const windows = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
Add-Type -AssemblyName UIAutomationClient
$ids = @(Get-Process | Where-Object {$_.ProcessName -like 'Ri-Setup-*'} | ForEach-Object {$_.Id})
$root = [System.Windows.Automation.AutomationElement]::RootElement
@($root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition) | Where-Object {$ids -contains $_.Current.ProcessId} | ForEach-Object {
 @{title=$_.Current.Name; text=@($_.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object {$_.Current.Name} | Where-Object {$_} | Select-Object -First 40)}
}) | ConvertTo-Json -Depth 5 -Compress
`], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
    const files = fs.existsSync(installation) ? fs.readdirSync(installation, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).length : 0;
    console.info('[installer progress]', JSON.stringify({ files, windows: windows.stdout?.trim(), error: windows.error?.message }));
  }, 60_000);
  const timeout = setTimeout(() => child.kill(), 15 * 60_000);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Installer exited with ${code ?? signal}`)));
    });
  } finally { clearInterval(diagnostics); clearTimeout(timeout); }
};
void (async () => {
let fixture: AcceptanceFixture | undefined;
let startupDiagnostics: ReturnType<typeof setInterval> | undefined;
const redact = (value: string) => redactServiceLine(value, []).replace(new RegExp(`#${PAIRING_TOKEN_FRAGMENT_KEY}=[^\\s]+`, 'g'), '#[pairing token redacted]');
try {
  await install();
  assert(fs.existsSync(path.join(installation, 'Ri.exe')));
  pass(unpacked ? 'Extracted the retained runtime and overlaid the current desktop shell for debugging in a path with spaces and Unicode' : 'Per-user NSIS installation into a path with spaces and Unicode');
  process.env.RI_DESKTOP_PACKAGE = installation;
  fixture = new AcceptanceFixture('windows-home', { chooseHome: false });
  fixture.env.RI_LOCAL_APPS = '0';
  // Ordinary Windows GUI launches have USERPROFILE and AppData, without HOME.
  delete fixture.env.HOME;
  const npm = path.join(fixture.env.APPDATA, 'npm');
  fs.mkdirSync(npm, { recursive: true });
  const server = path.join(installation, 'resources/server');
  const portableNode = path.join(installation, 'resources/node/node.exe');
  const sdk = await import(pathToFileURL(createRequire(path.join(server, 'package.json')).resolve('@agentex/agent/utils/binary')).href);
  const verifyHarnessVersion = async (harness: 'claude' | 'codex', auth: HarnessAuthResponse) => {
    const binary = await sdk.findBinary(harness);
    assert.equal(binary.bin, auth.binary.resolvedPath);
    // SDK metadata uses a best-effort five-second probe. Qualify the actual
    // installed command with room for its first Windows/antivirus cold start.
    const { stdout, stderr } = await promisify(execFile)(binary.bin, [...binary.prefixArgs, '--version'], {
      cwd: server, env: { ...fixture!.env, PATH: [path.dirname(portableNode), npm, fixture!.env.PATH].join(path.delimiter) },
      windowsHide: true, timeout: 30_000,
    });
    const version = (stdout || stderr).trim();
    assert.match(version, /\d+\.\d+\.\d+/);
    report.harnessVersions[harness] = version;
  };
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
  startupDiagnostics = setInterval(() => {
    const screenshot = path.join(repository, 'release/qualification/windows-startup.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$image = New-Object System.Drawing.Bitmap($b.Width,$b.Height)
$graphics = [System.Drawing.Graphics]::FromImage($image)
$graphics.CopyFromScreen($b.X,$b.Y,0,0,$image.Size)
$image.Save('${screenshot.replaceAll("'", "''")}')
$graphics.Dispose()
$image.Dispose()
Add-Type -AssemblyName UIAutomationClient
$ids = @(Get-Process -Name Ri -ErrorAction SilentlyContinue | ForEach-Object {$_.Id})
$root = [System.Windows.Automation.AutomationElement]::RootElement
@($root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition) | Where-Object {$ids -contains $_.Current.ProcessId} | ForEach-Object {
 @{title=$_.Current.Name; text=@($_.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object {$_.Current.Name} | Where-Object {$_} | Select-Object -First 40)}
}) | ConvertTo-Json -Depth 5 -Compress
`], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
    report.startupWindows.push(result.stdout?.trim() || result.error?.message || result.stderr?.trim() || 'No Ri windows');
    console.info('[startup windows]', report.startupWindows.at(-1));
  }, 30_000);
  await fixture.launchRaw();
  for (const stream of [fixture.app!.process().stdout, fixture.app!.process().stderr]) stream?.on('data', data => {
    const output = redact(String(data)).slice(-8_000);
    report.output.push(output);
    if (report.output.length > 100) report.output.shift();
    console.info('[desktop]', output);
  });
  assert.equal(await fixture.app!.evaluate(() => process.arch), 'x64');
  const setup = await localPage(fixture.app!, 'companion');
  assert(!fs.existsSync(path.join(fixture.root, 'data.db')), 'First launch must wait for the Home choice');
  pass('Native x64 desktop shows the first-run Home choice before creating a database');
  await setup.locator('#create-home').click();
  const page = fixture.page!;
  await page.waitForURL(url => url.protocol === 'https:', { timeout: 240_000 });
  await page.waitForFunction(() => window.riDesktop?.platform === 'win32');
  clearInterval(startupDiagnostics);
  fixture.origin = new URL(page.url()).origin;
  pass('First-run Home choice, real migrations, HTTPS sign-in and native bridge');
  const acl = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$acl = Get-Acl -LiteralPath '${fixture.root.replaceAll("'", "''")}'
@{protected=$acl.AreAccessRulesProtected; allowed=@($acl.Access | Where-Object {$_.AccessControlType -eq 'Allow'} | ForEach-Object {$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}); user=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value} | ConvertTo-Json -Compress
`], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }));
  assert.equal(acl.protected, true);
  assert.deepEqual(new Set(acl.allowed), new Set([acl.user, 'S-1-5-18']));
  pass('Home NTFS permissions allow only the current Windows account and SYSTEM');
  const auth = await api<HarnessAuthResponse>(page, '/api/harness/auth', 'POST', { harness: 'claude', fresh: true });
  assert.equal(auth.binary.installed, true); assert.equal(auth.hasSubscription, true);
  pass('Windows npm cmd shim discovery and harness authentication inspection');
  if (unpacked) await page.evaluate(() => window.riDesktop!.setupHarness!({ harness: 'codex', action: 'install' }));
  else {
    await nativeNavigate(page, `${fixture.origin}/?settings=models`);
    const row = page.locator('[data-harness-row="codex"]');
    await row.locator('[data-slot="accordion-trigger"]').click();
    await row.getByRole('button', { name: 'Install Codex', exact: true }).click();
    await row.getByRole('button', { name: 'Sign in to Codex', exact: true }).waitFor({ timeout: 180_000 });
    pass('Settings installs Codex without terminal commands and offers browser sign-in');
  }
  const codex = await api<HarnessAuthResponse>(page, '/api/harness/auth', 'POST', { harness: 'codex', fresh: true });
  assert.equal(codex.binary.installed, true); assert.equal(codex.hasSubscription, false);
  await verifyHarnessVersion('codex', codex);
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
  await nativeNavigate(page, `${fixture.origin}/?settings=voice`);
  await page.getByText('This build does not include the local speech helper. You can configure an external Parakeet service in Runtime setup.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Install local speech', exact: true }).count(), 0);
  pass('Voice settings explain the missing speech helper and omit its install action');
  await nativeNavigate(page, `${fixture.origin}/?settings=updates`);
  await page.getByText('Automatic updates and running after you close the app are not available in this preview.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Check for updates', exact: true }).count(), 0);
  pass('Windows settings explain the app-open lifetime and omit self-update controls');
  await nativeNavigate(page, `${fixture.origin}/`);
  await page.getByRole('button', { name: 'More', exact: true }).first().click();
  await page.getByRole('button', { name: 'Terminal', exact: true }).first().click();
  const terminal = page.locator('.xterm-helper-textarea').first();
  await terminal.waitFor({ state: 'attached' });
  await page.getByRole('status').filter({ hasText: 'Connecting to the terminal WebSocket.' }).waitFor({ state: 'hidden' });
  await terminal.focus();
  const proof = path.join(fixture.root, 'terminal-proof.json');
  const sessionCli = path.join(fixture.root, '.work/bin/ri.cmd');
  if (unpacked) {
    // The retained web build writes the prior launcher. Apply the current
    // UTF-8 header here until qualification runs a freshly built installer.
    const content = fs.readFileSync(sessionCli, 'utf8');
    if (!content.includes('chcp 65001')) fs.writeFileSync(sessionCli, content.replace('@echo off\r\n', '@echo off\r\nchcp 65001 >nul\r\n'));
  }
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const ready = path.join(fixture.root, 'powershell-ready.txt');
  await page.keyboard.type(`'ready' | Set-Content -LiteralPath ${quote(ready)}`);
  await page.keyboard.press('Enter');
  await eventually(async () => fs.existsSync(ready), 'PowerShell accepts browser keyboard input', 15_000);
  await page.keyboard.type(`& ${quote(sessionCli)} agent describe_paths | Set-Content -LiteralPath ${quote(proof)}`);
  await page.keyboard.press('Enter');
  await eventually(async () => fs.existsSync(proof) && fs.statSync(proof).size > 0, 'PowerShell runs the pinned session CLI', 30_000);
  const paths = JSON.parse(fs.readFileSync(proof, 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(fs.realpathSync.native(paths.appRoot), fs.realpathSync.native(fixture.root));
  pass('Browser WebSocket terminal runs native PowerShell and the pinned ri.cmd against this Home');
  fs.rmSync(path.join(npm, 'claude.cmd'));
  await page.evaluate(() => window.riDesktop!.setupHarness!({ harness: 'claude', action: 'install' }));
  pass('Install the real Claude Code CLI using bundled Node/npm');
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
  // Restart clears the resolver's stand-in path from this test's earlier chat.
  const installedClaude = await api<HarnessAuthResponse>(fixture.page!, '/api/harness/auth', 'POST', { harness: 'claude', fresh: true });
  assert.equal(installedClaude.binary.installed, true); assert.equal(installedClaude.hasSubscription, false);
  await verifyHarnessVersion('claude', installedClaude);
  pass('The real Claude Code CLI starts after reopening and reports a signed-out Windows state');
  if (!unpacked) {
    await nativeNavigate(fixture.page!, `${fixture.origin}/?settings=models`);
    const row = fixture.page!.locator('[data-harness-row="claude"]');
    await row.locator('[data-slot="accordion-trigger"]').click();
    await row.getByRole('button', { name: 'Sign in to Claude Code', exact: true }).waitFor();
    pass('Settings offers Claude Code browser sign-in again after onboarding');
  }
  await fixture.quit();
  if (unpacked) return;
  await eventually(async () => await serviceStatus() === null, 'shutdown before version upgrade', 75_000);
  const upgradeDirectory = path.join(repository, 'release/windows-upgrade-test');
  const upgrade = path.join(upgradeDirectory, fs.readdirSync(upgradeDirectory).find(name => /^Ri-Setup-.*-x64\.exe$/.test(name))!);
  await install(upgrade);
  await fixture.launch();
  assert.equal(await fixture.app!.evaluate(({ app }) => app.getVersion()), /^Ri-Setup-(.+)-x64\.exe$/.exec(path.basename(upgrade))![1], 'The higher-version application must actually replace the earlier one');
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
  if (fixture?.page && !fixture.page.isClosed()) {
    fs.mkdirSync(path.join(repository, 'release/qualification'), { recursive: true });
    await fixture.page.screenshot({ path: path.join(repository, 'release/qualification/windows-failure.png'), timeout: 5_000 }).catch(() => {});
  }
  if (fixture) {
    const log = servicePaths().log;
    report.diagnostics = { service: await serviceStatus().catch(() => null),
      log: fs.existsSync(log) ? redact(fs.readFileSync(log, 'utf8')).slice(-24_000) : 'No service log' };
  }
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  clearInterval(startupDiagnostics);
  try { await fixture?.cleanup(); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  report.passed = !report.error && !report.cleanupError;
  report.finishedAt = new Date().toISOString();
  const directory = path.join(repository, 'release/qualification');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'windows.json'), JSON.stringify(report, null, 2));
  console.info(JSON.stringify(report, null, 2));
}
})().catch(error => { console.error(error); process.exitCode = 1; });
