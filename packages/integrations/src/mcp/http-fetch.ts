import { MCP_HTTP_TIMEOUT_MS } from './timeouts';

/**
 * The most one MCP message over HTTP may hold: a JSON response's whole body,
 * or one event of an SSE stream (a long-lived stream is never cut off by its
 * total). The same budget a local server's stdio transport has per message
 * (`MCP_STDIO_MAX_BUFFER_BYTES`), well above the largest result Ri delivers to
 * an app view (24 MiB) with room for base64 and the JSON-RPC envelope.
 */
export const MCP_HTTP_MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
/**
 * The most a server's whole tool list may hold, all its pages together.
 * Ri keeps the list in memory to run, show and review the tools, and reads
 * it again whenever the server's tools change, so the list's size is paid in
 * memory and at each rediscovery, never per check. 16 MiB is about 2,500
 * tools of the size Todoist's 47 are (0.3 MiB in all), more than any agent
 * can use.
 */
export const MCP_TOOL_LIST_MAX_BYTES = 16 * 1024 * 1024;
/**
 * The most any other message may hold: the handshake, a notification or a
 * server's request, and every event of the stream a server opens on its own.
 * They are small by nature, and each is parsed in one go on Ri's one thread.
 */
export const MCP_HTTP_MAX_CONTROL_MESSAGE_BYTES = 2 * 1024 * 1024;
/** The JSON-RPC requests whose answer may run to `MCP_HTTP_MAX_MESSAGE_BYTES`: a tool's result and a resource's content. */
const LARGE_ANSWERS = new Set(['tools/call', 'resources/read']);

/** A server's message, or tool list, that passed its size. Ri stops reading the response. */
export class McpMessageTooLargeError extends Error {
  constructor(max: number, what = 'a message') {
    super(`The MCP server sent ${what} larger than ${max / 1024 / 1024} MiB, so Ri stopped reading it.`);
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

/**
 * Per-client HTTP budgets and per-request cancellation, without changing
 * global fetch. Each message is read within the size that fits what it is:
 * a tool's result or a resource's content `maxMessageBytes`, the pages of a
 * tool list `maxToolListBytes` together (a listing without a cursor starts
 * the count again), and anything else `maxControlMessageBytes`.
 */
export async function mcpHttpFetch(options: { maxMessageBytes?: number; maxControlMessageBytes?: number; maxToolListBytes?: number } = {}) {
  const maxMessageBytes = options.maxMessageBytes ?? MCP_HTTP_MAX_MESSAGE_BYTES;
  const maxControlMessageBytes = options.maxControlMessageBytes ?? MCP_HTTP_MAX_CONTROL_MESSAGE_BYTES;
  const maxToolListBytes = options.maxToolListBytes ?? MCP_TOOL_LIST_MAX_BYTES;
  /** Bytes of the tool list being read so far, across its pages. */
  let listed = 0;
  const { Agent } = await import('undici');
  const dispatcher = new Agent({ headersTimeout: MCP_HTTP_TIMEOUT_MS, bodyTimeout: MCP_HTTP_TIMEOUT_MS });
  const lifetime = new AbortController();
  const requests = new Map<string | number, AbortController>();

  const scopedFetch: typeof fetch = async (input, init) => {
    let id: string | number | undefined;
    let operation: AbortController | undefined;
    let limit = maxControlMessageBytes;
    let listing = false;
    if (typeof init?.body === 'string') {
      try {
        const message = JSON.parse(init.body);
        if (LARGE_ANSWERS.has(message.method)) limit = maxMessageBytes;
        else if (message.method === 'tools/list') {
          listing = true;
          if (message.params?.cursor === undefined) listed = 0;
        }
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
            // A tool list's pages count together. Anything else is measured one message at a time.
            if (listing) listed += chunk.value.byteLength;
            const over = listing ? listed > maxToolListBytes : measure(chunk.value) > limit;
            if (over) {
              release(); operation?.abort();
              await reader.cancel().catch(() => {});
              reader.releaseLock();
              controller.error(listing ? new McpMessageTooLargeError(maxToolListBytes, 'a tool list') : new McpMessageTooLargeError(limit));
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
