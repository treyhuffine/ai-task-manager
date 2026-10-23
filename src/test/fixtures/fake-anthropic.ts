/**
 * A stand-in for the Anthropic Messages API, for qualifying a real Claude Code
 * binary without a real model or account (docs/homes-build.md, P8.4). It
 * records every request Claude Code makes, what tools it offered, its
 * instructions and which key it sent, and answers each model request from a
 * script.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeAnthropicRequest {
  url: string;
  apiKey: string | null;
  bearer: string | null;
  tools: string[];
  system: unknown;
  messages: Array<{ role: string; content: unknown }>;
}

export type FakeBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

/** What to answer a model request with: a message, or an HTTP error. */
export type FakeReply = { blocks: FakeBlock[]; stop: 'end_turn' | 'tool_use' } | { status: number; error: string }
  | { stall: true };

export interface FakeAnthropic {
  url: string;
  requests: FakeAnthropicRequest[];
  /** Model requests only. */
  modelRequests(): FakeAnthropicRequest[];
  script: (request: FakeAnthropicRequest) => FakeReply;
  close(): Promise<void>;
}

function sse(blocks: FakeBlock[], stop: string): string {
  const events: Array<[string, unknown]> = [[
    'message_start',
    { type: 'message_start', message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: 'claude-fake', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } },
  ]];
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }]);
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } }]);
    } else {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } }]);
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } }]);
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index }]);
  });
  events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } }]);
  events.push(['message_stop', { type: 'message_stop' }]);
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

/** The last tool results Claude Code sent back, by tool use id. */
export function toolResults(request: FakeAnthropicRequest): Record<string, { isError: boolean; text: string }> {
  const out: Record<string, { isError: boolean; text: string }> = {};
  // Subscription sessions can append a system cache marker after the user
  // tool results. Read the latest user message, not the last wire message.
  const last = [...request.messages].reverse().find(message => message.role === 'user');
  if (!last || !Array.isArray(last.content)) return out;
  for (const part of last.content as Array<{ type: string; tool_use_id?: string; is_error?: boolean; content?: unknown }>) {
    if (part.type !== 'tool_result' || !part.tool_use_id) continue;
    out[part.tool_use_id] = { isError: Boolean(part.is_error), text: typeof part.content === 'string' ? part.content : JSON.stringify(part.content) };
  }
  return out;
}

export async function startFakeAnthropic(script: FakeAnthropic['script'] = () => ({ blocks: [{ type: 'text', text: 'Done.' }], stop: 'end_turn' })): Promise<FakeAnthropic> {
  const requests: FakeAnthropicRequest[] = [];
  const fake = { requests, script } as FakeAnthropic;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let json: { tools?: Array<{ name: string }>; system?: unknown; messages?: FakeAnthropicRequest['messages'] } = {};
      try { json = JSON.parse(body); } catch { /* not JSON */ }
      const auth = req.headers.authorization;
      const record: FakeAnthropicRequest = {
        url: req.url ?? '',
        apiKey: (req.headers['x-api-key'] as string | undefined) ?? null,
        bearer: auth?.startsWith('Bearer ') ? auth.slice(7) : null,
        tools: (json.tools ?? []).map((t) => t.name),
        system: json.system ?? null,
        messages: json.messages ?? [],
      };
      requests.push(record);
      if (!record.url.startsWith('/v1/messages') || record.url.includes('count_tokens')) {
        const ok = record.url.includes('count_tokens');
        res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
        res.end(JSON.stringify(ok ? { input_tokens: 10 } : { error: 'not here' }));
        return;
      }
      const reply = fake.script(record);
      if ('status' in reply) {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: reply.status === 401 ? 'authentication_error' : 'api_error', message: reply.error } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      if ('stall' in reply) { res.flushHeaders(); res.write('event: ping\ndata: {"type":"ping"}\n\n'); return; }
      res.end(sse(reply.blocks, reply.stop));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.modelRequests = () => requests.filter((r) => r.url.startsWith('/v1/messages') && !r.url.includes('count_tokens'));
  fake.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return fake;
}
