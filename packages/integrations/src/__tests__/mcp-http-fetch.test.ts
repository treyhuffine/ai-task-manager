import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCP_HTTP_MAX_MESSAGE_BYTES, McpMessageTooLargeError, mcpHttpFetch, messageMeter } from '../mcp/http-fetch';
import { MCP_STDIO_MAX_BUFFER_BYTES } from '../mcp/client';
import { MCP_HTTP_TIMEOUT_MS, MCP_TOOL_TOTAL_TIMEOUT_MS } from '../mcp/timeouts';

const agents = vi.hoisted(() => ({ create: vi.fn(), close: vi.fn(async () => {}) }));
vi.mock('undici', () => ({ Agent: class { constructor(options: unknown) { agents.create(options); } close = agents.close; } }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('scoped MCP HTTP fetch', () => {
  it('gives headers and response bodies enough time without changing global fetch or its dispatcher', async () => {
    const signals: AbortSignal[] = [];
    const nativeFetch = vi.fn(async (_input, init: RequestInit) => {
      signals.push(init.signal!);
      expect(init).toHaveProperty('dispatcher');
      return Response.json({ result: 'complete' });
    });
    vi.stubGlobal('fetch', nativeFetch);
    const http = await mcpHttpFetch();
    expect(agents.create).toHaveBeenCalledWith({ headersTimeout: MCP_HTTP_TIMEOUT_MS, bodyTimeout: MCP_HTTP_TIMEOUT_MS });
    expect(MCP_HTTP_TIMEOUT_MS).toBeGreaterThan(MCP_TOOL_TOTAL_TIMEOUT_MS);
    expect(globalThis.fetch).toBe(nativeFetch);
    const response = await http.fetch('https://provider.example/mcp', { method: 'POST', body: JSON.stringify({ method: 'tools/call', id: 1 }) });
    expect(await response.json()).toEqual({ result: 'complete' });
    await http.fetch('https://provider.example/mcp', { method: 'POST', body: JSON.stringify({ method: 'notifications/cancelled', params: { requestId: 1 } }) });
    expect(signals[0]!.aborted).toBe(false); // Completed responses no longer occupy the cancellation map.
    await http.close();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(agents.close).toHaveBeenCalledOnce();
  });

  it('stops reading a response whose one message passes the cap, and cancels its request', async () => {
    let cancelled = false;
    // A server that never stops writing one response.
    const nativeFetch = vi.fn(async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(40))); },
      cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', nativeFetch);
    const http = await mcpHttpFetch({ maxMessageBytes: 64 });
    const response = await http.fetch('https://provider.example/mcp', { method: 'POST', body: JSON.stringify({ method: 'tools/call', id: 7 }) });
    await expect(response.text()).rejects.toBeInstanceOf(McpMessageTooLargeError);
    expect(cancelled).toBe(true);
    await http.close();
  });

  it('caps each event of a stream, not the stream, including one with no request of its own', async () => {
    const events = (sizes: number[], ending = '\n\n') => sizes.map(size => `data: ${'y'.repeat(size)}${ending}`).join('');
    const stream = (text: string) => new Response(new ReadableStream({
      start(controller) { for (let at = 0; at < text.length; at += 17) controller.enqueue(new TextEncoder().encode(text.slice(at, at + 17))); controller.close(); },
    }), { headers: { 'content-type': 'text/event-stream' } });
    const many = events(Array.from({ length: 40 }, () => 30));
    vi.stubGlobal('fetch', vi.fn(async () => stream(many)));
    const http = await mcpHttpFetch({ maxMessageBytes: 64 });
    // A standalone GET stream: no JSON-RPC request, so no operation of its own.
    expect(await (await http.fetch('https://provider.example/mcp', { method: 'GET' })).text()).toBe(many);
    vi.stubGlobal('fetch', vi.fn(async () => stream(events([30, 200]))));
    await expect((await http.fetch('https://provider.example/mcp', { method: 'GET' })).text()).rejects.toBeInstanceOf(McpMessageTooLargeError);
    // CRLF and CR line endings end events too.
    const crlf = events(Array.from({ length: 40 }, () => 30), '\r\n\r\n'), cr = events(Array.from({ length: 40 }, () => 30), '\r\r');
    vi.stubGlobal('fetch', vi.fn(async () => stream(crlf)));
    expect(await (await http.fetch('https://provider.example/mcp', { method: 'GET' })).text()).toBe(crlf);
    vi.stubGlobal('fetch', vi.fn(async () => stream(cr)));
    expect(await (await http.fetch('https://provider.example/mcp', { method: 'GET' })).text()).toBe(cr);
    await http.close();
  });

  it('meters a body whole and an event stream per event, matching the stdio budget', () => {
    expect(MCP_HTTP_MAX_MESSAGE_BYTES).toBe(MCP_STDIO_MAX_BUFFER_BYTES);
    const body = messageMeter(false);
    expect([body(new Uint8Array(10)), body(new Uint8Array(10))]).toEqual([10, 20]);
    const events = messageMeter(true);
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(events(bytes('data: a\n'))).toBe(8);
    // The blank line ends the event: what follows starts again from nothing.
    expect(events(bytes('\ndata: b'))).toBe(9);
    expect(events(bytes('cd\n\n'))).toBe(11);
    expect(events(bytes('e'))).toBe(1);
  });
});

