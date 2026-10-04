import { createTRPCClient, TRPCClientError, wsLink, createWSClient, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { ApiClient, ApiError } from '@/lib/api/client';
import { reportApiCompatibility } from '@/lib/client/api-compatibility';
import { reportReachable, reportNetworkFailure } from '@/lib/api/connectivity';
import type { AppRouter } from './router';
import { getTransportMode, recordTransportRequest, reportTransportStatus, subscribeTransportMode, type TransportMode } from './transport-state';

export class UnconfirmedWebSocketWrite extends ApiError {
  constructor() {
    super(424, { code: 'unconfirmed_write', error: 'unconfirmed_write', message: 'The connection closed before this write was confirmed. It may have reached Home. Check the result before retrying.' }, '/api/trpc/ws');
    this.name = 'UnconfirmedWebSocketWrite';
  }
}

interface Options {
  url: string;
  transport: ApiClient;
  http: TRPCLink<AppRouter>;
  getMode?: () => TransportMode;
  WebSocket?: typeof WebSocket;
}
type Socket = { client: ReturnType<typeof createWSClient>; link: TRPCLink<AppRouter>; active: number; retired: boolean; credentials: string };

/** Only confirmed connections receive new writes. Sent mutations are never
 * replayed on HTTP. tRPC reconnects subscriptions with tracked replay cursors. */
export function createTransportLink(options: Options): { link: TRPCLink<AppRouter>; close: () => Promise<void> } {
  const mode = options.getMode ?? getTransportMode;
  let socket: Socket | undefined;
  let opening: Promise<Socket | undefined> | undefined;
  let generation = 0;
  let coolingUntil = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let attempt: { stop: AbortController; candidate?: Socket } | undefined;
  const doc = typeof document === 'undefined' ? undefined : document;
  let hidden = doc?.visibilityState === 'hidden';
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<() => void>();
  const retire = () => {
    generation++;
    const old = socket;
    socket = undefined;
    opening = undefined;
    if (attempt) {
      if (attempt.candidate) attempt.candidate.retired = true;
      attempt.stop.abort();
      void attempt.candidate?.client.close();
      attempt = undefined;
    }
    if (old) { old.retired = true; if (old.active === 0) void old.client.close(); }
  };
  const fallback = (reason: string, network = true) => {
    if (disposed) return;
    retire();
    coolingUntil = Date.now() + 30_000;
    if (mode() !== 'websocket') return;
    reportTransportStatus({ state: 'fallback', reason });
    if (network && typeof window !== 'undefined') void reportNetworkFailure();
    if (retry) clearTimeout(retry);
    retry = setTimeout(() => { retry = undefined; if (!disposed && mode() === 'websocket') void ensure(); }, 30_000);
    retry.unref?.();
  };
  const recoverError = (error: unknown) => {
    if (!(error instanceof TRPCClientError)) return;
    const data = (error as TRPCClientError<AppRouter>).data;
    if (data?.httpStatus === 401) options.transport.unauthorized();
    if (data?.httpStatus === 426) reportApiCompatibility(data.body);
  };
  const httpClient = createTRPCClient<AppRouter>({ links: [options.http] });
  async function ensure(): Promise<Socket | undefined> {
    if (disposed || hidden || mode() !== 'websocket' || Date.now() < coolingUntil || (!options.WebSocket && typeof WebSocket === 'undefined')) return;
    if (socket && !socket.retired) {
      if (socket.credentials === JSON.stringify(options.transport.connectionParams())) return socket;
      retire();
    }
    if (opening) return opening;
    const version = generation;
    const setup = { stop: new AbortController(), candidate: undefined as Socket | undefined };
    attempt = setup;
    const setupSignal = AbortSignal.any([setup.stop.signal, AbortSignal.timeout(5_000)]);
    opening = (async () => {
      let candidate: Socket | undefined;
      try {
        reportTransportStatus({ state: 'connecting', reason: null });
        const capability = await httpClient.transport.capabilities.query(undefined, { signal: setupSignal });
        if (!capability.websocket) { fallback('This Home does not support WebSocket transport. Using HTTP.', false); return; }
        if (disposed || version !== generation || mode() !== 'websocket') return;
        const url = new URL(options.url, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
        url.pathname = url.pathname.replace(/\/$/, '') + '/ws';
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const client = createWSClient({
          url: url.toString(), WebSocket: options.WebSocket,
          connectionParams: () => options.transport.connectionParams(),
          lazy: { enabled: true, closeMs: 60_000 },
          keepAlive: { enabled: true, intervalMs: 25_000, pongTimeoutMs: 5_000 },
          // Recovery is handled by the circuit and SSE bridge. Do not
          // leave a second background reconnect loop running after fallback.
          onClose: () => { if (candidate && !candidate.retired && !disposed) fallback('WebSocket disconnected. Using HTTP while reconnecting.'); },
          onError: () => { if (candidate && !candidate.retired && !disposed) fallback('WebSocket could not connect. Using HTTP while reconnecting.'); },
        });
        candidate = { client, link: wsLink<AppRouter>({ client }), active: 0, retired: false, credentials: JSON.stringify(options.transport.connectionParams()) };
        setup.candidate = candidate;
        const handshake = createTRPCClient<AppRouter>({ links: [candidate.link] });
        // A successful upgrade is not an authenticated connection. Await an
        // authorized procedure before routing any application mutation here.
        await handshake.transport.ping.query(undefined, { signal: setupSignal });
        if (disposed || version !== generation || mode() !== 'websocket' || candidate.retired) { candidate.retired = true; await client.close(); return; }
        socket = candidate;
        reportReachable();
        reportTransportStatus({ state: 'websocket', reason: null });
        return candidate;
      } catch (error) {
        recoverError(error);
        if (candidate) { candidate.retired = true; void candidate.client.close(); }
        if (version === generation) fallback('WebSocket is unavailable. Using HTTP while reconnecting.');
        return;
      } finally { if (version === generation) opening = undefined; if (attempt === setup) attempt = undefined; }
    })();
    return opening;
  }
  const unsubscribe = options.getMode ? () => {} : subscribeTransportMode(() => {
    if (mode() === 'http') {
      coolingUntil = 0;
      if (retry) clearTimeout(retry);
      retire();
      reportTransportStatus({ state: 'http', reason: null });
    } else if (!socket && !opening && Date.now() >= coolingUntil) void ensure();
  });
  const visibility = () => {
    if (doc?.visibilityState === 'hidden') {
      if (hiddenTimer || hidden) return;
      hiddenTimer = setTimeout(() => {
        hiddenTimer = undefined;
        hidden = true;
        retire();
        if (mode() === 'websocket') reportTransportStatus({ state: 'fallback', reason: 'Using HTTP while this view is in the background.' });
      }, 5_000);
    } else {
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = undefined;
      hidden = false;
      if (mode() === 'websocket') void ensure();
    }
  };
  doc?.addEventListener('visibilitychange', visibility);

  const link: TRPCLink<AppRouter> = runtime => {
    const http = options.http(runtime);
    return ({ op, next }) => observable(observer => {
      let ended = false;
      let inner: { unsubscribe(): void } | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let active: Socket | undefined;
      const cleanup = () => {
        if (ended) return;
        ended = true;
        if (timer) clearTimeout(timer);
        op.signal?.removeEventListener('abort', abort);
        pending.delete(abort);
        inner?.unsubscribe();
        if (active) {
          active.active--;
          if (active.retired && active.active === 0) void active.client.close();
          active = undefined;
        }
      };
      const abort = () => {
        if (ended) return;
        observer.error(TRPCClientError.from(op.type === 'mutation' && active ? new UnconfirmedWebSocketWrite() : new Error('Request cancelled')));
        cleanup();
      };
      pending.add(abort);
      op.signal?.addEventListener('abort', abort, { once: true });
      if (op.signal?.aborted) { abort(); return cleanup; }
      const sendHttp = () => {
        if (ended) return;
        if (op.type === 'subscription') { observer.error(TRPCClientError.from(new Error('Use the SSE terminal fallback.'))); cleanup(); return; }
        const started = performance.now();
        inner = http({ op, next }).subscribe({
          next(value) { recordTransportRequest('http', performance.now() - started); observer.next(value); },
          error(error) { observer.error(error); cleanup(); },
          complete() { observer.complete(); cleanup(); },
        });
      };
      if (mode() === 'http') {
        if (socket || opening) retire();
        reportTransportStatus({ state: 'http', reason: null });
        sendHttp();
        return cleanup;
      }
      if (op.context.headers !== undefined || op.context.httpOnly) { sendHttp(); return cleanup; }
      void ensure().then(ready => {
        if (ended) return;
        if (!ready || ready.retired || mode() !== 'websocket') { sendHttp(); return; }
        active = ready;
        ready.active++;
        const started = performance.now();
        let counted = false;
        if (op.type !== 'subscription' && !op.signal) timer = setTimeout(abort, 120_000);
        inner = ready.link(runtime)({ op, next }).subscribe({
          next(value) { if (!counted && op.type !== 'subscription' && value.result.type === 'data') { counted = true; recordTransportRequest('websocket', performance.now() - started); } observer.next(value); },
          error(error) {
            if (ended) return;
            recoverError(error);
            const network = error.data === undefined;
            if (!network) { observer.error(error); cleanup(); return; }
            inner?.unsubscribe();
            if (timer) clearTimeout(timer);
            ready.active--;
            active = undefined;
            fallback('WebSocket disconnected. Using HTTP while reconnecting.');
            if (ready.retired && ready.active === 0) void ready.client.close();
            if (op.type === 'query') sendHttp();
            else { observer.error(op.type === 'mutation' ? TRPCClientError.from(new UnconfirmedWebSocketWrite()) : error); cleanup(); }
          },
          complete() { if (!ended) { observer.complete(); cleanup(); } },
        });
      }).catch(error => { observer.error(TRPCClientError.from(error)); cleanup(); });
      return cleanup;
    });
  };
  return {
    link,
    async close() {
      disposed = true;
      unsubscribe();
      doc?.removeEventListener('visibilitychange', visibility);
      if (hiddenTimer) clearTimeout(hiddenTimer);
      if (retry) clearTimeout(retry);
      const old = socket;
      for (const cancel of [...pending]) cancel();
      retire();
      await old?.client.close();
    },
  };
}
