import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

export const DESKTOP_OAUTH_TTL = 10 * 60_000;
export type DesktopOAuthStatus = 'connected' | 'cancelled' | 'error';
export interface DesktopOAuthResult {
  sequence: number;
  id: string;
  status: DesktopOAuthStatus;
  returnTo: string;
  message: string;
}
export interface DesktopOAuthFlow {
  id: string;
  redirectUri: string;
  arm(state: string, complete: (params: URLSearchParams) => Promise<void>): void;
  cancel(notify?: boolean): void;
}

export function desktopEnabled() { return process.env.RI_DESKTOP === '1'; }

export function safeReturnPath(raw?: string | null) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/?settings=connectors';
  const url = new URL(raw, 'https://ri.invalid');
  return url.origin === 'https://ri.invalid' ? `${url.pathname}${url.search}` : '/?settings=connectors';
}

/** A callback carries an authorization code, never access/refresh tokens or a return URL. */
export function callbackParams(raw: URLSearchParams): URLSearchParams {
  if ([...raw].length > 24 || raw.toString().length > 16_384) throw new Error('Invalid callback');
  const result = new URLSearchParams();
  for (const [key, value] of raw) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key) || value.length > 4096 || result.has(key)) throw new Error('Invalid callback');
    if (/token|secret|verifier|redirect|return/i.test(key)) throw new Error('Invalid callback');
    result.set(key, value);
  }
  if (!result.get('state') || (!result.get('code') && !result.get('error'))) throw new Error('Invalid callback');
  return result;
}

export function sameState(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

interface Pending {
  id: string;
  key: string;
  state?: string;
  returnTo: string;
  complete?: (params: URLSearchParams) => Promise<void>;
  server?: http.Server;
  timer?: ReturnType<typeof setTimeout>;
}

/** One per Next process, shared across route chunks through globalThis below. */
export class DesktopOAuthManager {
  private pending = new Map<string, Pending>();
  private listeners = new Set<(result: DesktopOAuthResult) => void>();
  private history: DesktopOAuthResult[] = [];
  private sequence = 0;
  private completing = new Set<string>();
  private starting = new Set<string>();

  constructor(private ttlMs = DESKTOP_OAUTH_TTL) {}

  subscribe(after: number, listener: (result: DesktopOAuthResult) => void) {
    this.listeners.add(listener);
    for (const result of this.history) if (result.sequence > after) listener(result);
    return () => { this.listeners.delete(listener); };
  }

  private finish(flow: Pending, status: DesktopOAuthStatus, message: string, notify = true) {
    this.pending.delete(flow.id);
    clearTimeout(flow.timer);
    flow.server?.close();
    flow.server?.closeIdleConnections();
    if (!notify) return;
    const result = { sequence: ++this.sequence, id: flow.id, status, returnTo: flow.returnTo, message };
    this.history.push(result);
    if (this.history.length > 50) this.history.shift();
    for (const listener of this.listeners) listener(result);
  }

  cancel(id: string, notify = true) {
    const flow = this.pending.get(id);
    if (!flow) return false;
    this.finish(flow, 'cancelled', 'Connection cancelled', notify);
    return true;
  }

  async begin(key: string, options: { returnTo?: string | null; relayUrl?: string } = {}): Promise<DesktopOAuthFlow> {
    if (this.starting.has(key)) throw new Error('This connection is starting. Please wait a moment.');
    if (this.completing.has(key)) throw new Error('This connection is finishing. Please wait a moment.');
    for (const previous of this.pending.values()) if (previous.key === key) this.cancel(previous.id, false);
    if (this.pending.size + this.starting.size >= 8) throw new Error('Too many connections are waiting for sign-in');
    this.starting.add(key);
    try {
      const flow: Pending = { id: randomBytes(24).toString('base64url'), key, returnTo: safeReturnPath(options.returnTo) };
      let redirectUri: string;
      if (options.relayUrl) {
        const relay = new URL(options.relayUrl);
        if (relay.protocol !== 'https:' || relay.username || relay.password || relay.search || relay.hash) throw new Error('The desktop callback service must use HTTPS');
        redirectUri = relay.href;
      } else {
        const server = http.createServer(async (request, response) => {
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('Referrer-Policy', 'no-referrer');
          response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          const address = server.address();
          const host = typeof address === 'object' && address ? `127.0.0.1:${address.port}` : '';
          if (request.method !== 'GET' || request.headers.host !== host) { response.writeHead(400).end('Invalid callback'); return; }
          const url = new URL(request.url ?? '/', `http://${host}`);
          if (url.pathname !== '/oauth/callback') { response.writeHead(404).end('Not found'); return; }
          try {
            const result = await this.complete(callbackParams(url.searchParams), flow.id);
            if (!result) { response.writeHead(400).end('This sign-in link is invalid or has expired. Return to Ri and try again.'); return; }
            response.end('You can return to Ri. This tab can be closed.');
          } catch { response.writeHead(400).end('Invalid callback'); }
        });
        server.requestTimeout = 15_000;
        server.headersTimeout = 10_000;
        server.maxHeadersCount = 30;
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
        });
        flow.server = server;
        redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}/oauth/callback`;
      }
      flow.timer = setTimeout(() => this.finish(flow, 'error', 'Sign-in expired. Please try again.'), this.ttlMs);
      flow.timer.unref();
      this.pending.set(flow.id, flow);
      return {
        id: flow.id, redirectUri,
        arm: (state, complete) => {
          if (!this.pending.has(flow.id)) throw new Error('Sign-in expired');
          if (!state || state.length > 4096) throw new Error('Invalid OAuth state');
          flow.state = state;
          flow.complete = complete;
        },
        cancel: (notify = false) => { this.cancel(flow.id, notify); },
      };
    } finally { this.starting.delete(key); }
  }

  async complete(params: URLSearchParams, expectedId?: string): Promise<boolean> {
    const state = params.get('state');
    if (!state) return false;
    const flow = [...this.pending.values()].find((item) => item.state && sameState(item.state, state) && (!expectedId || item.id === expectedId));
    if (!flow?.complete) return false;
    // Consume before exchanging. Replays and simultaneous callbacks cannot exchange twice.
    this.pending.delete(flow.id);
    clearTimeout(flow.timer);
    if (params.has('error')) {
      this.finish(flow, 'cancelled', 'Connection cancelled');
      return true;
    }
    if (!params.get('code')) { this.finish(flow, 'error', 'Sign-in did not return an authorization code'); return true; }
    try {
      this.completing.add(flow.key);
      await flow.complete(params);
      this.finish(flow, 'connected', 'Connected');
    } catch {
      this.finish(flow, 'error', 'Connection failed. Please try again.');
    } finally {
      this.completing.delete(flow.key);
    }
    return true;
  }

  close() {
    for (const id of this.pending.keys()) this.cancel(id, false);
    this.listeners.clear();
  }
}

const globalState = globalThis as typeof globalThis & { __riDesktopOAuth?: DesktopOAuthManager };
export function desktopOAuth() { return (globalState.__riDesktopOAuth ??= new DesktopOAuthManager()); }

/** Non-PKCE web clients require an operator-hosted redirect, not a public native client. */
export function desktopRelayFor(providerId: string, supportsPkce: boolean) {
  const forced = (process.env.RI_DESKTOP_OAUTH_RELAY_PROVIDERS ?? '').split(',').map((s) => s.trim());
  if (supportsPkce && !forced.includes(providerId)) return undefined;
  const relay = process.env.RI_DESKTOP_OAUTH_RELAY_URL;
  if (!relay) throw new Error('This provider needs a hosted callback. Configure RI_DESKTOP_OAUTH_RELAY_URL and register that address with your OAuth app.');
  return relay;
}
