import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { getConfigDir, getWorkDir } from '@/lib/config/paths';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { beginActivity } from '@/lib/service/maintenance';
import { downloadModelFile, verifyModelFile } from './download';
import { PARAKEET_BYTES, PARAKEET_FILES, PARAKEET_REVISION, modelUrl } from './model';

export type SpeechPhase = 'not-installed' | 'downloading' | 'verifying' | 'installed' | 'starting' | 'ready' | 'transcribing' | 'error';
export interface ManagedSpeechStatus {
  phase: SpeechPhase; supported: boolean; installed: boolean; enabled: boolean;
  downloadedBytes: number; totalBytes: number; error?: string; cloudFallback: boolean;
  model: string; revision: string; helperAvailable: boolean;
}
export interface SpeechPreferences { enabled: boolean; cloudFallback: boolean }
export function speechPaths() {
  const root = path.join(getWorkDir(), 'speech');
  return { root, model: path.join(root, PARAKEET_REVISION), staging: path.join(root, `${PARAKEET_REVISION}.staging`), settings: path.join(getConfigDir(), 'managed-speech.json') };
}
function helperPath() {
  return process.env.RI_SPEECH_HELPER || path.join(process.env.RI_RUNTIME_REPO || process.cwd(), 'speech-helper', 'ri-speech-helper');
}
export function speechPreferences(): SpeechPreferences {
  try {
    const value = JSON.parse(fs.readFileSync(speechPaths().settings, 'utf8'));
    return { enabled: value.enabled === true, cloudFallback: value.cloudFallback === true };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { enabled: false, cloudFallback: false }; throw error; }
}

export class ManagedSpeech {
  private phase: SpeechPhase = 'not-installed';
  private error?: string;
  private downloaded = 0;
  private operation?: Promise<void>;
  private download?: AbortController;
  private child?: ChildProcessWithoutNullStreams;
  private endpoint?: { url: string; token: string };
  private starting?: Promise<void>;
  private idle?: NodeJS.Timeout;
  private busy = false;
  private removing = false;
  private ownership?: Database.Database;
  private lastCrash = 0;
  private crashes = 0;

  status(): ManagedSpeechStatus {
    const preferences = speechPreferences();
    const installed = fs.existsSync(path.join(speechPaths().model, 'verified.json'));
    const supported = ['darwin', 'linux'].includes(process.platform) && ['arm64', 'x64'].includes(process.arch);
    return {
      phase: this.phase === 'not-installed' && installed ? 'installed' : this.phase,
      supported, installed, ...preferences, downloadedBytes: this.downloaded, totalBytes: PARAKEET_BYTES,
      error: this.error, model: 'Parakeet v3 INT8', revision: PARAKEET_REVISION,
      helperAvailable: supported && fs.existsSync(helperPath()),
    };
  }
  private claim() {
    if (this.ownership) return;
    fs.mkdirSync(speechPaths().root, { recursive: true, mode: 0o700 });
    const file = path.join(speechPaths().root, 'owner.sqlite');
    fs.closeSync(fs.openSync(file, 'a', 0o600));
    const lock = new Database(file, { timeout: 0 });
    try { lock.exec('BEGIN EXCLUSIVE'); this.ownership = lock; }
    catch { lock.close(); throw new Error('Another Ri backend manages local speech for this installation'); }
  }
  configure(preferences: Partial<SpeechPreferences>) {
    if (this.busy || this.operation || this.removing) throw new Error('Wait for the current local speech operation before changing settings');
    const release = beginActivity();
    try {
      this.claim();
      atomicWriteFile(speechPaths().settings, JSON.stringify({ ...speechPreferences(), ...preferences }));
      if (preferences.enabled === false) this.stop();
      return this.status();
    } finally { release(); }
  }
  install() {
    if (this.removing) throw new Error('Local speech is being removed');
    if (this.operation) return this.status();
    if (this.busy) throw new Error('Wait for the active transcription before repairing local speech');
    if (!this.status().helperAvailable) throw new Error('This build does not include the local speech helper');
    this.claim();
    this.stop();
    const release = beginActivity();
    this.download = new AbortController();
    const signal = AbortSignal.any([this.download.signal, AbortSignal.timeout(30 * 60_000)]);
    this.phase = 'downloading'; this.error = undefined; this.downloaded = 0;
    this.operation = this.installFiles(signal).catch(error => {
      this.error = this.download?.signal.aborted ? 'Download paused. Resume to continue.' : error instanceof Error ? error.message : String(error);
      this.phase = 'error';
    }).finally(() => { this.operation = undefined; this.download = undefined; release(); });
    return this.status();
  }
  private async installFiles(signal: AbortSignal) {
    const paths = speechPaths();
    if (!fs.existsSync(paths.model) && fs.existsSync(`${paths.model}.previous`)) await fs.promises.rename(`${paths.model}.previous`, paths.model);
    fs.mkdirSync(paths.staging, { recursive: true, mode: 0o700 });
    const available = fs.statfsSync(paths.root);
    if (available.bavail * available.bsize < PARAKEET_BYTES + 256 * 1024 * 1024) throw new Error('Local speech needs at least 900 MiB of free disk space');
    let completed = 0;
    for (const spec of PARAKEET_FILES) {
      signal.throwIfAborted();
      // Repair reuses intact model files and only downloads damaged artifacts.
      if (!fs.existsSync(path.join(paths.staging, spec.name)) && await verifyModelFile(path.join(paths.model, spec.name), spec)) {
        await fs.promises.copyFile(path.join(paths.model, spec.name), path.join(paths.staging, spec.name));
      }
      await downloadModelFile({ directory: paths.staging, spec, url: modelUrl(spec.name), signal, progress: bytes => { this.downloaded = completed + bytes; } });
      completed += spec.size;
    }
    this.phase = 'verifying';
    for (const spec of PARAKEET_FILES) if (!(await verifyModelFile(path.join(paths.staging, spec.name), spec))) throw new Error('Model verification failed');
    signal.throwIfAborted();
    atomicWriteFile(path.join(paths.staging, 'verified.json'), JSON.stringify({ revision: PARAKEET_REVISION, verifiedAt: new Date().toISOString() }));
    // The prior verified model remains usable until the complete replacement is ready.
    const previous = `${paths.model}.previous`;
    await fs.promises.rm(previous, { recursive: true, force: true });
    if (fs.existsSync(paths.model)) await fs.promises.rename(paths.model, previous);
    try { await fs.promises.rename(paths.staging, paths.model); }
    catch (error) { if (fs.existsSync(previous)) await fs.promises.rename(previous, paths.model); throw error; }
    const directory = await fs.promises.open(paths.root, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    await fs.promises.rm(previous, { recursive: true, force: true });
    atomicWriteFile(speechPaths().settings, JSON.stringify({ ...speechPreferences(), enabled: true }));
    this.phase = 'installed';
  }
  async cancel() {
    this.download?.abort();
    await this.operation;
    return this.status();
  }
  async uninstall() {
    if (this.busy || this.removing) throw new Error('Wait for the current local speech operation before removing it');
    const release = beginActivity();
    this.removing = true;
    try {
      this.claim();
      await this.cancel(); this.stop();
      atomicWriteFile(speechPaths().settings, JSON.stringify({ ...speechPreferences(), enabled: false }));
      const paths = speechPaths();
      for (const directory of [paths.model, paths.staging, `${paths.model}.previous`]) await fs.promises.rm(directory, { recursive: true, force: true });
      this.phase = 'not-installed'; this.error = undefined; this.downloaded = 0;
      return this.status();
    } finally { this.removing = false; release(); }
  }
  private stop() {
    if (this.idle) clearTimeout(this.idle);
    const child = this.child;
    this.child = undefined; this.endpoint = undefined;
    child?.stdin.end();
    if (child && child.exitCode === null) child.kill('SIGKILL');
    if (!this.operation) this.phase = this.status().installed ? 'installed' : 'not-installed';
  }
  private async ensureStarted(signal: AbortSignal) {
    if (this.endpoint) return;
    if (this.starting) return this.starting;
    const status = this.status();
    if (!status.enabled || !status.installed || !status.helperAvailable) throw new Error('Managed local speech is not installed and enabled');
    if (this.operation) throw new Error('Local speech model installation is still in progress');
    if (this.crashes >= 3 && Date.now() - this.lastCrash < 60_000) throw new Error('Local speech repeatedly stopped. Wait one minute or repair the model');
    this.claim();
    this.starting = (async () => {
      this.phase = 'starting'; this.error = undefined;
      for (const spec of PARAKEET_FILES) if (!(await verifyModelFile(path.join(speechPaths().model, spec.name), spec))) throw new Error('Local speech model is damaged. Use Repair in Voice settings');
      signal.throwIfAborted();
      const token = randomBytes(32).toString('hex');
      const child = spawn(helperPath(), [], { stdio: 'pipe', cwd: speechPaths().root, env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME, HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' } });
      this.child = child;
      child.stderr.on('data', () => {}); // No recordings/transcripts or unbounded helper logs.
      child.on('exit', () => {
        if (this.child !== child) return;
        this.child = undefined; this.endpoint = undefined;
        this.crashes = Date.now() - this.lastCrash < 60_000 ? this.crashes + 1 : 1;
        this.lastCrash = Date.now(); this.phase = 'error'; this.error = 'Local speech stopped. Retry or repair the model.';
      });
      const message = await new Promise<{ port: number }>((resolve, reject) => {
        const timeout = setTimeout(() => { reject(new Error('Local speech model did not become ready within three minutes')); }, 180_000);
        let data = '';
        const cleanup = () => { clearTimeout(timeout); child.stdout.off('data', read); child.off('error', failed); child.off('exit', exited); child.stdin.off('error', failed); signal.removeEventListener('abort', aborted); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const aborted = () => failed(new Error('Local speech startup was cancelled'));
        signal.addEventListener('abort', aborted, { once: true });
        const exited = () => failed(new Error('Local speech helper failed to start. Try Repair in Voice settings'));
        const read = (chunk: Buffer) => {
          data += chunk.toString();
          if (data.length > 8192) { failed(new Error('Invalid speech helper handshake')); return; }
          if (!data.includes('\n')) return;
          try {
            const value = JSON.parse(data.split('\n')[0]);
            if (value.protocol !== 1 || value.ready !== true || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('Invalid speech helper handshake');
            cleanup(); resolve(value);
          } catch (error) { failed(error as Error); }
        };
        child.stdout.on('data', read); child.once('error', failed); child.once('exit', exited);
        child.stdin.on('error', failed);
        child.stdin.write(JSON.stringify({ token, model: speechPaths().model }) + '\n');
      });
      if (this.child !== child) throw new Error('Local speech helper stopped while starting');
      this.endpoint = { url: `http://127.0.0.1:${message.port}`, token };
      this.phase = 'ready';
    })().catch(error => {
      this.stop();
      if (signal.aborted) this.error = undefined;
      else { this.phase = 'error'; this.error = error instanceof Error ? error.message : String(error); }
      throw error;
    }).finally(() => { this.starting = undefined; });
    return this.starting;
  }
  async transcribe(file: Blob, signal?: AbortSignal): Promise<string> {
    if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('Audio must be between 1 byte and 50 MiB');
    if (this.busy || this.removing) throw new Error('Local speech is busy. Try again after the current operation');
    const release = beginActivity(); this.busy = true;
    const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5 * 60_000)]);
    const cancel = () => this.stop(); bounded.addEventListener('abort', cancel, { once: true });
    if (this.idle) clearTimeout(this.idle);
    try {
      bounded.throwIfAborted(); await this.ensureStarted(bounded); bounded.throwIfAborted();
      this.phase = 'transcribing';
      const endpoint = this.endpoint!;
      const response = await fetch(`${endpoint.url}/transcribe`, {
        method: 'POST', headers: { Authorization: `Bearer ${endpoint.token}`, 'Content-Type': file.type || 'application/octet-stream' }, body: file, signal: bounded,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Local transcription failed');
      if (typeof result.text !== 'string' || result.text.length > 200_000) throw new Error('Invalid local transcription response');
      return result.text;
    } finally {
      bounded.removeEventListener('abort', cancel); this.busy = false; release();
      if (this.endpoint) { this.phase = 'ready'; this.idle = setTimeout(() => this.stop(), 5 * 60_000); this.idle.unref(); }
    }
  }
  /** Test/dev cleanup only. Production helpers also exit on parent stdin EOF. */
  async dispose() { await this.cancel(); this.stop(); this.ownership?.close(); this.ownership = undefined; }
}
const globalSpeech = globalThis as typeof globalThis & { managedSpeech?: ManagedSpeech };
export const managedSpeech = () => globalSpeech.managedSpeech ??= new ManagedSpeech();
