/** Local controller for the enrolled worker. No Home database imports. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { getConfigDir } from '@/lib/config/paths';
import { readConnection } from '@/lib/connection/config';
import { readWorkerConfig } from '@/lib/worker/config';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { serviceEnvironment } from './environment';
import { redactServiceLine } from './logging';
import { ownedProcesses } from './processes';

export interface ServiceWorkerStatus {
  state: 'starting' | 'connecting' | 'connected' | 'disconnected' | 'update-required' | 'stopped' | 'blocked' | 'failed';
  enabled: boolean;
  pid?: number;
  error?: string;
  reason?: string;
  retryInMs?: number;
  activity: string[];
  pending?: { events: number; acknowledgements: number };
}
interface Preference { format: 1; enrollment: string; enabled: boolean; reason?: string; error?: string }
interface Snapshot { activity: string[]; state?: ServiceWorkerStatus['state'] }
interface Reply { type: 'reply'; id: string; activity?: string[]; pending?: ServiceWorkerStatus['pending']; error?: string }
interface Exit { reason: string; message?: string }
export type WorkerChildMessage = Reply | { type: 'state'; state: { state: ServiceWorkerStatus['state']; error?: string; retryInMs?: number } }
  | { type: 'activity'; activity: string[]; pending?: ServiceWorkerStatus['pending'] } | { type: 'exit'; exit: Exit };

function enrollmentIdentity(): string {
  const connection = readConnection();
  const worker = readWorkerConfig();
  if (!connection || !worker || worker.homeId !== connection.homeId || (connection.deviceId && connection.deviceId !== worker.deviceId)) throw new Error('This device is not enrolled with its connected Home.');
  return createHash('sha256').update(JSON.stringify([worker.homeId, worker.deviceId, worker.workerKey])).digest('hex');
}
function preferenceFile() { return path.join(getConfigDir(), 'worker-service.json'); }
function readPreference(enrollment: string): Preference {
  const file = preferenceFile();
  if (!fs.existsSync(file)) return { format: 1, enrollment, enabled: true };
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 8192 || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw new Error('Unsafe worker service preference. Inspect its permissions before starting.');
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Preference;
  if (value.format !== 1 || typeof value.enrollment !== 'string' || typeof value.enabled !== 'boolean') throw new Error('Unsupported worker service preference. Inspect it before starting.');
  return value.enrollment === enrollment ? value : { format: 1, enrollment, enabled: true };
}

/** Terminal authority failures are never restarted automatically. A deliberate
 * local stop is written before the child is signalled, and survives login. */
export class ServiceWorker {
  private child?: ChildProcess;
  private closing?: Promise<void>;
  private restart?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private forcedStop = false;
  private attempts = 0;
  private enrollment = enrollmentIdentity();
  private preference = readPreference(this.enrollment);
  private current: ServiceWorkerStatus = { state: this.preference.enabled ? 'starting' : this.preference.reason ? 'blocked' : 'stopped', enabled: this.preference.enabled, activity: [], reason: this.preference.reason, error: this.preference.error };
  private pending = new Map<string, { resolve: (value: Snapshot) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private options: { repo: string; node: string; env?: NodeJS.ProcessEnv; spawn?: typeof fork; retryMs?: number; stopMs?: number; onChild?: (pid?: number) => void }) {}

  matchesEnrollment() { return enrollmentIdentity() === this.enrollment; }
  status(): ServiceWorkerStatus { return { ...this.current, activity: [...this.current.activity] }; }
  async start(): Promise<void> {
    if (this.disposed || this.child || !this.preference.enabled) return;
    if (enrollmentIdentity() !== this.enrollment) throw new Error('The worker enrollment changed. Refresh the device connection before starting it.');
    const env = serviceEnvironment(this.options.node, this.options.env);
    delete env.RI_DESKTOP_CLIENT_SECRET;
    delete env.RI_SERVICE_CONTROL_TOKEN;
    const entry = path.join(this.options.repo, 'dist/service/worker.cjs');
    const child = (this.options.spawn ?? fork)(entry, [], { execPath: this.options.node, execArgv: [], cwd: this.options.repo, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    this.child = child;
    this.options.onChild?.(child.pid);
    this.current = { state: 'starting', enabled: true, pid: child.pid, activity: ['Worker is starting'] };
    const secrets = [readConnection()?.credential ?? '', readWorkerConfig()?.workerKey ?? '', ...Object.entries(env).filter(([name]) => /KEY|TOKEN|SECRET/.test(name)).map(([, value]) => value ?? '')];
    for (const input of [child.stdout, child.stderr]) if (input) createInterface({ input }).on('line', line => console.info(redactServiceLine(line, secrets)));
    let terminal: Exit | undefined;
    child.on('message', (message: WorkerChildMessage) => {
      if (this.child !== child || !message || typeof message !== 'object') return;
      if (message.type === 'state') {
        if (message.state.state === 'connected') this.attempts = 0;
        this.current = { ...this.current, ...message.state, error: message.state.error, retryInMs: message.state.retryInMs, enabled: this.preference.enabled };
      } else if (message.type === 'activity') { this.current.activity = message.activity; this.current.pending = message.pending; }
      else if (message.type === 'exit') terminal = message.exit;
      else if (message.type === 'reply') {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        clearTimeout(waiter.timer); this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error));
        else { this.current.activity = message.activity ?? []; this.current.pending = message.pending; waiter.resolve({ activity: this.current.activity }); }
      }
    });
    child.once('error', error => { this.current.error = error.message; });
    child.once('close', (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.options.onChild?.();
      for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Worker exited before answering the controller.')); }
      this.pending.clear();
      if (this.forcedStop) { terminal = { reason: 'cleanup', message: 'The worker did not stop cleanly. Resume to inspect and stop its recorded processes before accepting more work.' }; this.forcedStop = false; }
      if (!this.closing && !this.disposed && this.preference.enabled && (!terminal || terminal.reason === 'stopped') && this.attempts >= 5) terminal = { reason: 'crash-loop', message: 'The worker repeatedly exited. Review diagnostics, then resume local execution.' };
      if (terminal && terminal.reason !== 'stopped') {
        this.preference = { format: 1, enrollment: this.enrollment, enabled: false, reason: terminal.reason, error: terminal.message };
        try { atomicWriteFile(preferenceFile(), JSON.stringify(this.preference)); }
        catch { terminal.message = `${terminal.message ?? 'Worker stopped.'} The disabled state could not be saved. Check disk space and permissions.`; }
        this.current = { state: 'blocked', enabled: false, reason: terminal.reason, error: terminal.message, activity: terminal.reason === 'cleanup' ? ['Local worker cleanup requires attention'] : [] };
        return;
      }
      if (this.disposed || this.closing || !this.preference.enabled) { this.current = { ...this.current, state: this.preference.reason ? 'blocked' : 'stopped', pid: undefined, enabled: this.preference.enabled, activity: [] }; return; }
      const retryInMs = Math.min(30_000, (this.options.retryMs ?? 1000) * 2 ** Math.min(this.attempts++, 5));
      this.current = { state: 'failed', enabled: true, error: this.current.error ?? `Worker exited (${signal ?? code}). Retrying.`, retryInMs, activity: ['Worker is restarting'] };
      this.restart = setTimeout(() => { this.restart = undefined; void this.start().catch(error => { this.current = { ...this.current, state: 'blocked', error: error.message }; }); }, retryInMs);
      this.restart.unref();
    });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  }
  private async request(action: 'activity' | 'prepare' | 'resume'): Promise<Snapshot> {
    const child = this.child;
    if (!child?.connected) return { activity: this.preference.reason === 'cleanup' ? ['Local worker cleanup requires attention'] : this.preference.enabled ? ['Worker is unavailable'] : [] };
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Worker control request timed out.')); }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      child.send({ action, id }, error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } });
    });
  }
  async activity() {
    const reasons = (await this.request('activity')).activity;
    const children = this.child?.pid ? await ownedProcesses(this.child.pid) : [];
    return [...reasons, ...(children.length ? [`${children.length} worker-owned processes`] : [])];
  }
  async prepareIdle() { await this.request('prepare'); }
  async resumeAdmission() { if (this.child) await this.request('resume'); }
  async stop(deliberate = false): Promise<void> {
    if (deliberate) {
      this.preference = { format: 1, enrollment: this.enrollment, enabled: false };
      atomicWriteFile(preferenceFile(), JSON.stringify(this.preference));
      this.current.enabled = false;
    }
    clearTimeout(this.restart); this.restart = undefined;
    if (this.closing) return this.closing;
    const child = this.child;
    if (!child) { this.current = { ...this.current, state: this.preference.reason ? 'blocked' : 'stopped', pid: undefined, enabled: this.preference.enabled, activity: [] }; return; }
    this.closing = new Promise<void>(resolve => {
      const force = setTimeout(() => { this.forcedStop = true; child.kill('SIGKILL'); }, this.options.stopMs ?? 45_000);
      child.once('close', () => { clearTimeout(force); resolve(); });
      child.kill('SIGTERM');
    });
    try { await this.closing; } finally { this.closing = undefined; }
  }
  async resume(): Promise<void> {
    if (this.closing) await this.closing;
    if (this.preference.enabled && this.child) return;
    clearTimeout(this.restart); this.restart = undefined; this.attempts = 0;
    this.preference = { format: 1, enrollment: this.enrollment, enabled: true };
    atomicWriteFile(preferenceFile(), JSON.stringify(this.preference));
    this.current = { state: 'starting', enabled: true, activity: [] };
    await this.start();
  }
  async dispose() { this.disposed = true; await this.stop(); }
}

/** Execute only the candidate's read-only role/format validation path. No
 * command journal constructor, worker connection or database is opened. */
export async function validateWorkerRuntime(target: { repo: string; node: string }) {
  const env = serviceEnvironment(target.node);
  delete env.RI_DESKTOP_CLIENT_SECRET; delete env.RI_SERVICE_CONTROL_TOKEN;
  env.RI_RUNTIME_REPO = target.repo;
  const child = fork(path.join(target.repo, 'dist/service/worker.cjs'), ['--validate'], {
    execPath: target.node, execArgv: [], cwd: target.repo, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  await new Promise<void>((resolve, reject) => {
    let error: string | undefined;
    const timer = setTimeout(() => { error = 'Candidate worker validation timed out.'; child.kill('SIGKILL'); }, 30_000);
    child.on('message', (message: WorkerChildMessage) => { if (message.type === 'exit') error = message.exit.message; });
    child.once('error', cause => { error = cause.message; });
    child.once('close', code => { clearTimeout(timer); if (code === 0 && !error) resolve(); else reject(new Error(error ?? 'Candidate worker validation failed.')); });
  });
}
