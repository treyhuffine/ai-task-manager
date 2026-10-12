import { MCP_HTTP_TIMEOUT_MS } from './timeouts';

/** Per-client HTTP budgets and per-request cancellation, without changing global fetch. */
export async function mcpHttpFetch() {
  const { Agent } = await import('undici');
  const dispatcher = new Agent({ headersTimeout: MCP_HTTP_TIMEOUT_MS, bodyTimeout: MCP_HTTP_TIMEOUT_MS });
  const lifetime = new AbortController();
  const requests = new Map<string | number, AbortController>();

  const scopedFetch: typeof fetch = async (input, init) => {
    let id: string | number | undefined;
    let operation: AbortController | undefined;
    if (typeof init?.body === 'string') {
      try {
        const message = JSON.parse(init.body);
        if (message.method === 'notifications/cancelled') {
          requests.get(message.params?.requestId)?.abort();
        } else if (typeof message.method === 'string' && (typeof message.id === 'string' || typeof message.id === 'number')) {
          id = message.id;
          operation = new AbortController();
          requests.set(id!, operation);
        }
      } catch { /* OAuth and non-RPC bodies keep the client's ordinary lifetime signal. */ }
    }
    const release = () => {
      if (id !== undefined && requests.get(id) === operation) requests.delete(id);
    };
    const request: RequestInit = {
      ...init,
      signal: AbortSignal.any([lifetime.signal, ...(init?.signal ? [init.signal] : []), ...(operation ? [operation.signal] : [])]),
    };
    // Node's ambient fetch types may describe an older Undici dispatcher version.
    // The runtime accepts this per-request dispatcher without changing global fetch.
    Object.assign(request, { dispatcher });
    try {
      const response = await fetch(input, request);
      if (!operation || !response.body) { release(); return response; }
      // Keep the request cancellable after headers arrive, including an SSE body.
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { release(); reader.releaseLock(); controller.close(); }
            else controller.enqueue(chunk.value);
          } catch (error) { release(); reader.releaseLock(); controller.error(error); }
        },
        async cancel(reason) { release(); operation!.abort(); try { await reader.cancel(reason); } finally { reader.releaseLock(); } },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { release(); throw error; }
  };
  return {
    fetch: scopedFetch,
    async close() { lifetime.abort(); requests.clear(); await dispatcher.close(); },
  };
}
