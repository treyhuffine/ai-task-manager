import { expect, it } from 'vitest';
import { registerConnectedContext, selectConnectedContext, flushConnectedContext } from './mcp-app-context';

it('attaches only the selected acknowledged view in the exact receiving chat', async () => {
  const a=registerConnectedContext('chat-a','view-a',async()=>({viewId:'view-a',revision:2}));
  const b=registerConnectedContext('chat-a','view-b',async()=>({viewId:'view-b',revision:3}));
  expect(await flushConnectedContext('chat-a')).toEqual([]);
  selectConnectedContext('chat-a','view-a'); expect(await flushConnectedContext('chat-a')).toEqual([{viewId:'view-a',revision:2}]);
  expect(await flushConnectedContext('chat-b')).toEqual([]);
  selectConnectedContext('chat-a','view-b'); expect(await flushConnectedContext('chat-a')).toEqual([{viewId:'view-b',revision:3}]);
  b(); expect(await flushConnectedContext('chat-a')).toEqual([]); a();
});
it('waits for context acknowledgement and propagates a failure to the send flow', async () => {
  let acknowledge!: () => void;
  const waiting = new Promise<void>(resolve=>{acknowledge=resolve;});
  const cleanup=registerConnectedContext('chat-c','view-c',async()=>{await waiting;return {viewId:'view-c',revision:4};});
  selectConnectedContext('chat-c','view-c');let finished=false;
  const flush=flushConnectedContext('chat-c').then(value=>{finished=true;return value;});
  await Promise.resolve(); expect(finished).toBe(false); acknowledge(); expect(await flush).toEqual([{viewId:'view-c',revision:4}]); cleanup();
  const failed=registerConnectedContext('chat-c','view-c',async()=>{throw new Error('Access changed');});
  selectConnectedContext('chat-c','view-c'); await expect(flushConnectedContext('chat-c')).rejects.toThrow('Access changed');failed();
});
