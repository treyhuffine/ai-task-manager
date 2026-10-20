import { MCP_HTTP_TIMEOUT_MS } from './timeouts';

/**
 * The most one MCP message over HTTP may hold: a JSON response's whole body,
 * or one event of an SSE stream (a long-lived stream is never cut off by its
 * total). The same budget a local server's stdio transport has per message
 * (`MCP_STDIO_MAX_BUFFER_BYTES`), well above the largest result Ri delivers to
 * an app view (24 MiB) with room for base64 and the JSON-RPC envelope.
 */
export const MCP_HTTP_MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

/** A server's message that passed `MCP_HTTP_MAX_MESSAGE_BYTES`. Ri stops reading the response. */
export class McpMessageTooLargeError extends Error {
  constructor(max: number) {
    super(`The MCP server sent a message larger than ${max / 1024 / 1024} MiB, so Ri stopped reading it.`);
    this.name = 'McpMessageTooLargeError';
  }
}

/**
 * Bytes in the message under way: the whole body, or for an event stream the
 * bytes since the last event ended. An SSE event ends at a blank line, and a
 * line ends at LF, CR or CRLF.
 */
export function messageMeter(eventStream: boolean) {
  let size = 0, lineLength = 0, afterCr = false;
  return (chunk: Uint8Array) => {
    if (!eventStream) { size += chunk.byteLength; return size; }
    let peak = size;
    for (const byte of chunk) {
      size++;
      peak = Math.max(peak, size);
      // The LF of a CRLF ends the same line its CR did.
      if (byte === 0x0a && afterCr) { afterCr = false; continue; }
      afterCr = byte === 0x0d;
      if (byte === 0x0a || byte === 0x0d) {
        if (lineLength === 0) size = 0;
        lineLength = 0;
      } else lineLength++;
    }
    return peak;
  };
}

/** Per-client HTTP budgets and per-request cancellation, without changing global fetch. */
export async function mcpHttpFetch(options: { maxMessageBytes?: number } = {}) {
  const maxMessageBytes = options.maxMessageBytes ?? MCP_HTTP_MAX_MESSAGE_BYTES;
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
      if (!response.body) { release(); return response; }
      // Keep the request cancellable after headers arrive, including an SSE body, and count
      // what each message holds so no server can make Ri buffer without bound.
      const reader = response.body.getReader();
      const measure = messageMeter((response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream'));
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { release(); reader.releaseLock(); controller.close(); return; }
            if (measure(chunk.value) > maxMessageBytes) {
              release(); operation?.abort();
              await reader.cancel().catch(() => {});
              reader.releaseLock();
              controller.error(new McpMessageTooLargeError(maxMessageBytes));
              return;
            }
            controller.enqueue(chunk.value);
          } catch (error) { release(); reader.releaseLock(); controller.error(error); }
        },
        async cancel(reason) { release(); operation?.abort(); try { await reader.cancel(reason); } finally { reader.releaseLock(); } },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { release(); throw error; }
  };
  return {
    fetch: scopedFetch,
    async close() { lifetime.abort(); requests.clear(); await dispatcher.close(); },
  };
}
