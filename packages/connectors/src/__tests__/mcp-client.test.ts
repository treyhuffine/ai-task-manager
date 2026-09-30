import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { NeedsReauthError } from '../core/errors';
import { beginMcpOAuth, connectMcpClient } from '../mcp/client';

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  setNotificationHandler: vi.fn(),
  auth: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/auth.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('@modelcontextprotocol/sdk/client/auth.js')>(),
  auth: sdk.auth,
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = sdk.connect;
    close = sdk.close;
    listTools = sdk.listTools;
    callTool = sdk.callTool;
    setNotificationHandler = sdk.setNotificationHandler;
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js')>(),
  StreamableHTTPClientTransport: class {},
}));

describe('connectMcpClient', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it.each(['AUTHORIZED', 'REDIRECT'] as const)('begins explicit SDK OAuth without opening a transport: %s', async (result) => {
    const authProvider = { redirectUrl: 'https://app.example/mcp/callback' };
    sdk.auth.mockResolvedValue(result);
    expect(await beginMcpOAuth({ url: 'https://official.example/mcp', authProvider })).toBe(result);
    expect(sdk.auth).toHaveBeenCalledWith(authProvider, { serverUrl: 'https://official.example/mcp' });
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it('preserves explicit OAuth failures without turning them into a successful redirect', async () => {
    const failure = new UnauthorizedError('Registered application rejected');
    sdk.auth.mockRejectedValue(failure);
    await expect(beginMcpOAuth({ url: 'https://official.example/mcp', authProvider: {} })).rejects.toBe(failure);
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it('passes trusted explicit consent scopes to the SDK without opening a transport', async () => {
    const authProvider = { redirectUrl: 'https://app.example/mcp/callback' };
    sdk.auth.mockResolvedValue('REDIRECT');
    await beginMcpOAuth({ url: 'https://official.example/mcp', authProvider, scope: 'auth' });
    expect(sdk.auth).toHaveBeenCalledWith(authProvider, { serverUrl: 'https://official.example/mcp', scope: 'auth' });
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it('closes a failed connection and preserves the original authorization error', async () => {
    const failure = new Error('Authorization required');
    sdk.connect.mockRejectedValue(failure);
    sdk.close.mockRejectedValue(new Error('Transport already closed'));
    await expect(connectMcpClient({ url: 'https://official.example/mcp' })).rejects.toBe(failure);
    expect(sdk.close).toHaveBeenCalledOnce();
  });

  it('discovers all tool pages and preserves their titles, schemas, and approval annotations', async () => {
    const schema = { type: 'object', properties: { taskId: { type: 'string' } } };
    const outputSchema = { type: 'object', properties: { results: { type: 'array' } } };
    const readAnnotations = { title: 'Search tasks', readOnlyHint: true, destructiveHint: false };
    sdk.listTools
      .mockResolvedValueOnce({ tools: [{ name: 'find-tasks', title: 'Find tasks', inputSchema: schema, outputSchema, annotations: readAnnotations }], nextCursor: 'second' })
      .mockResolvedValueOnce({ tools: [], nextCursor: 'third' })
      .mockResolvedValueOnce({ tools: [{ name: 'manage-assignments', annotations: { destructiveHint: false } }] });
    const client = await connectMcpClient({ url: 'https://official.example/mcp' });
    expect(await client.listTools()).toMatchObject({ tools: [
      { name: 'find-tasks', title: 'Find tasks', inputSchema: schema, outputSchema, annotations: readAnnotations },
      { name: 'manage-assignments', annotations: { destructiveHint: false } },
    ] });
    expect(sdk.listTools.mock.calls).toEqual([[undefined], [{ cursor: 'second' }], [{ cursor: 'third' }]]);
  });

  it('subscribes to the SDK tool-list notification before connecting', async () => {
    const changed = vi.fn(async () => {});
    sdk.connect.mockImplementation(async () => {
      expect(sdk.setNotificationHandler).toHaveBeenCalledOnce();
      const [schema, handler] = sdk.setNotificationHandler.mock.calls[0]!;
      const notification = schema.parse({ method: 'notifications/tools/list_changed' });
      await handler(notification);
    });
    await connectMcpClient({ url: 'https://official.example/mcp', onToolsChanged: changed });
    expect(changed).toHaveBeenCalledOnce();
    expect(sdk.listTools).not.toHaveBeenCalled(); // host lifecycle owns rediscovery
  });

  it('rejects cursor cycles instead of hanging or returning an incomplete catalog', async () => {
    sdk.listTools
      .mockResolvedValueOnce({ tools: [{ name: 'first' }], nextCursor: 'second' })
      .mockResolvedValueOnce({ tools: [{ name: 'second' }], nextCursor: 'third' })
      .mockResolvedValueOnce({ tools: [{ name: 'third' }], nextCursor: 'second' });
    const client = await connectMcpClient({ url: 'https://official.example/mcp' });
    await expect(client.listTools()).rejects.toMatchObject({ code: 'provider_error', message: expect.stringContaining('repeated') });
    expect(sdk.listTools).toHaveBeenCalledTimes(3);
  });

  it('preserves structured task results, text content, and remote errors', async () => {
    const response = {
      content: [{ type: 'text', text: 'Task list' }],
      structuredContent: { results: [{ id: 'task-1', content: 'Ship the connector' }] },
    };
    sdk.callTool.mockResolvedValueOnce(response).mockResolvedValueOnce({ content: [{ type: 'text', text: 'Task missing' }], isError: true });
    const client = await connectMcpClient({ url: 'https://official.example/mcp' });
    expect(await client.callTool({ name: 'find-tasks', arguments: { limit: 100 } })).toEqual({ ...response, isError: false });
    expect(await client.callTool({ name: 'fetch-object', arguments: { id: 'missing' } })).toMatchObject({ isError: true });
    expect(sdk.callTool).toHaveBeenNthCalledWith(1, { name: 'find-tasks', arguments: { limit: 100 } }, undefined, {
      timeout: 120_000, resetTimeoutOnProgress: true, maxTotalTimeout: 600_000,
    });
    await client.close();
    expect(sdk.close).toHaveBeenCalledOnce();
  });

  it.each([
    new UnauthorizedError('Token rejected'),
    new StreamableHTTPError(401, 'Unauthorized'),
  ])('maps SDK authentication rejection to the runtime reconnect signal: %s', async (error) => {
    sdk.callTool.mockRejectedValue(error);
    const client = await connectMcpClient({ url: 'https://official.example/mcp' });
    await expect(client.callTool({ name: 'add-task' })).rejects.toBeInstanceOf(NeedsReauthError);
    expect(sdk.callTool).toHaveBeenCalledOnce();
  });

  it.each([
    new StreamableHTTPError(403, 'Forbidden'),
    new StreamableHTTPError(503, 'Service unavailable'),
    new Error('401 Unauthorized'),
    Object.assign(new Error('Authorization required'), { name: 'UnauthorizedError', code: 401 }),
    new NeedsReauthError(undefined, 'Host authorization was replaced'),
  ])('preserves other failures for caller handling: %s', async (error) => {
    sdk.callTool.mockRejectedValue(error);
    const client = await connectMcpClient({ url: 'https://official.example/mcp' });
    await expect(client.callTool({ name: 'add-task' })).rejects.toBe(error);
    expect(sdk.callTool).toHaveBeenCalledOnce();
  });
});
