import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { subscribeToWebPush } from './web-push-client';

vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

class Worker extends EventTarget {
  constructor(public state: ServiceWorkerState) { super(); }
  change(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}

function browser(state: ServiceWorkerState | null = 'installing') {
  const worker = state ? new Worker(state) : null;
  const subscribe = vi.fn().mockResolvedValue({ toJSON: () => ({ endpoint: 'https://push.example/subscription', keys: { p256dh: 'key', auth: 'auth' } }) });
  const reg = Object.assign(new EventTarget(), {
    active: state === 'activated' ? worker : null,
    installing: state !== 'activated' ? worker : null,
    waiting: null,
    pushManager: { subscribe },
  });
  const register = vi.fn().mockResolvedValue(reg);
  const requestPermission = vi.fn().mockResolvedValue('granted');
  vi.stubGlobal('window', { PushManager: {}, Notification: {} });
  vi.stubGlobal('Notification', { requestPermission });
  vi.stubGlobal('navigator', { serviceWorker: { register, get ready() { throw new Error('The unbounded global ready promise must not be used'); } } });
  return { reg, worker, subscribe, register };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.get).mockResolvedValue({ publicKey: 'AQID' });
  vi.mocked(api.post).mockResolvedValue({});
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('web push activation', () => {
  it('subscribes an already active worker without the global ready promise', async () => {
    const { subscribe } = browser('activated');
    await subscribeToWebPush();
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) });
    expect(api.post).toHaveBeenCalledWith('/notifications/web-push/subscribe', { endpoint: 'https://push.example/subscription', keys: { p256dh: 'key', auth: 'auth' } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for the registered worker to activate before subscribing', async () => {
    const { reg, worker, subscribe } = browser();
    const pending = subscribeToWebPush();
    await vi.advanceTimersByTimeAsync(0);
    expect(subscribe).not.toHaveBeenCalled();
    reg.installing = null;
    reg.active = worker;
    worker!.change('activated');
    await pending;
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('observes a worker discovered after registration', async () => {
    const { reg, subscribe } = browser(null);
    const pending = subscribeToWebPush();
    await vi.advanceTimersByTimeAsync(0);
    const worker = new Worker('installing');
    reg.installing = worker;
    reg.dispatchEvent(new Event('updatefound'));
    reg.installing = null;
    reg.active = worker;
    worker.change('activated');
    await pending;
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('reports failed installation and never stores a subscription', async () => {
    const { worker, subscribe } = browser();
    const pending = subscribeToWebPush();
    const rejected = expect(pending).rejects.toThrow('Notification setup failed');
    await vi.advanceTimersByTimeAsync(0);
    worker!.change('redundant');
    await rejected;
    expect(subscribe).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out stalled activation, removes listeners and allows a later retry', async () => {
    const { reg, worker, subscribe } = browser();
    const removeStateListener = vi.spyOn(worker!, 'removeEventListener');
    const removeUpdateListener = vi.spyOn(reg, 'removeEventListener');
    const pending = subscribeToWebPush();
    const rejected = expect(pending).rejects.toThrow('Notification setup timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(subscribe).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(removeStateListener).toHaveBeenCalledWith('statechange', expect.any(Function));
    expect(removeUpdateListener).toHaveBeenCalledWith('updatefound', expect.any(Function));
    reg.installing = null;
    reg.active = worker;
    worker!.change('activated');
    await subscribeToWebPush();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
