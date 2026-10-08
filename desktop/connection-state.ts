import { CONNECTION_NOTICE_DELAY_MS, type DesktopConnectionIssue, type DesktopConnectionState } from '../src/lib/connection/desktop-contract';

/** A connection failure never covers an accepted viewer. Startup recovery
 * stays local because no Home document is available yet. */
export class DesktopConnection {
  private state: DesktopConnectionState = { phase: 'connecting', issue: null, showNotice: false };
  private since: number | undefined;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly deps: {
    hasViewer(): boolean;
    publish(state: DesktopConnectionState): void;
    startup(): void;
  }) {}

  snapshot(): DesktopConnectionState { return { ...this.state }; }

  begin() {
    this.since ??= Date.now();
    this.state = { ...this.state, phase: 'connecting' };
    this.publish();
    this.schedule();
  }

  failed(issue: DesktopConnectionIssue) {
    this.since ??= Date.now();
    this.state = { phase: 'failed', issue, showNotice: !issue.retryable || Date.now() - this.since >= CONNECTION_NOTICE_DELAY_MS };
    this.publish();
    this.schedule();
  }

  connected() {
    this.stop();
    this.since = undefined;
    this.state = { phase: 'connected', issue: null, showNotice: false };
    this.publish();
  }

  reset() {
    this.stop();
    this.since = undefined;
    this.state = { phase: 'connecting', issue: null, showNotice: false };
  }

  stop() { clearTimeout(this.timer); this.timer = undefined; }

  private publish() {
    this.deps.publish(this.snapshot());
    if (this.state.showNotice && !this.deps.hasViewer()) this.deps.startup();
  }

  private schedule() {
    this.stop();
    if (this.state.showNotice || this.since === undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.state = { ...this.state, showNotice: true };
      this.publish();
    }, Math.max(0, CONNECTION_NOTICE_DELAY_MS - (Date.now() - this.since)));
    this.timer.unref?.();
  }
}
