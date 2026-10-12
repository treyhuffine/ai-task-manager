import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectMcpClient, type ConnectedMcpClient } from '../mcp/client';
import { MCP_TOOL_TIMEOUT_MS, MCP_TOOL_TOTAL_TIMEOUT_MS } from '../mcp/timeouts';

interface Pending {
  id: number;
  signal: AbortSignal;
  progress: (value: number) => void;
  finish: () => void;
}
let client: ConnectedMcpClient;
let streaming: boolean;
const pending: Pending[] = [];
const cancellations: number[] = [];
const encoder = new TextEncoder();

// Real MCP SDK and HTTP transport, with a controllable provider at the fetch boundary.
beforeEach(async () => {
  pending.length = 0;
  cancellations.length = 0;
  streaming = false;
  vi.stubGlobal('fetch', vi.fn(async (_input, init: RequestInit) => {
    if (init?.method === 'GET') return new Response(null, { status: 405 });
    const message = JSON.parse(init.body as string);
    if (message.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'slow-provider', version: '1' },
    } });
    if (message.method === 'notifications/cancelled') cancellations.push(message.params.requestId);
    if (message.method !== 'tools/call') return new Response(null, { status: 202 });
    const signal = init.signal!;
    const result = { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'complete' }] } };
    if (streaming) {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
      const send = (value: unknown) => controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(value)}\n\n`));
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      pending.push({ id: message.id, signal,
        progress: value => send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: message.params._meta?.progressToken, progress: value } }),
        finish: () => { send(result); controller.close(); },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    }
    return new Promise<Response>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      pending.push({ id: message.id, signal, progress: () => {}, finish: () => resolve(Response.json(result)) });
    });
  }));
  client = await connectMcpClient({ url: 'https://slow.example/mcp' });
  vi.useFakeTimers();
});
afterEach(async () => { await client?.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('real MCP request deadlines', () => {
  it('accepts a silent response after the former two-minute timeout', async () => {
    let settled = false;
    const result = client.callTool({ name: 'research' }).finally(() => { settled = true; });
    await flush();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(settled).toBe(false);
    pending[0]!.finish();
    expect(await result).toMatchObject({ isError: false, content: [{ text: 'complete' }] });
    expect(cancellations).toEqual([]);
  });

  it('requests progress and resets inactivity beyond ten minutes', async () => {
    streaming = true;
    let settled = false;
    const result = client.callTool({ name: 'research' }).finally(() => { settled = true; });
    await flush();
    for (let i = 1; i <= 2; i++) {
      await vi.advanceTimersByTimeAsync(9 * 60_000);
      pending[0]!.progress(i);
      await flush();
    }
    expect(settled).toBe(false);
    pending[0]!.finish();
    expect(await result).toMatchObject({ isError: false });
  });

  it('enforces thirty minutes even with continuing progress', async () => {
    streaming = true;
    const result = client.callTool({ name: 'research' }).catch(error => error);
    await flush();
    for (let i = 1; i <= 3; i++) {
      await vi.advanceTimersByTimeAsync(9 * 60_000);
      pending[0]!.progress(i);
      await flush();
    }
    await vi.advanceTimersByTimeAsync(MCP_TOOL_TOTAL_TIMEOUT_MS - 27 * 60_000);
    expect(await result).toMatchObject({ code: 'provider_timeout', message: expect.stringContaining('30-minute total') });
    expect(pending[0]!.signal.aborted).toBe(true);
    expect(cancellations).toEqual([pending[0]!.id]);
  });

  it('propagates caller cancellation to one sent request without treating it as a provider timeout', async () => {
    const controller = new AbortController();
    const result = client.callTool({ name: 'research' }, { signal: controller.signal }).catch(error => error);
    await flush();
    controller.abort();
    await flush();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(pending[0]!.signal.aborted).toBe(true);
    const next = client.callTool({ name: 'research' });
    await flush();
    pending[1]!.finish();
    expect(await next).toMatchObject({ isError: false });
  });

  it('cancels only the expired HTTP request and leaves siblings and future calls usable', async () => {
    const expired = client.callTool({ name: 'research' }).catch(error => error);
    await flush();
    await vi.advanceTimersByTimeAsync(MCP_TOOL_TIMEOUT_MS - 60_000);
    const sibling = client.callTool({ name: 'research' });
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await expired).toMatchObject({ code: 'provider_timeout', message: expect.stringContaining('10-minute inactivity') });
    expect(pending[0]!.signal.aborted).toBe(true);
    expect(pending[1]!.signal.aborted).toBe(false);
    pending[1]!.finish();
    expect(await sibling).toMatchObject({ isError: false });
    const next = client.callTool({ name: 'research' });
    await flush();
    pending[2]!.finish();
    expect(await next).toMatchObject({ isError: false });
    expect(cancellations).toEqual([pending[0]!.id]);
  });
});
