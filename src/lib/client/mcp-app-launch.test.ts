import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/trpc/client', () => ({trpcClient: {connectedApps: {}}}));
import { LaunchDeclined, launchConnectedApp } from './mcp-app-launch';

const fake = () => {
  const client = {
    prepare: {mutate: vi.fn()}, launch: {mutate: vi.fn()}, approval: {mutate: vi.fn(async () => undefined)}, cancel: {mutate: vi.fn(async () => undefined)},
  };
  return client;
};
const request = {serverId: 'bits-and-bolts', name: 'cad.tray', kind: 'thread' as const, chatId: '01a1559f-4018-7caf-86dc-3d1f36012afb'};

describe('launchConnectedApp', () => {
  it('returns to an open instance without running the tool', async () => {
    const client = fake();
    client.prepare.mutate.mockResolvedValue({kind: 'open', captureId: 'capture'});
    const ask = vi.fn();
    expect(await launchConnectedApp(request, ask, {client: client as never})).toEqual({captureId: 'capture', deepLink: null, reused: true});
    expect(client.launch.mutate).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks for approval, then retries the same invocation', async () => {
    const client = fake();
    client.prepare.mutate.mockResolvedValue({kind: 'launch', viewId: 'view', invocationId: 'invocation'});
    client.launch.mutate.mockResolvedValueOnce({kind: 'approval', viewId: 'view', ids: ['approval'], preview: {tool: 'cad.tray'}}).mockResolvedValueOnce({kind: 'opened', captureId: 'invocation'});
    const ask = vi.fn(async () => true);
    expect(await launchConnectedApp(request, ask, {client: client as never})).toEqual({captureId: 'invocation', reused: false});
    expect(ask).toHaveBeenCalledWith({ids: ['approval'], preview: {tool: 'cad.tray'}});
    expect(client.approval.mutate).toHaveBeenCalledWith({viewId: 'view', ids: ['approval'], approve: true});
    expect(client.launch.mutate).toHaveBeenCalledTimes(2);
    expect(client.cancel.mutate).not.toHaveBeenCalled();
  });

  it('cancels a declined launch and says nothing ran', async () => {
    const client = fake();
    client.prepare.mutate.mockResolvedValue({kind: 'launch', viewId: 'view', invocationId: 'invocation'});
    client.launch.mutate.mockResolvedValue({kind: 'approval', viewId: 'view', ids: ['approval']});
    await expect(launchConnectedApp(request, async () => false, {client: client as never})).rejects.toBeInstanceOf(LaunchDeclined);
    expect(client.approval.mutate).toHaveBeenCalledWith({viewId: 'view', ids: ['approval'], approve: false});
    expect(client.cancel.mutate).toHaveBeenCalledWith({viewId: 'view', invocationId: 'invocation'});
  });

  it('cancels when the person leaves before it opens', async () => {
    const client = fake();
    const controller = new AbortController();
    client.prepare.mutate.mockResolvedValue({kind: 'launch', viewId: 'view', invocationId: 'invocation'});
    client.launch.mutate.mockResolvedValue({kind: 'approval', viewId: 'view', ids: ['approval']});
    const ask = () => new Promise<boolean>(() => { controller.abort(); });
    void launchConnectedApp(request, ask, {client: client as never, signal: controller.signal}).catch(() => {});
    await vi.waitFor(() => expect(client.cancel.mutate).toHaveBeenCalledWith({viewId: 'view', invocationId: 'invocation'}));
  });
});
