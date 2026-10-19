/**
 * How `connectMcpClient` classifies MCP SDK failures. The SDK's own error classes are real; only the
 * `Client` is a double, so deadline and authorization outcomes can be produced on demand.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SdkError, SdkErrorCode, SdkHttpError, UnauthorizedError } from '@modelcontextprotocol/client';
import { NeedsReauthError } from '../core/errors';
import { beginMcpOAuth, connectMcpClient, isMcpAuthenticationError, isMcpRequestTimeout } from '../mcp/client';

const sdk = vi.hoisted(() => ({
  connect: vi.fn(), close: vi.fn(), listTools: vi.fn(), callTool: vi.fn(), readResource: vi.fn(),
  setNotificationHandler: vi.fn(), setRequestHandler: vi.fn(), auth: vi.fn(), options: [] as unknown[],
}));

vi.mock('../mcp/http-fetch', () => ({ mcpHttpFetch: async () => ({ fetch: vi.fn(), close: async () => {} }) }));
vi.mock('@modelcontextprotocol/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@modelcontextprotocol/client')>(),
  auth: sdk.auth,
  Client: class {
    constructor(_info: unknown, options: unknown) { sdk.options.push(options); }
    connect = sdk.connect;
    close = sdk.close;
    listTools = sdk.listTools;
    callTool = sdk.callTool;
    readResource = sdk.readResource;
    setNotificationHandler = sdk.setNotificationHandler;
    setRequestHandler = sdk.setRequestHandler;
    getServerCapabilities = () => ({ tools: {} });
    getServerVersion = () => ({ name: 'fixture', version: '1' });
    getNegotiatedProtocolVersion = () => '2026-07-28';
    getProtocolEra = () => 'modern';
    getInstructions = () => undefined;
  },
  StreamableHTTPClientTransport: class {},
}));

const http = (status: number) => new SdkHttpError(status === 401 ? SdkErrorCode.ClientHttpAuthentication : SdkErrorCode.ClientHttpNotImplemented, `HTTP ${status}`, { status, statusText: String(status) });

beforeEach(() => { vi.resetAllMocks(); sdk.options.length = 0; });

describe('MCP error classification', () => {
  it.each([
    [new UnauthorizedError('Token rejected'), true],
    [http(401), true],
    [new NeedsReauthError(), true],
    [http(403), false],
    [http(503), false],
    [Object.assign(new Error('401 Unauthorized'), { name: 'UnauthorizedError', code: 401 }), false],
    [new Error('Connection closed'), false],
  ])('distinguishes typed authentication rejection from transient errors: %s', async (error, rejected) => {
    expect(await isMcpAuthenticationError(error)).toBe(rejected);
  });

  it.each([
    [new SdkError(SdkErrorCode.RequestTimeout, 'Request timed out'), true],
    [new DOMException('The operation timed out', 'TimeoutError'), true],
    [new SdkError(SdkErrorCode.ConnectionClosed, 'Connection closed'), false],
    [new Error('The operation timed out'), false],
    [Object.assign(new Error('Request timed out'), { code: -32001 }), false],
  ])('classifies only typed request deadlines: %s', async (error, timeout) => {
    expect(await isMcpRequestTimeout(error)).toBe(timeout);
  });
});

describe('connectMcpClient request handling', () => {
  it('asks the SDK to negotiate 2026-07-28 and to keep the tool-list subscription', async () => {
    await connectMcpClient({ url: 'https://official.example/mcp', onToolsChanged: async () => {} });
    expect(sdk.options[0]).toMatchObject({
      versionNegotiation: { mode: 'auto' },
      capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } },
      listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged: expect.any(Function) } },
    });
    expect(sdk.setNotificationHandler).toHaveBeenCalledWith('notifications/tools/list_changed', expect.any(Function));
  });

  it('passes Ri\'s deadlines, progress and request metadata to every tool call', async () => {
    sdk.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'Task list' }], structuredContent: { results: [] } });
    const client = await connectMcpClient({ url: 'https://official.example/mcp' });
    expect(await client.callTool({ name: 'find-tasks', arguments: { limit: 100 }, _meta: { 'openai/resource': { path: '/tmp/part.stl' } } }))
      .toEqual({ content: [{ type: 'text', text: 'Task list' }], structuredContent: { results: [] }, isError: false });
    expect(sdk.callTool).toHaveBeenCalledWith({ name: 'find-tasks', arguments: { limit: 100 }, _meta: { 'openai/resource': { path: '/tmp/part.stl' } } }, {
      timeout: 600_000, resetTimeoutOnProgress: true, maxTotalTimeout: 1_800_000, signal: expect.any(AbortSignal), onprogress: expect.any(Function),
    });
  });

  it('keeps a reported timeout distinct from Ri exhausting its own deadlines', async () => {
    const client = await connectMcpClient({ url: 'https://official.example/mcp' });
    sdk.callTool.mockRejectedValueOnce(new SdkError(SdkErrorCode.RequestTimeout, 'Provider task timed out', { timeout: 5_000 }));
    await expect(client.callTool({ name: 'research' })).rejects.toMatchObject({ code: 'provider_timeout', message: expect.stringContaining('upstream MCP request reported a timeout') });
    sdk.callTool.mockRejectedValueOnce(new SdkError(SdkErrorCode.RequestTimeout, 'Inactive', { timeout: 600_000 }));
    await expect(client.callTool({ name: 'research' })).rejects.toMatchObject({ message: expect.stringContaining('10-minute inactivity limit') });
    sdk.callTool.mockRejectedValueOnce(new SdkError(SdkErrorCode.RequestTimeout, 'Total', { maxTotalTimeout: 1_800_000 }));
    await expect(client.callTool({ name: 'research' })).rejects.toMatchObject({ message: expect.stringContaining('30-minute total limit') });
  });

  it.each([new UnauthorizedError('Token rejected'), http(401)])('maps SDK authentication rejection to the runtime reconnect signal: %s', async (error) => {
    sdk.callTool.mockRejectedValue(error);
    const client = await connectMcpClient({ url: 'https://official.example/mcp' });
    await expect(client.callTool({ name: 'add-task' })).rejects.toBeInstanceOf(NeedsReauthError);
    expect(sdk.callTool).toHaveBeenCalledOnce();
  });

  it.each([
    http(403), http(503), new Error('401 Unauthorized'),
    Object.assign(new Error('Authorization required'), { name: 'UnauthorizedError', code: 401 }),
  ])('preserves other failures for caller handling: %s', async (error) => {
    sdk.callTool.mockRejectedValue(error);
    const client = await connectMcpClient({ url: 'https://official.example/mcp' });
    await expect(client.callTool({ name: 'add-task' })).rejects.toBe(error);
  });

  it('refuses a call cancelled before dispatch without sending it', async () => {
    const client = await connectMcpClient({ url: 'https://official.example/mcp' });
    const controller = new AbortController();
    controller.abort();
    await expect(client.callTool({ name: 'add-task' }, { signal: controller.signal })).rejects.toMatchObject({ code: 'denied' });
    expect(sdk.callTool).not.toHaveBeenCalled();
  });

  it('closes a failed connection and preserves the original error', async () => {
    const failure = new Error('Authorization required');
    sdk.connect.mockRejectedValue(failure);
    sdk.close.mockRejectedValue(new Error('Transport already closed'));
    await expect(connectMcpClient({ url: 'https://official.example/mcp' })).rejects.toBe(failure);
    expect(sdk.close).toHaveBeenCalledOnce();
  });

  const modes = () => sdk.options.map(options => (options as { versionNegotiation: { mode: string } }).versionNegotiation.mode);
  it.each([
    new SdkError(SdkErrorCode.EraNegotiationFailed, 'the server answered with an unusable reply'),
    new SdkError(SdkErrorCode.RequestTimeout, 'probe timed out'),
  ])('retries once as a 2025 client when the probe could not classify the server: %s', async (error) => {
    sdk.connect.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
    const client = await connectMcpClient({ url: 'https://official.example/mcp' });
    expect(modes()).toEqual(['auto', 'legacy']);
    expect(client.server?.negotiation).toBe('fallback');
  });

  it.each([
    new UnauthorizedError('Sign in again'),
    new SdkHttpError(SdkErrorCode.EraNegotiationFailed, 'Forbidden', { status: 403, statusText: 'Forbidden' }),
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
  ])('does not retry an authorization or network failure as a 2025 client: %s', async (error) => {
    sdk.connect.mockRejectedValueOnce(error);
    await expect(connectMcpClient({ url: 'https://official.example/mcp' })).rejects.toBe(error);
    expect(modes()).toEqual(['auto']);
  });

  it('skips the probe for a server known to be legacy, and never retries it', async () => {
    sdk.connect.mockRejectedValueOnce(new SdkError(SdkErrorCode.RequestTimeout, 'initialize timed out'));
    await expect(connectMcpClient({ url: 'https://official.example/mcp', knownLegacy: true })).rejects.toBeInstanceOf(SdkError);
    expect(modes()).toEqual(['legacy']);
  });

  it.each(['AUTHORIZED', 'REDIRECT'] as const)('begins explicit SDK OAuth without opening a transport: %s', async (result) => {
    const authProvider = { redirectUrl: 'https://app.example/mcp/callback' };
    sdk.auth.mockResolvedValue(result);
    expect(await beginMcpOAuth({ url: 'https://official.example/mcp', authProvider, scope: 'auth' })).toBe(result);
    expect(sdk.auth).toHaveBeenCalledWith(authProvider, { serverUrl: 'https://official.example/mcp', scope: 'auth' });
    expect(sdk.connect).not.toHaveBeenCalled();
  });
});
