import {
  readDesktopActivity, type DesktopActivitySnapshot,
} from '../src/lib/sessions/desktop-activity-contract';

interface Dependencies {
  request(signal: AbortSignal): Promise<unknown>;
  onChange(snapshot: DesktopActivitySnapshot): void;
  intervalMs?: number;
  requestTimeoutMs?: number;
}

/** Main-process polling keeps menu activity fresh while the renderer is
 * hidden. One request at a time, bounded latency, no retained stale targets. */
export class DesktopActivity {
  private state: DesktopActivitySnapshot = { connection: 'connecting' };
  private started = false;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private abort?: AbortController;
  constructor(private readonly deps: Dependencies) {}

  snapshot(): DesktopActivitySnapshot {
    return structuredClone(this.state);
  }
  start() {
    if (this.started || this.stopped) return;
    this.started = true;
    this.publish({ connection: 'connecting' });
    this.schedule(0);
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    this.abort?.abort();
    this.publish({ connection: 'disconnected', ...(this.state.updatedAt !== undefined ? { updatedAt: this.state.updatedAt } : {}) });
  }
  private publish(snapshot: DesktopActivitySnapshot) {
    this.state = snapshot;
    this.deps.onChange(this.snapshot());
  }
  private schedule(delay = this.deps.intervalMs ?? 5000) {
    if (this.stopped || !this.started) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.refresh().finally(() => this.schedule()); }, delay);
    this.timer.unref?.();
  }
  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.read().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async read() {
    const abort = new AbortController();
    this.abort = abort;
    const timeout = setTimeout(() => abort.abort(), this.deps.requestTimeoutMs ?? 10_000);
    timeout.unref?.();
    let rejectAbort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error('Desktop activity request cancelled'));
      abort.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    try {
      // A noncompliant adapter cannot leave the menu claiming fresh status
      // indefinitely. The race also suppresses late results after shutdown.
      const response = await Promise.race([this.deps.request(abort.signal), cancelled]);
      const activity = readDesktopActivity(response);
      if (!this.stopped) this.publish({ connection: 'connected', activity, updatedAt: Date.now() });
    } catch {
      if (!this.stopped) this.publish({ connection: 'disconnected', ...(this.state.updatedAt !== undefined ? { updatedAt: this.state.updatedAt } : {}) });
    } finally {
      clearTimeout(timeout);
      abort.signal.removeEventListener('abort', rejectAbort);
      if (this.abort === abort) this.abort = undefined;
    }
  }
}
