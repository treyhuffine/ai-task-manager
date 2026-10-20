import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { McpViewStore, MAX_VIEWS, MAX_CALLS, MAX_DELIVERED_RESULT, type Capture, type ViewCall } from './store';
const capture = (created = 0): Capture => ({id: randomUUID(), serverId: 's', connectionId: 'c', sourceRef: 'r', tool: 't', input: {}, result: {content: []}, resourceUri: 'ui://a/index.html', legacy: false, title: 'test', created});
it('bounds captures and view sessions by count, dropping the least recently used, and isolates viewers', () => {
  const store = new McpViewStore();
  const first = capture(); store.put(first); const firstView = store.open(first, 'viewer');
  const second = capture(); store.put(second); store.open(second, 'viewer');
  for (let i=0;i<MAX_VIEWS-2;i++) {const c = capture(); store.put(c); store.open(c, 'viewer');}
  // Used again, the first stays when one more arrives, and the second, now oldest, goes.
  expect(store.kept(first.id)).toBe(first); expect(store.get(firstView.id, 'viewer')).toBe(firstView);
  const last = capture(); store.put(last); store.open(last, 'viewer');
  expect(store.captures.size).toBe(MAX_VIEWS); expect(store.views.size).toBe(MAX_VIEWS);
  expect(store.captures.has(first.id)).toBe(true); expect(store.captures.has(second.id)).toBe(false);
  expect(() => store.get(firstView.id, 'other')).toThrow('closed');
  // No clock: a view open a day later is still open.
  expect(store.get(firstView.id, 'viewer')).toBe(firstView);
});
it('keeps only what is in memory: a capture that left it is gone from here', () => {
  const store = new McpViewStore(), kept = capture();
  store.put(kept);
  expect(store.kept(kept.id)).toBe(kept);
  expect(store.kept(randomUUID())).toBeUndefined();
});
it('keeps failure receipts, rejects oversized results without replay, and keeps working past MAX_CALLS', async () => {
  const store = new McpViewStore(), view = store.open(capture(), 'viewer'); let calls = 0;
  const execute = async (): Promise<ViewCall> => {calls++; return {kind: 'result', result: {content: [{type: 'text', text: 'x'.repeat(MAX_DELIVERED_RESULT)}]}};};
  await expect(store.call(view, 'id', 'fp', execute)).rejects.toThrow('too large');
  await expect(store.call(view, 'id', 'fp', execute)).rejects.toThrow('too large'); expect(calls).toBe(1);
  for (let i=0;i<MAX_CALLS;i++) await store.call(view, String(i), 'f', async () => ({kind: 'result', result: {content: [{type: 'text', text: 'ok'}]}}));
  // The oldest receipts went, so the view still runs operations, and what they kept no longer counts.
  expect(view.calls.size).toBe(MAX_CALLS); expect(view.calls.has('id')).toBe(false);
  await expect(store.call(view, 'new', 'f', async () => ({kind: 'result', result: {content: []}}))).resolves.toMatchObject({kind: 'result'});
  const kept = [...view.calls.values()].reduce((sum, receipt) => sum + (receipt.kept ?? 0), 0);
  expect(view.bytes).toBe(Buffer.byteLength(JSON.stringify(view.capture.result)) + kept);
});
it('delivers a large result once and refuses its duplicate instead of keeping or rerunning it', async () => {
  const store = new McpViewStore(), view = store.open(capture(), 'viewer'); let calls = 0;
  // About the size of the display model Bits & Bolts sends for a detailed part.
  const part = async (): Promise<ViewCall> => {calls++; return {kind: 'result', result: {content: [], structuredContent: {data: 'x'.repeat(6 * 1024 * 1024)}}};};
  const first = await store.call(view, 'read', 'fp', part);
  expect(first.kind === 'result' && (first.result.structuredContent as {data: string}).data.length).toBe(6 * 1024 * 1024);
  expect(view.bytes).toBe(Buffer.byteLength(JSON.stringify(view.capture.result)));
  await Promise.resolve();
  await expect(store.call(view, 'read', 'fp', part)).rejects.toThrow('delivered once');
  expect(calls).toBe(1);
  const small = async (): Promise<ViewCall> => {calls++; return {kind: 'result', result: {content: [{type: 'text', text: 'ok'}]}};};
  await store.call(view, 'small', 'fp', small);
  await expect(store.call(view, 'small', 'fp', small)).resolves.toMatchObject({kind: 'result'});
  expect(calls).toBe(2);
});
it('keeps approval fingerprints and coalesces concurrent retries', async () => {
  const store = new McpViewStore(), view = store.open(capture(), 'viewer'); let calls = 0;
  const run = async (): Promise<ViewCall> => {calls++; return {kind: 'approval', ids: ['id'], preview: {}};};
  await Promise.all([store.call(view,'id','f',run),store.call(view,'id','f',run)]); expect(calls).toBe(1);
  await expect(store.call(view,'id','different',run)).rejects.toThrow('different operation');
  await store.call(view,'id','f',run); expect(calls).toBe(2);
});

it('keeps cancellation tombstones, rolling the oldest, and prevents delayed delivery or an approval retry', async () => {
  const store = new McpViewStore(), view = store.open(capture(), 'viewer'); let calls = 0;
  const run = async (): Promise<ViewCall> => {calls++; return {kind: 'approval', ids: ['pending'], preview: {}};};
  store.cancel(view, 'before');
  await expect(store.call(view, 'before', 'f', run)).rejects.toThrow('cancelled');
  await store.call(view, 'pending', 'f', run);
  store.cancel(view, 'pending');
  await expect(store.call(view, 'pending', 'f', run)).rejects.toThrow('cancelled');
  expect(calls).toBe(1);
  for (let i=0;i<MAX_CALLS;i++) store.cancel(view, `cancel-${i}`);
  expect(view.calls.size).toBe(MAX_CALLS);
  expect(store.isCancelled(view, `cancel-${MAX_CALLS - 1}`)).toBe(true);
});
