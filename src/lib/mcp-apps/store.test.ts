import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { McpViewStore, VIEW_TTL, MAX_VIEWS, MAX_CALLS, MAX_DELIVERED_RESULT, type Capture, type ViewCall } from './store';
const capture = (created = 0): Capture => ({id: randomUUID(), serverId: 's', connectionId: 'c', sourceRef: 'r', authority: 'a', tool: 't', input: {}, result: {content: []}, resourceUri: 'ui://a/index.html', legacy: false, title: 'test', created});
it('bounds captures and view sessions, isolates viewers and expires without replay', () => {
  let now = 0; const store = new McpViewStore(() => now);
  for (let i=0;i<MAX_VIEWS+1;i++) {const c = capture(); store.put(c); store.open(c, 'viewer');}
  expect(store.captures.size).toBe(MAX_VIEWS); expect(store.views.size).toBe(MAX_VIEWS);
  const view = [...store.views.values()][0];
  expect(() => store.get(view.id, 'other')).toThrow();
  now = VIEW_TTL; expect(() => store.get(view.id, 'viewer')).toThrow();
  expect(store.captures.size).toBe(0);
});
it('bounds calls, keeps failure receipts and rejects oversized results without replay', async () => {
  const store = new McpViewStore(() => 0), view = store.open(capture(), 'viewer'); let calls = 0;
  const execute = async (): Promise<ViewCall> => {calls++; return {kind: 'result', result: {content: [{type: 'text', text: 'x'.repeat(MAX_DELIVERED_RESULT)}]}};};
  await expect(store.call(view, 'id', 'fp', execute)).rejects.toThrow('too large');
  await expect(store.call(view, 'id', 'fp', execute)).rejects.toThrow('too large'); expect(calls).toBe(1);
  for (let i=0;i<MAX_CALLS-1;i++) await store.call(view, String(i), 'f', async () => ({kind: 'result', result: {content: []}}));
  await expect(store.call(view, 'new', 'f', execute)).rejects.toThrow('operation limit');
});
it('delivers a large result once and refuses its duplicate instead of keeping or rerunning it', async () => {
  const store = new McpViewStore(() => 0), view = store.open(capture(), 'viewer'); let calls = 0;
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
  const store = new McpViewStore(() => 0), view = store.open(capture(), 'viewer'); let calls = 0;
  const run = async (): Promise<ViewCall> => {calls++; return {kind: 'approval', ids: ['id'], preview: {}};};
  await Promise.all([store.call(view,'id','f',run),store.call(view,'id','f',run)]); expect(calls).toBe(1);
  await expect(store.call(view,'id','different',run)).rejects.toThrow('different operation');
  await store.call(view,'id','f',run); expect(calls).toBe(2);
});

it('bounds cancellation tombstones and prevents delayed delivery or an approval retry', async () => {
  const store = new McpViewStore(() => 0), view = store.open(capture(), 'viewer'); let calls = 0;
  const run = async (): Promise<ViewCall> => {calls++; return {kind: 'approval', ids: ['pending'], preview: {}};};
  store.cancel(view, 'before');
  await expect(store.call(view, 'before', 'f', run)).rejects.toThrow('cancelled');
  await store.call(view, 'pending', 'f', run);
  store.cancel(view, 'pending');
  await expect(store.call(view, 'pending', 'f', run)).rejects.toThrow('cancelled');
  expect(calls).toBe(1);
  for (let i=0;i<MAX_CALLS-2;i++) store.cancel(view, `cancel-${i}`);
  expect(() => store.cancel(view, 'extra')).toThrow('operation limit');
  expect(view.calls.size).toBe(MAX_CALLS);
});
