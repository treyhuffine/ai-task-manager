import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopNotifications } from './notifications';
import { desktopRequestHeaders } from './trust';
import type { DesktopNotificationClaim } from '../src/lib/notifications/desktop-contract';

const controllers: DesktopNotifications[] = [];
afterEach(() => { controllers.splice(0).forEach(controller => controller.stop()); vi.useRealTimers(); });
function fixture(options: { fail?: boolean; hang?: boolean; ackLost?: boolean; count?: number } = {}) {
  let enabled = true;
  const claims: DesktopNotificationClaim[] = Array.from({ length: options.count ?? 1 }, (_, index) => ({ id: `${index}`, receipt: `receipt-${index}`, notification: { title: 'Finished', body: 'Review', url: '/?session=chat-1' } }));
  class Native extends EventEmitter {
    closed = false;
    constructor(readonly id: string) { super(); }
    show() { if (!options.hang) this.emit(options.fail ? 'failed' : 'show', {}, 'Denied'); }
    close() { this.closed = true; this.emit('close'); }
  }
  const created: Native[] = [];
  const request = vi.fn(async (body?: object) => {
    const action = body as { action?: string } | undefined;
    if (!action) return { channel: { id: 'desktop:one', enabled }, history: [] };
    if (action.action === 'claim') return { claim: claims.shift() ?? null };
    if (action.action === 'disable') enabled = false;
    if (action.action === 'enable') enabled = true;
    if (action.action === 'ack' && options.ackLost) throw new Error('Connection lost');
    return {};
  });
  const navigate = vi.fn();
  const history = vi.fn(async (): Promise<Native[]> => []);
  const deps = { request: request as <T>(body?: object) => Promise<T>, supported: () => true,
    create: (id: string) => { const n = new Native(id); created.push(n); return n; }, navigate, history, confirmationMs: 20 };
  const controller = new DesktopNotifications(deps); controllers.push(controller);
  return { controller, request, created, navigate, claims, Native, history, deps };
}

describe('main-process desktop notification consumer', () => {
  it('serializes overlapping polls and acknowledges only native show confirmation', async () => {
    const f = fixture(); await Promise.all([f.controller.pump(), f.controller.pump()]);
    expect(f.created).toHaveLength(1);
    expect(f.request).toHaveBeenCalledWith({ action: 'ack', id: '0', receipt: 'receipt-0', status: 'sent' });
    f.created[0].emit('click'); expect(f.navigate).toHaveBeenCalledWith('/?session=chat-1');
    f.controller.stop(); f.created[0].emit('click'); expect(f.navigate).toHaveBeenCalledTimes(1);
  });
  it('does not replay a presentation whose ACK was lost', async () => {
    const f = fixture({ ackLost: true }); await f.controller.pump(); await f.controller.pump();
    expect(f.created).toHaveLength(1);
    expect((await f.controller.action('status')).error).toBeUndefined();
  });
  it('clears a transient connection error after an empty healthy poll', async () => {
    const f = fixture({ count: 0 });
    f.request.mockRejectedValueOnce(new Error('Temporarily disconnected'));
    await f.controller.pump(); await f.controller.pump();
    expect((await f.controller.action('status')).error).toBeUndefined();
    expect(f.created).toEqual([]);
  });
  it('retains the native refusal reason when its acknowledgment is also lost', async () => {
    const f = fixture({ fail: true, ackLost: true, count: 2 });
    await f.controller.pump(); await f.controller.pump();
    expect((await f.controller.action('status')).error).toContain('operating system');
    expect(f.created).toHaveLength(1);
  });
  it('records OS rejection and pauses delivery until the user retries', async () => {
    const f = fixture({ fail: true, count: 3 }); await f.controller.pump(); await f.controller.pump();
    expect(f.created).toHaveLength(1); expect(f.created[0].closed).toBe(true);
    expect((await f.controller.action('status')).error).toContain('operating system');
    await f.controller.action('enable'); expect(f.created).toHaveLength(2);
  });
  it('treats unconfirmed presentation as unknown, not delivered or retryable', async () => {
    vi.useFakeTimers(); const f = fixture({ hang: true });
    const pending = f.controller.pump(); await vi.advanceTimersByTimeAsync(30); await pending;
    expect(f.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'ack', status: 'skipped' }));
    expect((await f.controller.action('status')).error).toContain('not confirm');
  });
  it('stops a pending presentation and releases its listeners and timer', async () => {
    vi.useFakeTimers(); const f = fixture({ hang: true }); const pending = f.controller.pump();
    await vi.advanceTimersByTimeAsync(0); f.controller.stop(); await pending;
    expect(f.created[0].eventNames()).toEqual([]); expect(vi.getTimerCount()).toBe(0);
    expect(f.request.mock.calls.filter(([body]) => (body as { action?: string })?.action === 'ack')).toHaveLength(0);
  });
  it('does not display a claim arriving after disable or quit', async () => {
    for (const action of ['disable', 'stop'] as const) {
      const f = fixture(); let resolve!: (value: object) => void;
      f.request.mockImplementationOnce(async () => ({ channel: { id: 'desktop:one', enabled: true }, history: [] }));
      f.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
      const pending = f.controller.pump(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
      if (action === 'stop') f.controller.stop(); else await f.controller.action('disable');
      resolve({ claim: f.claims[0] }); await pending; expect(f.created).toHaveLength(0);
    }
  });
  it('restores only this installation’s known history without redisplaying it', async () => {
    const f = fixture({ count: 0 }); const known = new f.Native('desktop:one:existing'); const foreign = new f.Native('desktop:two:existing');
    f.history.mockResolvedValue([known, foreign]);
    f.request.mockResolvedValueOnce({ channel: { id: 'desktop:one', enabled: true }, history: [{ id: 'existing', url: 'https://evil.example', status: 'sent', error: null }] } as never);
    await f.controller.pump(); expect(f.created).toEqual([]);
    known.emit('click'); foreign.emit('click'); expect(f.navigate.mock.calls).toEqual([['/']]);
  });
  it('does not attach history listeners after the controller stops during restoration', async () => {
    const f = fixture({ count: 0 }); const known = new f.Native('desktop:one:existing');
    let resolve!: (value: typeof known[]) => void;
    f.history.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    f.request.mockResolvedValueOnce({ channel: { id: 'desktop:one', enabled: true }, history: [{ id: 'existing', url: '/?session=old', status: 'sent', error: null }] } as never);
    const pending = f.controller.pump();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    f.controller.stop(); resolve([known]); await pending;
    expect(known.eventNames()).toEqual([]); expect(f.created).toEqual([]);
    known.emit('click'); expect(f.navigate).not.toHaveBeenCalled();
  });
  it('bounds each poll and retained native handles', async () => {
    const f = fixture({ count: 60 }); await f.controller.pump(); expect(f.created).toHaveLength(5);
    for (let i = 0; i < 11; i++) await f.controller.pump();
    expect(f.created).toHaveLength(60); expect(f.created.filter(n => !n.closed)).toHaveLength(50);
    await f.controller.action('disable'); expect(f.created.every(n => n.closed)).toBe(true);
  });
});

describe('desktop capability header admission', () => {
  const base = { headers: { 'X-Ri-Desktop-Client': 'secret' }, capability: 'secret', origin: 'https://localhost:1', url: 'https://localhost:1/api/desktop/notifications', nativeRequest: false, trustedMainFrame: false };
  it('allows a main-process request only when it already has the exact private capability', () => {
    expect(desktopRequestHeaders({ ...base, nativeRequest: true })).toEqual({ 'x-ri-desktop-client': 'secret' });
    expect(desktopRequestHeaders({ ...base, nativeRequest: true, headers: { 'x-ri-desktop-client': 'forged' } })).toEqual({});
    expect(desktopRequestHeaders({ ...base, nativeRequest: true, headers: {} })).toEqual({});
  });
  it('never forwards to another origin or an untrusted subframe', () => {
    expect(desktopRequestHeaders(base)).toEqual({});
    expect(desktopRequestHeaders({ ...base, nativeRequest: true, url: 'https://evil.example' })).toEqual({});
    expect(desktopRequestHeaders({ ...base, trustedMainFrame: true, url: 'https://localhost:2' })).toEqual({});
    expect(desktopRequestHeaders({ ...base, nativeRequest: true, headers: { ...base.headers, 'x-ri-desktop-client': 'secret' } })).toEqual({});
  });
  it('injects the capability only for an authenticated main frame at the selected origin', () => {
    expect(desktopRequestHeaders({ ...base, headers: {}, trustedMainFrame: true })).toEqual({ 'x-ri-desktop-client': 'secret' });
  });
});
