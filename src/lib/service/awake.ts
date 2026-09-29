import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '@/lib/config/atomic-write';
import { servicePaths } from './paths';
import { AwakePreferencesSchema, type AwakePreferences, type AwakeStatus } from './awake-settings';
import { readPowerSource, type PowerSource } from './awake-power';
import { startAwakeLease, type AwakeLease } from './awake-lease';

export const AWAKE_POLL_MS = 10_000;
export const AWAKE_POWER_TIMEOUT_MS = 5000;
const RENEW_AFTER_MS = 30_000;
const preferenceFile = () => {
  const paths = servicePaths();
  // Advanced installations may deliberately share a config directory while
  // retaining separate roots/databases and owner locks. Their live assertions
  // and saved choices must remain independent as well.
  return path.join(paths.identity.config, `service-awake-${paths.id}.json`);
};
export function readAwakePreferences(file = preferenceFile()): AwakePreferences {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof data !== 'object' || data === null || !('version' in data) || data.version !== 1) throw new Error('Invalid keep-awake preferences');
    const preferences: Record<string, unknown> = { ...data };
    delete preferences.version;
    return AwakePreferencesSchema.parse(preferences);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { enabled: false };
    throw new Error('Keep-awake preferences could not be read. Save the preference again to repair it.');
  }
}
export function writeAwakePreferences(value: unknown, file = preferenceFile()): AwakePreferences {
  const preferences = AwakePreferencesSchema.parse(value);
  atomicWriteFile(file, JSON.stringify({ version: 1, ...preferences }));
  return preferences;
}

interface AwakeDependencies {
  platform: NodeJS.Platform;
  read(): AwakePreferences;
  write(value: unknown): AwakePreferences;
  power(): Promise<PowerSource>;
  acquire(): Promise<AwakeLease>;
  now(): number;
}

/** One instance per controller, protected by the existing service owner lock.
 * Revisions make disable/shutdown win over an in-flight power read or spawn.
 * Assertions expire independently if this controller stalls or disappears. */
export class ServiceAwake {
  private state: AwakeStatus = { enabled: false, phase: 'stopped', power: 'unknown', detail: 'The background service is stopped.' };
  private running = false;
  private revision = 0;
  private timer?: ReturnType<typeof setInterval>;
  private lease?: { handle: AwakeLease; since: number };
  private pending?: Promise<void>;
  private powerRead?: Promise<PowerSource>;
  private readonly dependencies: AwakeDependencies;

  constructor(dependencies: Partial<AwakeDependencies> = {}) {
    const platform = dependencies.platform ?? process.platform;
    this.dependencies = { platform, read: readAwakePreferences, write: writeAwakePreferences,
      power: () => readPowerSource(platform), acquire: () => startAwakeLease(platform), now: () => performance.now(), ...dependencies };
  }
  status(): AwakeStatus {
    if (this.state.phase === 'active' && (!this.lease?.handle.alive() || this.dependencies.now() - this.lease.since >= 60_000)) {
      return { ...this.state, phase: 'unavailable', detail: 'The sleep inhibitor ended. Ri will check again shortly.' };
    }
    return { ...this.state };
  }
  async start() {
    if (this.running) return;
    this.running = true;
    try { this.state.enabled = this.dependencies.read().enabled; }
    catch (error) {
      this.state = { enabled: false, phase: 'unavailable', power: 'unknown', detail: (error as Error).message };
      return;
    }
    this.timer = setInterval(() => void this.refresh(), AWAKE_POLL_MS);
    this.timer.unref();
    await this.refresh();
  }
  async configure(input: unknown): Promise<AwakeStatus> {
    const preferences = AwakePreferencesSchema.parse(input);
    if (!this.running) throw new Error('Start the background service before changing keep-awake preferences.');
    // Persist before promising the preference, and do not modify the current
    // assertion when disk write fails. The active controller is the sole writer.
    this.dependencies.write(preferences);
    this.revision++;
    this.state.enabled = preferences.enabled;
    if (!this.timer) { this.timer = setInterval(() => void this.refresh(), AWAKE_POLL_MS); this.timer.unref(); }
    await this.pending;
    await this.refresh();
    return this.status();
  }
  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    const job = this.reconcile();
    this.pending = job;
    void job.finally(() => { if (this.pending === job) this.pending = undefined; });
    return job;
  }
  private async release() {
    const lease = this.lease;
    this.lease = undefined;
    await lease?.handle.stop();
  }
  private async checkPower(): Promise<PowerSource> {
    const unavailable: PowerSource = { power: 'unknown', detail: 'The power-source check took too long. Ri will check again shortly.' };
    // A timed-out filesystem/OS operation may still be in flight. Do not
    // accumulate another hung read on each poll. Its late result only clears
    // the slot, never revives an assertion or updates visible state.
    if (this.powerRead) return unavailable;
    const read = Promise.resolve().then(() => this.dependencies.power());
    this.powerRead = read;
    const clear = () => { if (this.powerRead === read) this.powerRead = undefined; };
    void read.then(clear, clear);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        read,
        new Promise<PowerSource>(resolve => {
          timer = setTimeout(() => resolve(unavailable), AWAKE_POWER_TIMEOUT_MS);
          timer.unref();
        }),
      ]);
    } finally { clearTimeout(timer); }
  }
  private async reconcile() {
    const revision = this.revision;
    if (!this.running) return;
    try {
      if (!this.state.enabled) {
        await this.release();
        if (!this.running || revision !== this.revision) return;
        this.state = { enabled: false, phase: 'off', power: 'unknown', detail: 'Ri follows this computer’s sleep settings.' };
        return;
      }
      if (!['darwin', 'linux'].includes(this.dependencies.platform)) {
        this.state = { ...this.state, phase: 'unsupported', power: 'unknown', detail: 'Keep awake is available on macOS and Linux.' };
        return;
      }
      if (!this.lease) this.state = { ...this.state, phase: 'checking', detail: 'Checking external power and sleep inhibition.' };
      const powerStarted = this.dependencies.now();
      let source = await this.checkPower();
      if (!this.running || revision !== this.revision) return;
      if (this.dependencies.now() - powerStarted > AWAKE_POWER_TIMEOUT_MS) {
        source = { power: 'unknown', detail: 'The power-source check took too long. Ri will check again shortly.' };
      }
      this.state.power = source.power;
      if (source.power !== 'external') {
        await this.release();
        if (!this.running || revision !== this.revision) return;
        this.state = { ...this.state, phase: source.power === 'battery' ? 'on-battery' : 'unavailable', detail: source.detail };
        return;
      }
      if (!this.lease?.handle.alive() || this.dependencies.now() - this.lease.since >= RENEW_AFTER_MS) {
        const handle = await this.dependencies.acquire();
        if (!this.running || revision !== this.revision) { await handle.stop(); return; }
        const previous = this.lease;
        this.lease = { handle, since: this.dependencies.now() };
        await previous?.handle.stop();
      }
      if (!this.running || revision !== this.revision) return;
      this.state = { ...this.state, phase: 'active', detail: 'Keeping this computer awake on external power. The display can still sleep.' };
    } catch (error) {
      await this.release().catch(() => {});
      if (this.running && revision === this.revision) this.state = { ...this.state, phase: 'unavailable', detail: error instanceof Error ? error.message : 'Sleep inhibition is unavailable.' };
    }
  }
  async stop() {
    this.running = false;
    this.revision++;
    clearInterval(this.timer);
    this.timer = undefined;
    await this.pending;
    await this.release();
    this.state = { ...this.state, phase: 'stopped', power: 'unknown', detail: 'The background service is stopped.' };
  }
}
