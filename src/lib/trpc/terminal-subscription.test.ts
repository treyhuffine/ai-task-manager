import { afterEach, expect, it, vi } from 'vitest';
const producer = vi.hoisted(() => ({ feed: vi.fn() }));
vi.mock('@/lib/realtime/terminal-feed', () => ({ runTerminalFeed: producer.feed, isTerminalBase: (base: string) => /^\/(sessions|workspaces)\/[\w-]+$/.test(base) }));
import { terminalFrames, terminalSubscriptionInput } from './terminal-subscription';
afterEach(() => producer.feed.mockReset());

it('resumes from the tracked cursor, yields typed frames and cancels the feed', async () => {
  let stopped = false;
  producer.feed.mockImplementation(async (_base, _id, after, emit, signal: AbortSignal) => {
    expect(after).toBe(10);
    emit('ready', { id: 't', resumed: true });
    emit('data', 'abc', '13');
    await new Promise<void>(resolve => signal.addEventListener('abort', () => { stopped = true; resolve(); }, { once: true }));
  });
  const aborter = new AbortController();
  const stream = terminalFrames({ base: '/sessions/chat', terminalId: 't', after: 5, lastEventId: '10' }, aborter.signal);
  expect((await stream.next()).value?.[1]).toMatchObject({ event: 'ready', data: { resumed: true } });
  const output = (await stream.next()).value!;
  expect(output[0]).toBe('13');
  expect(output[1]).toEqual({ event: 'data', data: 'abc', id: '13' });
  aborter.abort();
  await stream.return();
  expect(stopped).toBe(true);
});

it('starts with a fresh snapshot when replay has a gap', async () => {
  producer.feed.mockImplementation(async (_base, _id, _after, emit) => {
    emit('ready', { id: 't', resumed: false });
    emit('data', 'snapshot', '100');
    emit('exit', { code: 0, signal: null });
  });
  const values = [];
  for await (const value of terminalFrames({ base: '/workspaces/agent', terminalId: 't', after: 5 })) values.push(value);
  expect(values.map(value => value[0])).toEqual(['fresh', '100', '100']);
  expect(values.map(value => value[1].event)).toEqual(['ready', 'data', 'exit']);
});

it.each(['x', '界'])('bounds queued UTF-8 output for slow consumers (%s)', async (character) => {
  let stopped = false;
  producer.feed.mockImplementation(async (_base, _id, _after, emit, signal: AbortSignal) => {
    for (let i = 0; i < (character === 'x' ? 2 : 1); i++) emit('data', character.repeat(300_000), String((i + 1) * 300_000));
    stopped = signal.aborted;
  });
  const stream = terminalFrames({ base: '/sessions/chat', terminalId: 't', after: null });
  await expect(stream.next()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  expect(stopped).toBe(true);
});

it('rejects traversal and invalid replay cursors', () => {
  expect(terminalSubscriptionInput.safeParse({ base: '/sessions/../../private', terminalId: 't', after: null }).success).toBe(false);
  expect(terminalSubscriptionInput.safeParse({ base: '/sessions/chat', terminalId: 't', after: -1 }).success).toBe(false);
});
