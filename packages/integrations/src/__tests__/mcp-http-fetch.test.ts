import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpHttpFetch } from '../mcp/http-fetch';
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
});
