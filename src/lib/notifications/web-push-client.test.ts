import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBrowserPushStatus, isWebPushSubscribed, removeDesktopWebPushSubscription, subscribeToWebPush, unsubscribeFromWebPush, webPushSupported } from './web-push-client';

const rpc = vi.hoisted(() => ({ key: vi.fn(), subscribe: vi.fn(), status: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('@/lib/trpc/client', () => ({ trpcClient: { notifications: {
  webPushPublicKeyGet: { query: rpc.key }, webPushSubscribePost: { mutate: rpc.subscribe },
  webPushStatusPost: { mutate: rpc.status }, webPushUnsubscribePost: { mutate: rpc.unsubscribe },
} } }));

class Worker extends EventTarget {
  constructor(public state: ServiceWorkerState) { super(); }
  change(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}

function browser(state: ServiceWorkerState | null = 'installing') {
  const worker = state ? new Worker(state) : null;
  const sub = { endpoint: 'https://push.example/subscription', expirationTime: null as number | null, toJSON: () => ({ endpoint: 'https://push.example/subscription', keys: { p256dh: 'key', auth: 'auth' } }), unsubscribe: vi.fn().mockResolvedValue(true) };
  const subscribe = vi.fn().mockResolvedValue(sub);
  const getSubscription = vi.fn().mockResolvedValue(null);
  const reg = Object.assign(new EventTarget(), {
    active: state === 'activated' ? worker : null,
    installing: state !== 'activated' ? worker : null,
    waiting: null,
    pushManager: { subscribe, getSubscription },
  });
  const register = vi.fn().mockResolvedValue(reg);
  const requestPermission = vi.fn().mockResolvedValue('granted');
  vi.stubGlobal('window', { PushManager: {}, Notification: {} });
  vi.stubGlobal('Notification', { requestPermission, permission: 'default' });
  vi.stubGlobal('navigator', { serviceWorker: { register, getRegistration: vi.fn().mockResolvedValue(reg), get ready() { throw new Error('The unbounded global ready promise must not be used'); } } });
  return { reg, worker, subscribe, register, getSubscription, sub, requestPermission };
}

beforeEach(() => {
  vi.useFakeTimers();
  rpc.key.mockResolvedValue({ publicKey: 'AQID' });
  for (const fn of [rpc.subscribe, rpc.status, rpc.unsubscribe]) fn.mockReset().mockResolvedValue({});
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('web push activation', () => {
  it('uses native alerts in Electron and removes only this profile’s old subscription on opt-in', async () => {
    const { register } = browser('activated');
    Object.assign(window, { riDesktop: {} });
    expect(webPushSupported()).toBe(false);
    await expect(subscribeToWebPush()).rejects.toThrow('not supported');
    expect(register).not.toHaveBeenCalled();
    const unsubscribe = vi.fn().mockResolvedValue(true);
    Object.assign(navigator.serviceWorker, { getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription: async () => ({ endpoint: 'this-profile', unsubscribe }) } }) });
    await removeDesktopWebPushSubscription();
    expect(rpc.unsubscribe).toHaveBeenCalledWith({ body: { endpoint: 'this-profile' } });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('does not remove another browser subscription or continue after failed cleanup', async () => {
    browser('activated'); await removeDesktopWebPushSubscription(); for (const fn of [rpc.subscribe, rpc.status, rpc.unsubscribe]) expect(fn).not.toHaveBeenCalled();
    Object.assign(window, { riDesktop: {} });
    const unsubscribe = vi.fn().mockResolvedValue(true);
    Object.assign(navigator.serviceWorker, { getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription: async () => ({ endpoint: 'this-profile', unsubscribe }) } }) });
    rpc.unsubscribe.mockRejectedValueOnce(new Error('Offline'));
    await expect(removeDesktopWebPushSubscription()).rejects.toThrow('Offline');
    expect(unsubscribe).not.toHaveBeenCalled();
  });
  it('subscribes an already active worker without the global ready promise', async () => {
    const { subscribe } = browser('activated');
    await subscribeToWebPush();
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) });
    expect(rpc.subscribe).toHaveBeenCalledWith({ body: { endpoint: 'https://push.example/subscription', keys: { p256dh: 'key', auth: 'auth' } } }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
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
    for (const fn of [rpc.subscribe, rpc.status, rpc.unsubscribe]) expect(fn).not.toHaveBeenCalled();
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
    for (const fn of [rpc.subscribe, rpc.status, rpc.unsubscribe]) expect(fn).not.toHaveBeenCalled();
    expect(removeStateListener).toHaveBeenCalledWith('statechange', expect.any(Function));
    expect(removeUpdateListener).toHaveBeenCalledWith('updatefound', expect.any(Function));
    reg.installing = null;
    reg.active = worker;
    worker!.change('activated');
    await subscribeToWebPush();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});

const serverState = { registered: true, channel: { enabled: true, events: ['execution.finished'] } };
function permission(value: NotificationPermission) { Object.assign(Notification, { permission: value }); }

describe('browser subscription reconciliation', () => {
  it('checks local endpoint and keys without requesting permission, registering or subscribing', async () => {
    const b = browser('activated'); permission('granted'); b.getSubscription.mockResolvedValue(b.sub);
    rpc.status.mockResolvedValue(serverState);
    expect(await getBrowserPushStatus()).toMatchObject({ registered: true, localSubscription: true, permission: 'granted' });
    expect(rpc.status).toHaveBeenCalledWith({ body: b.sub.toJSON() }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(b.register).not.toHaveBeenCalled(); expect(b.subscribe).not.toHaveBeenCalled(); expect(b.requestPermission).not.toHaveBeenCalled();
  });
  it('never reports ready after failed persistence and repairs the same local registration explicitly', async () => {
    const b = browser('activated'); permission('granted');
    rpc.subscribe.mockRejectedValueOnce(new Error('Offline'));
    await expect(subscribeToWebPush()).rejects.toThrow('Repair browser notifications');
    b.getSubscription.mockResolvedValue(b.sub);
    rpc.status.mockResolvedValue({ registered: false, channel: null });
    expect(await isWebPushSubscribed()).toBe(false);
    expect(b.sub.unsubscribe).not.toHaveBeenCalled();
    b.subscribe.mockClear(); b.requestPermission.mockClear();
    await subscribeToWebPush();
    expect(b.subscribe).not.toHaveBeenCalled(); expect(b.requestPermission).not.toHaveBeenCalled();
    expect(rpc.subscribe).toHaveBeenLastCalledWith({ body: b.sub.toJSON() }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it('reports mismatched registration, missing channel and global pause instead of claiming delivery', async () => {
    const b = browser('activated'); permission('granted'); b.getSubscription.mockResolvedValue(b.sub);
    for (const state of [
      { ...serverState, registered: false }, { ...serverState, channel: null },
      { ...serverState, channel: { enabled: false, events: ['execution.finished'] } },
    ]) {
      rpc.status.mockResolvedValue(state);
      expect(await isWebPushSubscribed()).toBe(false);
    }
  });
  it('does not silently opt in after permission revocation, even if browser and server keep their records', async () => {
    const b = browser('activated'); permission('denied'); b.getSubscription.mockResolvedValue(b.sub);
    rpc.status.mockResolvedValue(serverState);
    expect(await getBrowserPushStatus()).toMatchObject({ permission: 'denied', localSubscription: true, registered: true });
    expect(await isWebPushSubscribed()).toBe(false);
    await expect(subscribeToWebPush()).rejects.toThrow('browser settings');
    expect(b.requestPermission).not.toHaveBeenCalled(); expect(b.subscribe).not.toHaveBeenCalled();
    b.getSubscription.mockRejectedValue(new DOMException('Revoked', 'NotAllowedError'));
    expect(await getBrowserPushStatus()).toMatchObject({ permission: 'denied', localSubscription: false });
  });
  it('treats dismissed permission as failure and unsupported browsers as unavailable without API calls', async () => {
    const b = browser('activated'); b.requestPermission.mockResolvedValue('default');
    await expect(subscribeToWebPush()).rejects.toThrow('not granted');
    expect(b.register).not.toHaveBeenCalled();
    Object.assign(window, { riDesktop: {} });
    expect(await getBrowserPushStatus()).toMatchObject({ supported: false, permission: 'unavailable' });
    for (const fn of [rpc.subscribe, rpc.status, rpc.unsubscribe]) expect(fn).not.toHaveBeenCalled();
  });
  it('reports incomplete browser records with a usable removal action instead of an endless repair instruction', async () => {
    const b = browser('activated'); permission('granted');
    b.sub.toJSON = () => ({ endpoint: b.sub.endpoint, keys: {} as { p256dh: string; auth: string } });
    b.getSubscription.mockResolvedValue(b.sub);
    rpc.status.mockResolvedValue({ registered: false, channel: null });
    expect(await getBrowserPushStatus()).toMatchObject({ localSubscription: true, registered: false });
    await expect(subscribeToWebPush()).rejects.toThrow('Turn it off here');
    expect(rpc.status).toHaveBeenCalledOnce();
  });
  it('detects expired subscriptions and only replaces them on explicit repair', async () => {
    const b = browser('activated'); permission('granted'); b.sub.expirationTime = Date.now() - 1;
    b.getSubscription.mockResolvedValue(b.sub); rpc.status.mockResolvedValue(serverState);
    expect(await getBrowserPushStatus()).toMatchObject({ expired: true });
    expect(b.sub.unsubscribe).not.toHaveBeenCalled();
    await subscribeToWebPush(); expect(b.sub.unsubscribe).toHaveBeenCalledOnce(); expect(b.subscribe).toHaveBeenCalledOnce();
  });
});

describe('browser unsubscribe retries', () => {
  it('keeps the local handle available when server deletion fails', async () => {
    const b = browser('activated'); b.getSubscription.mockResolvedValue(b.sub);
    rpc.unsubscribe.mockRejectedValueOnce(new Error('Offline'));
    await expect(unsubscribeFromWebPush()).rejects.toThrow('Reconnect and retry');
    expect(b.sub.unsubscribe).not.toHaveBeenCalled();
    await unsubscribeFromWebPush();
    expect(b.sub.unsubscribe).toHaveBeenCalledOnce();
    expect(rpc.unsubscribe).toHaveBeenLastCalledWith({ body: { endpoint: b.sub.endpoint } }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it.each(['false', 'rejected'])('reports browser removal %s, and safely retries the already-deleted server record', async failure => {
    const b = browser('activated'); b.getSubscription.mockResolvedValue(b.sub);
    if (failure === 'false') b.sub.unsubscribe.mockResolvedValueOnce(false);
    else b.sub.unsubscribe.mockRejectedValueOnce(new Error('Storage denied'));
    await expect(unsubscribeFromWebPush()).rejects.toThrow('Ri has stopped sending here');
    await unsubscribeFromWebPush();
    expect(rpc.unsubscribe).toHaveBeenCalledTimes(2); expect(b.sub.unsubscribe).toHaveBeenCalledTimes(2);
  });
  it('does not delete any server subscription when this browser has none', async () => {
    browser('activated'); await unsubscribeFromWebPush(); for (const fn of [rpc.subscribe, rpc.status, rpc.unsubscribe]) expect(fn).not.toHaveBeenCalled();
  });
});
