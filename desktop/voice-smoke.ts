import { writeDesktopHomeIntent } from '../src/lib/service/desktop-role-intent';
/** Packaged Electron + real managed speech. All state belongs to a disposable home.
 * RI_DESKTOP_PACKAGE points at a --with-speech package.
 * RI_SPEECH_MODEL_FIXTURE points at the verified model revision directory.
 * RI_SPEECH_AUDIO_FIXTURE optionally supplies a synthetic WAV fixture.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { desktopPackageLayout } from './package-layout';
import { execFileSync } from 'node:child_process';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { demoEnvironment } from './config';
import { PARAKEET_FILES, PARAKEET_REVISION } from '../src/lib/stt/managed/model';
import { verifyModelFile } from '../src/lib/stt/managed/download';
import type { ManagedSpeechStatus } from '../src/lib/stt/managed/manager';
import { serviceStatus, stopService } from '../src/lib/service/client';
import { isProcessAlive } from '../src/lib/server-runtime/record';

const repo = path.resolve(__dirname, '..');
const source = process.env.RI_DESKTOP_PACKAGE;
const modelFixture = process.env.RI_SPEECH_MODEL_FIXTURE;
assert(source, 'Set RI_DESKTOP_PACKAGE to a package built with --with-speech');
assert(modelFixture, 'Set RI_SPEECH_MODEL_FIXTURE to the verified test model directory');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-packaged-voice-'));
const root = path.join(base, 'home');
const isolatedUser = path.join(base, 'os-home');
fs.mkdirSync(isolatedUser, { recursive: true });
const packaged = path.resolve(source);
const { resources, executable: executablePath } = desktopPackageLayout(packaged);
const bundledNode = path.join(resources, 'node/bin/node');
const cli = path.join(resources, 'server/dist/cli/index.mjs');
const env = demoEnvironment(repo, { NODE_ENV: 'production', HOME: isolatedUser, USER: process.env.USER, TMPDIR: process.env.TMPDIR, PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  RI_DESKTOP_ROOT: root, RI_INSTALL_ROOT: path.join(base, 'runtime'), RI_DESKTOP_SMOKE: '1',
}, 'production');
for (const key of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR', 'RI_SPEECH_HELPER']) delete process.env[key];
Object.assign(process.env, env);
writeDesktopHomeIntent();
let instance: ElectronApplication | undefined;
let helperPids: number[] = [];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function closeGui() {
  if (!instance) return;
  const current = instance; instance = undefined;
  await Promise.all([current.waitForEvent('close', { timeout: 30_000 }), current.evaluate(({ app }) => { app.quit(); })]);
}
function cliRequest(...args: string[]): ManagedSpeechStatus {
  return JSON.parse(execFileSync(bundledNode, [cli, 'voice', 'managed', ...args], { cwd: base, env, encoding: 'utf8', timeout: 45_000 }));
}
async function status(page: Page): Promise<ManagedSpeechStatus> {
  return page.evaluate(async () => {
    const response = await fetch('/api/service/speech');
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });
}
async function waitStatus(page: Page, predicate: (value: ManagedSpeechStatus) => boolean) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) { const value = await status(page); if (predicate(value)) return value; await sleep(100); }
  throw new Error('Speech settings did not reach the expected state');
}
function children(repoPath: string) {
  const command = path.join(repoPath, 'speech-helper/ri-speech-helper');
  return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n')
    .filter(line => line.includes(command)).map(line => Number(line.trim().split(/\s+/)[0]));
}
async function mainSmoke() {
  try {
    const model = path.join(root, '.work/speech', PARAKEET_REVISION);
    fs.mkdirSync(path.dirname(model), { recursive: true, mode: 0o700 });
    // The caller chooses an existing test fixture. Verify before copying and
    // never modify its model or installation preferences.
    for (const spec of PARAKEET_FILES) assert(await verifyModelFile(path.join(modelFixture!, spec.name), spec), `Invalid model fixture: ${spec.name}`);
    fs.cpSync(modelFixture!, model, { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
    fs.writeFileSync(path.join(model, 'verified.json'), JSON.stringify({ revision: PARAKEET_REVISION }));
    fs.mkdirSync(path.join(root, '.config'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(root, '.config/managed-speech.json'), JSON.stringify({ enabled: true, cloudFallback: false }), { mode: 0o600 });
    let audio = process.env.RI_SPEECH_AUDIO_FIXTURE;
    if (!audio) {
      assert.equal(process.platform, 'darwin', 'Set RI_SPEECH_AUDIO_FIXTURE to synthetic WAV audio on this platform');
      audio = path.join(base, 'synthetic.wav');
      execFileSync('/usr/bin/say', ['-o', audio, '--file-format=WAVE', '--data-format=LEI16@16000', 'Today I am testing local speech recognition. Please add a task to review the desktop application tomorrow morning.'], { timeout: 30_000 });
    }
    const audioBytes = fs.readFileSync(audio);
    assert(audioBytes.length > 44 && audioBytes.length < 50 * 1024 * 1024);
    const launchEnvironment = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    instance = await _electron.launch({ executablePath, args: [], cwd: base, env: launchEnvironment, timeout: 240_000 });
    instance.process().stdout?.on('data', chunk => process.stdout.write(chunk));
    instance.process().stderr?.on('data', chunk => process.stderr.write(chunk));
    const page = await instance.firstWindow();
    await page.waitForURL(url => url.protocol === 'https:' && url.pathname === '/welcome', { timeout: 240_000 });
    await page.getByText('Welcome to Ri', { exact: true }).waitFor({ timeout: 60_000 });
    const origin = new URL(page.url()).origin;
    const initial = await serviceStatus();
    assert(initial?.phase === 'running');
    assert.equal(initial.identity.root, fs.realpathSync(root));
    assert(initial.repo.startsWith(fs.realpathSync(path.join(base, 'runtime')) + path.sep), 'Service runtime is not staged in the isolated installation');
    assert.equal(await page.evaluate(() => window.isSecureContext), true);
    const installed = await status(page);
    assert.deepEqual({ installed: installed.installed, helper: installed.helperAvailable, enabled: installed.enabled, fallback: installed.cloudFallback }, { installed: true, helper: true, enabled: true, fallback: false });
    assert.equal(children(initial.repo).length, 0, 'Model loaded before the first transcription');
    await page.evaluate(async () => {
      const response = await fetch('/api/user-state', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ onboardedAt: new Date().toISOString() }) });
      if (!response.ok) throw new Error(await response.text());
    });
    await page.goto(`${origin}/?settings=voice`);
    const section = page.locator('section[aria-label="Managed local speech"]');
    await section.getByText('Optional local speech', { exact: true }).waitFor({ timeout: 30_000 });
    await section.getByText('Ready to start when needed', { exact: true }).waitFor();
    assert.equal(await section.getByRole('button', { name: 'Verify and repair', exact: true }).count(), 1);
    // No dependency on interactive shell tools: all CLI execution uses packaged Node.
    assert.equal(cliRequest('status').helperAvailable, true);
    assert.equal(cliRequest('status').revision, PARAKEET_REVISION);
    const switches = section.getByRole('switch');
    assert.equal(await switches.count(), 2);
    await switches.nth(1).click(); await waitStatus(page, value => value.cloudFallback);
    assert.equal(cliRequest('status').cloudFallback, true);
    assert.equal(cliRequest('local-only').cloudFallback, false);
    await page.waitForFunction(() => document.querySelectorAll('section[aria-label="Managed local speech"] [role="switch"]')[1]?.getAttribute('aria-checked') === 'false');
    await switches.nth(0).click(); await waitStatus(page, value => !value.enabled);
    assert.equal(cliRequest('status').enabled, false);
    assert.equal(cliRequest('enable').enabled, true);
    await page.waitForFunction(() => document.querySelector('section[aria-label="Managed local speech"] [role="switch"]')?.getAttribute('aria-checked') === 'true');
    const started = performance.now();
    const result = await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      const form = new FormData(); form.set('file', new Blob([bytes], { type: 'audio/wav' }), 'synthetic.wav'); form.set('voiceModel', 'local/parakeet-tdt-0.6b-v3');
      const response = await fetch('/api/transcribe', { method: 'POST', body: form, signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }, audioBytes.toString('base64'));
    assert.equal(result.provider, 'local');
    assert.match(result.text.toLowerCase(), /desktop application/);
    const transcriptionMs = Math.round(performance.now() - started);
    await section.getByText('Ready', { exact: true }).waitFor({ timeout: 15_000 });
    helperPids = children(initial.repo);
    assert.equal(helperPids.length, 1, 'Expected exactly one owned packaged helper');
    const preferences = JSON.parse(fs.readFileSync(path.join(root, '.config/managed-speech.json'), 'utf8'));
    assert.deepEqual(preferences, { enabled: true, cloudFallback: false });
    const safeStatus = cliRequest('status');
    assert.equal(safeStatus.phase, 'ready');
    assert(!('token' in safeStatus) && !('port' in safeStatus), 'Private helper capability escaped the status API');
    const invalidModel = await page.evaluate(async encoded => {
      const form = new FormData(); form.set('file', new Blob([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], { type: 'audio/wav' }), 'synthetic.wav'); form.set('voiceModel', 'local/parakeet-tdt-0.6b-v2');
      const response = await fetch('/api/transcribe', { method: 'POST', body: form }); return { status: response.status, text: await response.text() };
    }, audioBytes.toString('base64'));
    assert.notEqual(invalidModel.status, 200); assert.match(invalidModel.text, /includes Parakeet V3 INT8/);
    await page.screenshot({ path: path.join(base, 'voice-settings.png'), fullPage: true });
    await closeGui();
    assert.equal((await serviceStatus())?.runId, initial.runId, 'GUI quit replaced or stopped the shared backend');
    assert(helperPids.every(isProcessAlive), 'GUI quit stopped the backend-owned speech helper');
    assert.equal(cliRequest('status').phase, 'ready', 'Headless CLI lost the GUI-started service');
    await stopService();
    const deadline = Date.now() + 10_000;
    while (helperPids.some(isProcessAlive) && Date.now() < deadline) await sleep(100);
    assert(helperPids.every(pid => !isProcessAlive(pid)), 'Stopping the service leaked a speech helper');
    assert.equal(await serviceStatus(), null);
    console.info(JSON.stringify({ passed: true, root, artifacts: base, origin, runtime: initial.repo, packagedNode: bundledNode,
      provider: result.provider, transcript: result.text, transcriptionMs, guiQuitPreservesService: true, serviceStopReapsSpeechHelper: true, helperPids,
    }, null, 2));
  } finally {
    await closeGui().catch(() => {});
    await stopService().catch(() => {});
  }
}
void mainSmoke().catch(error => { console.error(error); process.exitCode = 1; });
