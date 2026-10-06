import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopActivity } from './activity';
import {
  desktopActivityPath, readDesktopActivity, type DesktopActivityData,
} from '../src/lib/sessions/desktop-activity-contract';

const controllers: DesktopActivity[] = [];
afterEach(() => { controllers.splice(0).forEach(controller => controller.stop()); vi.useRealTimers(); });
const data = (): DesktopActivityData => ({ running: 2, needsInput: 1, unread: 1, attention: 2,
  targets: [{ sessionId: 'chat-1', label: 'Review task', state: 'needsInput' }] });
function fixture() {
  const request = vi.fn<(_: AbortSignal) => Promise<unknown>>().mockResolvedValue(data());
  const onChange = vi.fn();
  const controller = new DesktopActivity({ request, onChange, intervalMs: 100, requestTimeoutMs: 50 });
  controllers.push(controller);
  return { controller, request, onChange };
}

describe('main-process desktop activity', () => {
  it('starts once and polls without a renderer, with no overlapping requests', async () => {
    vi.useFakeTimers(); const f = fixture();
    let resolve!: (value: unknown) => void;
    f.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    f.controller.start(); f.controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = f.controller.refresh();
    expect(f.controller.refresh()).toBe(first);
    expect(f.request).toHaveBeenCalledTimes(1);
    resolve(data()); await first;
    expect(f.controller.snapshot()).toMatchObject({ connection: 'connected', activity: data() });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.request).toHaveBeenCalledTimes(2);
  });

  it('removes stale counts and destinations on disconnect and recovers on a healthy response', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.controller.refresh();
    const updatedAt = f.controller.snapshot().updatedAt;
    f.request.mockRejectedValueOnce(new Error('socket unavailable'));
    await f.controller.refresh();
    expect(f.controller.snapshot()).toEqual({ connection: 'disconnected', updatedAt });
    await vi.advanceTimersByTimeAsync(10); await f.controller.refresh();
    expect(f.controller.snapshot()).toEqual({ connection: 'connected', activity: data(), updatedAt: updatedAt! + 10 });
  });

  it('bounds a hung request, aborts it and ignores its late stale response', async () => {
    vi.useFakeTimers(); const f = fixture();
    let resolve!: (value: unknown) => void;
    f.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    f.controller.start(); await vi.advanceTimersByTimeAsync(0);
    const signal = f.request.mock.calls[0][0];
    await vi.advanceTimersByTimeAsync(50);
    expect(signal.aborted).toBe(true);
    expect(f.controller.snapshot()).toEqual({ connection: 'disconnected' });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.controller.snapshot()).toMatchObject({ connection: 'connected', activity: data() });
    const stale = data(); stale.running = 900;
    resolve(stale); await Promise.resolve();
    expect(f.controller.snapshot().activity?.running).toBe(2);
  });

  it('stops pending requests, clears timers and never accepts a post-stop result', async () => {
    vi.useFakeTimers(); const f = fixture();
    let resolve!: (value: unknown) => void;
    f.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    f.controller.start(); await vi.advanceTimersByTimeAsync(0);
    const pending = f.controller.refresh(); const signal = f.request.mock.calls[0][0];
    f.controller.stop(); f.controller.stop(); await pending;
    expect(signal.aborted).toBe(true);
    resolve(data()); await Promise.resolve();
    f.controller.start(); await f.controller.refresh(); await vi.advanceTimersByTimeAsync(10_000);
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.controller.snapshot()).toEqual({ connection: 'disconnected' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears counts and targets when stopped after a successful request', async () => {
    const f = fixture(); await f.controller.refresh();
    const updatedAt = f.controller.snapshot().updatedAt;
    f.controller.stop();
    expect(f.onChange).toHaveBeenLastCalledWith({ connection: 'disconnected', updatedAt });
  });

  it('never shares mutable state with native menu consumers', async () => {
    const f = fixture(); await f.controller.refresh();
    f.controller.snapshot().activity!.targets[0].sessionId = 'other';
    f.onChange.mock.calls[0][0].activity.targets[0].label = 'changed';
    expect(f.controller.snapshot().activity?.targets).toEqual(data().targets);
  });

  it('treats malformed responses as unavailable instead of idle or navigable', async () => {
    const f = fixture(); await f.controller.refresh();
    f.request.mockResolvedValueOnce({ ...data(), targets: [{ sessionId: 'https://evil.example', label: 'Open', state: 'needsInput' }] });
    await f.controller.refresh();
    expect(f.controller.snapshot()).toMatchObject({ connection: 'disconnected' });
    expect(f.controller.snapshot().activity).toBeUndefined();
  });
});

describe('native activity wire contract', () => {
  it.each([
    null, [], { ...data(), running: -1 }, { ...data(), unread: 0.5 },
    { ...data(), running: 1_000_001 }, { ...data(), attention: 99 },
    { ...data(), targets: Array.from({ length: 6 }, (_, i) => ({ sessionId: `s${i}`, label: 'x', state: 'running' })) },
    { ...data(), targets: [data().targets[0], data().targets[0]] },
    { ...data(), needsInput: 0, attention: 1 },
    { ...data(), targets: [{ sessionId: 's1', label: 'x'.repeat(101), state: 'running' }] },
    { ...data(), targets: [{ sessionId: 's1', label: 'x', state: 'shell' }] },
  ])('rejects malformed snapshot %#', value => expect(() => readDesktopActivity(value)).toThrow());

  it('allowlists fields and sanitizes control and direction overrides in menu labels', () => {
    const raw = { ...data(), secret: 'do not retain', targets: [{ sessionId: 's1', label: '\u202eReview\n\u0000task', state: 'needsInput', path: '/api/service/update' }] };
    expect(readDesktopActivity(raw)).toEqual({ ...data(), targets: [{ sessionId: 's1', label: 'Review  task', state: 'needsInput' }] });
  });

  it('only creates fixed session navigation, with no supplied native operation or origin', () => {
    expect(desktopActivityPath('019a0000-cafe-7000-a123-123456789012')).toBe('/?session=019a0000-cafe-7000-a123-123456789012');
    for (const id of ['', 'https://evil.example', '/api/service/update', 's1&settings=integrations', '../secret', 's1#pairing', 's1\n']) expect(desktopActivityPath(id)).toBe('/');
  });
});
