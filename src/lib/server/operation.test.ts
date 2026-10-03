import { describe, expect, it, vi } from 'vitest';
import { z as legacyZ } from 'zod';
import { z } from 'zod/v4';
import { legacySchema } from './inputs';
import { answerResult, operationContext, OperationError, reply, serveOperation, unwrapOperation } from './operation';

const get = (url: string) => new Request(url);
const post = (body: string) => new Request('http://localhost/api/example', { method: 'POST', body });

describe('shared domain transport adapters', () => {
  it('forwards known query fields through a defaulted input and ignores unrelated public REST parameters', async () => {
    const schema = z.object({ query: z.object({ source: z.string().optional() }).strict().optional() }).strict().default({});
    const operation = vi.fn(async (input: z.infer<typeof schema>) => reply(input));
    const response = await serveOperation(schema, operation)(get('http://localhost/api/example?source=opencode&ignored=1'), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ query: { source: 'opencode' } });
    expect(schema.safeParse({ query: { source: 'opencode', ignored: '1' } }).success).toBe(false);
  });

  it('rejects malformed JSON before any effect and permits empty bodies only through an explicit default', async () => {
    const schema = z.object({ body: z.object({ label: z.string().optional() }).strict().default({}) });
    const operation = vi.fn(async (input: z.infer<typeof schema>) => reply(input));
    expect((await serveOperation(schema, operation)(post('bad json'))).status).toBe(400);
    expect(operation).not.toHaveBeenCalled();
    expect((await serveOperation(schema, operation)(new Request('http://localhost/api/example', { method: 'POST' }))).status).toBe(200);
    const required = z.object({ body: z.object({ label: z.string() }) });
    expect((await serveOperation(required, async input => reply(input))(new Request('http://localhost/api/example', { method: 'POST' }))).status).toBe(400);
  });

  it('bounds actual bytes before a validator strips extra fields and retains legacy oversize statuses', async () => {
    const schema = z.object({ body: z.object({ label: z.string() }) });
    const operation = vi.fn(async (input: z.infer<typeof schema>) => reply(input));
    const body = JSON.stringify({ label: 'ok', extra: '💬'.repeat(100) });
    expect((await serveOperation(schema, operation, { maxBodyBytes: 128 })(post(body))).status).toBe(413);
    expect((await serveOperation(schema, operation, { maxBodyBytes: 128, oversizedStatus: 400 })(post(body))).status).toBe(400);
    expect(operation).not.toHaveBeenCalled();
  });

  it('reuses native Zod 3 refinements inside Zod 4 inputs without losing typed output', () => {
    const native = legacyZ.object({ name: legacyZ.string().trim().min(1) }).strict();
    const schema = z.object({ body: legacySchema(native) });
    expect(schema.parse({ body: { name: ' Ri ' } })).toEqual({ body: { name: 'Ri' } });
    expect(schema.safeParse({ body: { name: ' ' } }).success).toBe(false);
    expect(schema.safeParse({ body: { name: 'Ri', command: 'untrusted' } }).success).toBe(false);
  });

  it('validates remote successes and preserves refusals with their original recovery fields', () => {
    const schema = z.object({ ok: z.literal(true), id: z.string() });
    expect(() => answerResult({ status: 200, body: { ok: true } }, schema)).toThrow();
    const result = answerResult({ status: 409, body: { error: 'moving', message: 'Wait for the move.', deviceId: 'laptop' } }, schema);
    expect(() => unwrapOperation(result)).toThrow('Wait for the move.');
    try { unwrapOperation(result); } catch (error) {
      expect(error).toMatchObject({ code: 'CONFLICT', cause: { status: 409, body: { deviceId: 'laptop' } } });
    }
  });

  it('keeps signed headers and cancellation while constructing scoped domain metadata', () => {
    const request = new Request('https://home.example/api/trpc/sessions.fileGet', { headers: { 'x-ri-api-key-id': 'viewer' } });
    const context = operationContext(request, { params: { id: 'chat/a' }, query: { path: 'src/file.ts', absent: undefined } }, '/sessions/[id]/file');
    expect(context.url).toBe('https://home.example/api/sessions/chat%2Fa/file?path=src%2Ffile.ts');
    expect(context.headers).toBe(request.headers);
    expect(context.signal).toBe(request.signal);
  });
});

it('recognizes a domain refusal across separately loaded Next bundles', async () => {
  const error = new OperationError(426, { code: 'api_protocol' });
  vi.resetModules();
  const reloaded = await import('./operation');
  expect(error instanceof reloaded.OperationError).toBe(false);
  expect(reloaded.isOperationError(error)).toBe(true);
  expect(reloaded.isOperationError(new Error('ordinary'))).toBe(false);
});
