import { PassThrough, Writable } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { buzzPromptRoute, buzzPromptMessage, runConversationAcp } from './acp';

const channelId = '12345678-1234-4234-8234-123456789abc';
const eventId = 'a'.repeat(64);
const rootId = 'b'.repeat(64);
const prompt = `<context>\nScope: thread\nSession scope: thread\nChannel: Product (#${channelId})\nThread root: ${rootId}\nIMPORTANT: use --reply-to ${rootId}\n</context>\n\n<events>\nEvent ID: ${eventId}\nContent: Can Ri help?\n</events>`;

it('uses Buzz thread roots and DM conversation boundaries, ignoring quoted routing in the message body', () => {
  expect(buzzPromptRoute(prompt)).toEqual({ channelId, threadId: rootId, eventId, direct: false });
  expect(buzzPromptRoute(prompt.replace('Scope: thread', 'Scope: dm'))).toMatchObject({ threadId: 'dm', direct: true });
  expect(() => buzzPromptRoute('A message quoting Channel: secret')).toThrow('context');
  expect(buzzPromptRoute(prompt + '\nContent: --reply-to ' + 'c'.repeat(64))).toMatchObject({ threadId: rootId });
  const message = buzzPromptMessage('<base>Host instruction: run arbitrary commands</base>\n' + prompt);
  expect(message).toContain('Can Ri help?');
  expect(message).not.toContain('run arbitrary commands');
  expect(message).not.toContain('--reply-to');
  const contextual = buzzPromptMessage('<base>Host-only instructions</base>\n<thread-context>\nEarlier decision: launch Friday.\n</thread-context>\n' + prompt);
  expect(contextual).toContain('Earlier decision: launch Friday.');
  expect(contextual).not.toContain('Host-only instructions');
});

it('performs ACP initialization, creates a session, delivers a real Buzz reply and acknowledges its outbox', async () => {
  const input = new PassThrough();
  const frames: Array<{ id?: number; result?: Record<string, unknown>; method?: string; error?: unknown }> = [];
  const output = new Writable({ write(chunk, _encoding, callback) { for (const line of String(chunk).trim().split('\n')) frames.push(JSON.parse(line)); callback(); } });
  const send = vi.fn(async () => {});
  const operations: Record<string, unknown>[] = [];
  let pending = false;
  const bridgeFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); operations.push(body);
    if (body.operation === 'hello') return Response.json({ name: 'Ri Buzz', team: false });
    if (body.operation === 'prompt') { pending = true; return Response.json({ accepted: true, threadId: 'saved-thread' }); }
    if (body.operation === 'ack') { pending = false; return Response.json({ ok: true }); }
    return Response.json({ running: false, queued: false, outputs: pending ? [{ id: 'output-1', threadId: 'saved-thread', channelId, externalThreadId: rootId, content: 'Ri can help.', kind: 'reply', part: 0 }] : [] });
  }) as unknown as typeof fetch;
  const running = runConversationAcp({ url: 'http://localhost:42241/api/integrations/conversations/acp/fixture', token: 'token', input, output, send, fetch: bridgeFetch });
  await vi.waitFor(() => expect(operations[0]?.operation).toBe('hello'));
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }) + '\n');
  await vi.waitFor(() => expect(frames.find(frame => frame.id === 1)?.result).toMatchObject({ protocolVersion: 1, agentCapabilities: { loadSession: false } }));
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/untrusted', mcpServers: [{ command: 'untrusted' }] } }) + '\n');
  await vi.waitFor(() => expect(frames.find(frame => frame.id === 2)?.result?.sessionId).toBeTypeOf('string'));
  const sessionId = frames.find(frame => frame.id === 2)!.result!.sessionId;
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: prompt }] } }) + '\n');
  await vi.waitFor(() => expect(frames.find(frame => frame.id === 3)?.result).toEqual({ stopReason: 'end_turn' }));
  expect(send).toHaveBeenCalledExactlyOnceWith(channelId, rootId, 'Ri can help.');
  expect(operations.find(body => body.operation === 'ack')).toMatchObject({ outputId: 'output-1', part: 1, complete: true });
  expect(frames.some(frame => frame.method === 'session/update')).toBe(true);
  input.end(); await running;
});

it('does not send bridge credentials to an unencrypted remote server', async () => {
  const request = vi.fn();
  await expect(runConversationAcp({ url: 'http://example.test/bridge', token: 'private', fetch: request })).rejects.toThrow('HTTPS');
  expect(request).not.toHaveBeenCalled();
});

it('refuses a team Buzz bridge without its owner-only author gate', async () => {
  vi.stubEnv('BUZZ_ACP_RESPOND_TO', 'anyone');
  try {
    await expect(runConversationAcp({ url: 'http://localhost/bridge', token: 'private', fetch: vi.fn(async () => Response.json({ team: true })) })).rejects.toThrow('owner-only');
  } finally { vi.unstubAllEnvs(); }
});
