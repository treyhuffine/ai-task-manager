import { readLimitedJson, RequestBodyTooLargeError } from '@/lib/api/limited-body';
import { TRPCError } from '@trpc/server';
import { ZodObject, type ZodType } from 'zod/v4';

/** Metadata verified by the HTTP auth boundary, shared by UI procedures and
 * compatibility adapters. Domain operations never make an HTTP request. */
export interface OperationContext {
  headers: Headers;
  url: string;
  nextUrl: URL;
  signal: AbortSignal;
}
export interface OperationFailure {
  ok: false;
  status: number;
  body: unknown;
  headers?: HeadersInit;
}
export interface OperationSuccess<T> {
  ok: true;
  status: number;
  data: T;
  headers?: HeadersInit;
}
type MutableData<T> = T extends readonly (infer Item)[] ? MutableData<Item>[] : T extends object ? { -readonly [K in keyof T]: MutableData<T[K]> } : T;
type Reply<T> = T extends { error: unknown } ? OperationFailure : OperationSuccess<T> | OperationFailure;
type StatusReply<T, Init> = Init extends { status: infer Status extends number }
  ? `${Status}` extends `4${string}` | `5${string}` ? OperationFailure : Reply<T>
  : Reply<T>;

/** Keep a structured failure as a value until it reaches a transport. This
 * preserves early refusals inside existing domain try/catch blocks. */
export function reply<const T, const Init extends ResponseInit | undefined = undefined>(data: T, init?: Init): StatusReply<MutableData<T>, Init> {
  const status = init?.status ?? 200;
  return (status >= 400
    ? { ok: false, status, body: data, headers: init?.headers }
    : { ok: true, status, data, headers: init?.headers }) as StatusReply<MutableData<T>, Init>;
}
export function failure(body: unknown, status: number): OperationFailure {
  return { ok: false, body, status };
}
export function answerResult<T>(answer: { status: number; body: unknown }, schema: ZodType<T>): OperationSuccess<T> | OperationFailure {
  return answer.status >= 400 ? failure(answer.body, answer.status) : { ok: true, status: answer.status, data: schema.parse(answer.body) };
}
export function operationResponse(result: OperationSuccess<unknown> | OperationFailure): Response {
  return result.status === 204 ? new Response(null, { status: 204, headers: result.headers })
    : Response.json(result.ok ? result.data : result.body, { status: result.status, headers: result.headers });
}
/** Compatibility for domain helpers that still construct an HTTP refusal.
 * Successes must return typed data and are deliberately rejected here. */
export async function failureResponse(response: Response): Promise<OperationFailure> {
  if (response.ok) throw new Error('An operation returned an HTTP success instead of typed data');
  return failure(await response.json(), response.status);
}
export function boundedInput<T>(body: T, maxBytes: number): T {
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > maxBytes) throw new RequestBodyTooLargeError(maxBytes);
  return body;
}
export type OperationData<T> = T extends OperationSuccess<infer Data> ? Data : never;
const OPERATION_ERROR = Symbol.for('@ri/operation-error');
export class OperationError extends Error {
  readonly [OPERATION_ERROR] = true;
  constructor(readonly status: number, readonly body: unknown) {
    const value = body as { error?: unknown; message?: unknown } | null;
    super(typeof value?.message === 'string' ? value.message : typeof value?.error === 'string' ? value.error : `Request failed (${status})`);
    this.name = 'OperationError';
  }
}
/** Next's route and instrumentation bundles can define this class twice. */
export function isOperationError(error: unknown): error is OperationError {
  return error instanceof OperationError || (error instanceof Error && (error as OperationError)[OPERATION_ERROR] === true);
}
export function unwrapOperation<T extends OperationSuccess<unknown> | OperationFailure>(result: T): OperationData<T> {
  if (!result.ok) {
    const cause = new OperationError(result.status, result.body);
    const code = result.status === 400 ? 'BAD_REQUEST'
      : result.status === 401 ? 'UNAUTHORIZED'
        : result.status === 403 ? 'FORBIDDEN'
          : result.status === 404 ? 'NOT_FOUND'
            : result.status === 409 ? 'CONFLICT'
              : result.status === 422 ? 'UNPROCESSABLE_CONTENT'
                : result.status === 429 ? 'TOO_MANY_REQUESTS'
                  : result.status === 503 ? 'SERVICE_UNAVAILABLE'
                    : result.status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'PRECONDITION_FAILED';
    throw new TRPCError({ code, message: cause.message, cause });
  }
  return result.data as OperationData<T>;
}
export function searchParams(query?: Record<string, string | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) params.set(key, value);
  return params;
}

export function operationContext(request: Request, input: { query?: Record<string, string | undefined>; params?: Record<string, string>; body?: unknown }, path: string): OperationContext {
  const url = new URL(request.url);
  url.pathname = '/api' + path.replace(/\[([^\]]+)\]/g, (_, key: string) => encodeURIComponent(input.params?.[key] ?? ''));
  url.search = searchParams(input.query).toString();
  return { headers: request.headers, url: url.toString(), nextUrl: url, signal: request.signal };
}

/** Existing public REST contracts are thin adapters over the same operations.
 * Validation happens before either transport can enter the domain. */
interface OperationRouteHandler {
  (request: Request): Promise<Response>;
  (request: Request, route: { params: Promise<Record<string, string>> }): Promise<Response>;
}
export function serveOperation<Input, Result extends OperationSuccess<unknown> | OperationFailure>(
  schema: ZodType<Input>,
  operation: (input: Input, context: OperationContext) => Promise<Result>,
  options: { maxBodyBytes?: number; oversizedStatus?: 400 | 413; prepareBody?: (body: unknown) => unknown; validationStatus?: 400 | 422; validationCode?: string } = {},
): OperationRouteHandler {
  let shapeSchema: ZodType = schema;
  while (!(shapeSchema instanceof ZodObject) && 'unwrap' in shapeSchema && typeof shapeSchema.unwrap === 'function') shapeSchema = shapeSchema.unwrap();
  const objectSchema = shapeSchema instanceof ZodObject ? shapeSchema : undefined;
  return async (request: Request, route?: { params: Promise<Record<string, string>> }) => {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const params = route ? await route.params : undefined;
    let body: unknown;
    if (objectSchema && 'body' in objectSchema.shape && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
      try {
        // Empty bodies are permitted only when the procedure's schema supplies a default.
        body = request.body === null ? undefined : await readLimitedJson(request, options.maxBodyBytes ?? 1024 * 1024);
        if (options.prepareBody) body = options.prepareBody(body);
      } catch (error) {
        return Response.json({ error: error instanceof RequestBodyTooLargeError ? 'Request body is too large.' : 'Invalid JSON body.' }, { status: error instanceof RequestBodyTooLargeError ? options.oversizedStatus ?? 413 : 400 });
      }
    }
    // Public REST historically ignored unrelated URL parameters. tRPC still validates
    // its explicit query object strictly, preventing accidental misspelled inputs.
    const querySchema = objectSchema?.shape.query?.unwrap?.();
    const knownQuery = querySchema instanceof ZodObject ? Object.fromEntries(Object.entries(query).filter(([key]) => key in querySchema.shape)) : query;
    const parsed = schema.safeParse({ ...(params && objectSchema && 'params' in objectSchema.shape ? { params } : {}), ...(objectSchema && 'query' in objectSchema.shape && Object.keys(knownQuery).length ? { query: knownQuery } : {}), ...(body !== undefined ? { body } : {}) });
    if (!parsed.success) return Response.json({ error: parsed.error.message, ...(options.validationCode ? { code: options.validationCode } : {}) }, { status: options.validationStatus ?? 400 });
    const result = await operation(parsed.data, {
      headers: request.headers, url: request.url, nextUrl: new URL(request.url), signal: request.signal,
    });
    const status = result.status;
    if (status === 204) return new Response(null, { status, headers: result.headers });
    return Response.json(result.ok ? result.data : result.body, { status, headers: result.headers });
  };
}
