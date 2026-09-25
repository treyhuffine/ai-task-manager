/**
 * Read a server-sent event stream from a fetch body: `event:` and `data:`
 * lines, frames separated by a blank line, comments ignored. Node's fetch
 * has no EventSource, and the worker needs the stream's headers anyway.
 */

export interface StreamFrame {
  event: string;
  data: string;
}

export async function* readEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamFrame> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, '\n');
    let end = buffer.indexOf('\n\n');
    while (end !== -1) {
      const frame = parseFrame(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
      if (frame) yield frame;
      end = buffer.indexOf('\n\n');
    }
  }
}

function parseFrame(text: string): StreamFrame | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}
