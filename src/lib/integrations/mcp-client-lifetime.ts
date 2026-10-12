import { IntegrationError } from '@integrations/engine';
import type { ConnectedMcpClient } from '@integrations/engine/mcp';

/** Retiring a projection must not abort requests that may already have executed remotely. */
export function drainMcpClient(client: ConnectedMcpClient): ConnectedMcpClient {
  let active = 0;
  let retiring = false;
  let close: Promise<void> | undefined;
  let idle: (() => void) | undefined;

  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (retiring) throw new IntegrationError('tools_changed', 'The connection is refreshing. Refresh the available tools before trying again.');
    active += 1;
    try { return await operation(); }
    finally {
      active -= 1;
      if (active === 0) idle?.();
    }
  };

  return {
    // Discovery has its own deadline. A timed-out discovery must still be cancellable.
    listTools: () => client.listTools(),
    callTool: params => run(() => client.callTool(params)),
    readResource: params => run(() => client.readResource(params)),
    close() {
      if (close) return close;
      retiring = true;
      close = (async () => {
        // Tool calls and resource reads retain the SDK's finite operation deadlines.
        if (active > 0) await new Promise<void>(resolve => { idle = resolve; });
        await client.close();
      })();
      return close;
    },
  };
}
