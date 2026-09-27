import type { EventEmitter } from 'node:events';
import {
  DESKTOP_NOTIFICATION_BATCH, desktopNotificationPath,
  type DesktopNotificationAction, type DesktopNotificationClaim, type DesktopNotificationStatus,
} from '../src/lib/notifications/desktop-contract';

interface NativeNotification extends EventEmitter { id: string; show(): void; close(): void }
interface State {
  channel: { id: string; enabled: boolean } | null;
  history: { id: string; url: string; status: string; error: string | null }[];
}
interface Dependencies {
  request<T>(body?: object): Promise<T>;
  supported(): boolean;
  create(id: string, title: string, body: string): NativeNotification;
  history?(): Promise<NativeNotification[]>;
  navigate(path: string): void;
  intervalMs?: number;
  confirmationMs?: number;
}

/** A single main-process consumer. The server claims each delivery atomically
 * before native presentation, so reloading the renderer or losing an ACK does
 * not show it twice. The OS and database cannot commit a delivery together. */
export class DesktopNotifications {
  private stopped = false;
  private blocked = false;
  private restored = false;
  private muted = false;
  private refreshSequence = 0;
  private error: string | undefined;
  private transportError: string | undefined;
  private state: State = { channel: null, history: [] };
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private active = new Map<string, NativeNotification>();
  private cancelPresentation?: () => void;
  constructor(private deps: Dependencies) {}

  start() { this.schedule(0); }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.cancelPresentation?.();
    for (const notification of this.active.values()) notification.removeAllListeners();
    this.active.clear();
  }
  private schedule(delay = this.deps.intervalMs ?? 5000) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.pump().finally(() => this.schedule()); }, delay);
    this.timer.unref?.();
  }
  private async request<T>(body?: object): Promise<T> {
    try {
      const result = await this.deps.request<T>(body);
      // A successful empty poll is enough to recover connectivity. It must
      // not erase an OS refusal or unknown presentation outcome awaiting an
      // explicit user retry, including when that presentation's ACK was lost.
      this.transportError = undefined;
      return result;
    } catch (error) {
      if (!this.stopped) this.transportError = 'Desktop notifications are waiting for the local service to reconnect.';
      throw error;
    }
  }
  private async refresh() {
    const sequence = ++this.refreshSequence;
    const state = await this.request<State>();
    if (this.stopped || sequence !== this.refreshSequence) return;
    this.state = state;
    if (!state.channel?.enabled) this.clearActive();
    if (!this.restored && this.state.channel?.enabled && this.deps.history) {
      this.restored = true;
      const paths = new Map(this.state.history.map(row => [`${this.state.channel!.id}:${row.id}`, row.url]));
      for (const notification of (await this.deps.history().catch(() => [])).slice(0, 100)) {
        if (this.stopped || this.muted || !this.state.channel?.enabled) break;
        const target = paths.get(notification.id);
        if (target !== undefined) this.track(notification, target);
      }
    }
  }
  private snapshot(): DesktopNotificationStatus {
    const error = this.error ?? this.transportError;
    return { supported: this.deps.supported(), enabled: this.state.channel?.enabled ?? false,
      ...(this.state.channel ? { channelId: this.state.channel.id } : {}),
      ...(error ? { error } : {}) };
  }
  async action(action: DesktopNotificationAction): Promise<DesktopNotificationStatus> {
    if (this.stopped) throw new Error('The desktop is reconnecting. Please retry.');
    if (action === 'status') { await this.refresh(); return this.snapshot(); }
    if (action !== 'disable' && !this.deps.supported()) throw new Error('Native notifications are unavailable on this computer.');
    if (action === 'disable') { this.muted = true; this.clearActive(); }
    await this.request({ action });
    if (this.stopped) throw new Error('The desktop is reconnecting. Please retry.');
    this.muted = action === 'disable';
    this.error = undefined;
    this.blocked = false;
    await this.refresh();
    if (action === 'disable') {
      this.clearActive();
    } else await this.pump();
    return this.snapshot();
  }
  private clearActive() {
    this.cancelPresentation?.();
    for (const notification of this.active.values()) { notification.removeAllListeners(); notification.close(); }
    this.active.clear();
  }
  private track(notification: NativeNotification, target: string) {
    // Only fixed-origin application navigation crosses this callback. Never
    // invoke shell.openExternal or interpret a link as a native operation.
    notification.on('click', () => { if (!this.stopped && !this.muted && this.state.channel?.enabled) this.deps.navigate(desktopNotificationPath(target)); });
    notification.on('close', () => { this.active.delete(notification.id); notification.removeAllListeners(); });
    this.active.set(notification.id, notification);
    while (this.active.size > 50) {
      const oldest = this.active.values().next().value!;
      oldest.removeAllListeners(); oldest.close(); this.active.delete(oldest.id);
    }
  }
  private present(claim: DesktopNotificationClaim, channelId: string): Promise<{ status: 'sent' | 'failed' | 'skipped'; error?: string }> {
    return new Promise(resolve => {
      let notification: NativeNotification;
      let done = false;
      const finish = (result: { status: 'sent' | 'failed' | 'skipped'; error?: string }) => {
        if (done) return;
        done = true; clearTimeout(timer); this.cancelPresentation = undefined;
        notification?.removeListener('show', shown); notification?.removeListener('failed', failed);
        if (result.status === 'failed') { notification?.removeAllListeners(); notification?.close(); if (notification) this.active.delete(notification.id); }
        resolve(result);
      };
      const shown = () => finish({ status: 'sent' });
      const failed = (_event: unknown, reason?: string) => finish({ status: 'failed', error: `The operating system could not show this notification. ${typeof reason === 'string' ? reason.slice(0, 500) : ''} Check notification settings and use a signed Ri build on macOS.` });
      const timer = setTimeout(() => finish({ status: 'skipped', error: 'The operating system did not confirm this notification. Check its notification settings. It will not be repeated automatically.' }), this.deps.confirmationMs ?? 10_000);
      this.cancelPresentation = () => finish({ status: 'skipped', error: 'Ri reconnected before the operating system confirmed delivery.' });
      try {
        notification = this.deps.create(`${channelId}:${claim.id}`, claim.notification.title.slice(0, 160), claim.notification.body.slice(0, 1000));
        this.track(notification, claim.notification.url);
        notification.once('show', shown); notification.once('failed', failed);
        notification.show();
      } catch { failed(undefined); }
    });
  }
  async pump(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.deliver().catch(() => {
      // Requests record transient connection failures independently of native
      // presentation failures. The next scheduled poll can recover either a
      // failed read or a lost ACK without replaying the claimed notification.
    }).finally(() => { this.running = undefined; });
    return this.running;
  }
  private async deliver() {
    if (this.stopped || !this.deps.supported()) return;
    await this.refresh();
    if (this.stopped || this.muted || !this.state.channel?.enabled || this.blocked) return;
    const channelId = this.state.channel.id;
    for (let index = 0; index < DESKTOP_NOTIFICATION_BATCH && !this.stopped; index++) {
      const { claim } = await this.request<{ claim: DesktopNotificationClaim | null }>({ action: 'claim' });
      if (!claim || this.stopped || this.muted || !this.state.channel?.enabled) return;
      const result = await this.present(claim, channelId);
      if (result.status !== 'sent') { this.error = result.error; this.blocked = true; }
      else this.error = undefined;
      if (this.stopped) return;
      await this.request({ action: 'ack', id: claim.id, receipt: claim.receipt, ...result });
      if (this.blocked) return;
    }
  }
}
