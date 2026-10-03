import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { AnyRouter } from '@trpc/server';

/** Published by Next instrumentation, so sockets use Next's domain runtime,
 * rather than a second bundled router in the custom HTTP host. */
export interface WebSocketRuntime {
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): Promise<void>;
}
declare global { var __riTRPCWebSocket: WebSocketRuntime | undefined; }
declare global { var __riTRPCRouter: AnyRouter | undefined; }
export const TRPC_WS_PATH = '/api/trpc/ws';

export function hasWebSocketRuntime(): boolean {
  return process.env.RI_TRPC_WS_DISABLED !== '1' && globalThis.__riTRPCWebSocket !== undefined;
}

/** HTTP route hot reload publishes the newest router. Existing sockets read
 * its definition on each procedure, rather than retaining removed schemas. */
export function publishApplicationRouter(router: AnyRouter): void {
  globalThis.__riTRPCRouter = router;
}
export function liveApplicationRouter<T extends AnyRouter>(fallback: T): T {
  return new Proxy(fallback, { get: (target, key) => Reflect.get(globalThis.__riTRPCRouter ?? target, key) });
}
