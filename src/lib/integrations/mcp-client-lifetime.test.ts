import { describe, expect, it, vi } from 'vitest';
import type { ConnectedMcpClient } from '@integrations/engine/mcp';
import { drainMcpClient } from './mcp-client-lifetime';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture() {
  const tool = deferred<Awaited<ReturnType<ConnectedMcpClient['callTool']>>>();
  const resource = deferred<Awaited<ReturnType<ConnectedMcpClient['readResource']>>>();
  const close = vi.fn(async () => {});
  const raw: ConnectedMcpClient = {
    listTools: async () => ({ tools: [] }),
    callTool: vi.fn(() => tool.promise), readResource: vi.fn(() => resource.promise), close,
  };
  return { tool, resource, raw, close, client: drainMcpClient(raw) };
}

describe('MCP client retirement', () => {
  it('drains both an API request and a resource read before closing exactly once', async () => {
    const f = fixture();
    const call = f.client.callTool({ name: 'api_request' });
    const read = f.client.readResource({ uri: 'ui://view' });
    const closing = f.client.close();
    expect(f.client.close()).toBe(closing);
    expect(f.close).not.toHaveBeenCalled();
    await expect(f.client.callTool({ name: 'api_request' })).rejects.toMatchObject({ code: 'tools_changed' });
    await expect(f.client.readResource({ uri: 'ui://view' })).rejects.toMatchObject({ code: 'tools_changed' });
    f.tool.resolve({ content: [{ type: 'text', text: 'completed' }] });
    expect(await call).toMatchObject({ content: [{ text: 'completed' }] });
    expect(f.close).not.toHaveBeenCalled();
    f.resource.resolve({ contents: [] });
    await read;
    await closing;
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.raw.callTool).toHaveBeenCalledOnce();
  });

  it('closes after a pending operation fails without replaying it', async () => {
    const f = fixture();
    const call = f.client.callTool({ name: 'api_request' });
    const rejected = expect(call).rejects.toThrow('network failed');
    const closing = f.client.close();
    f.tool.reject(new Error('network failed'));
    await rejected;
    await closing;
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.raw.callTool).toHaveBeenCalledOnce();
  });

  it('closes an idle connection immediately', async () => {
    const f = fixture();
    await f.client.close();
    expect(f.close).toHaveBeenCalledOnce();
  });
});
