import { describe, it, expect } from 'vitest';
import { resolveIframeSrc, type BrowserLocation } from './resolve-iframe-src';
import type { AppPreviewStatusResponse } from '@/lib/api/workspaces';

const WS = '019df8ea-15f8-7a5a-9c3e-91d4f8242745';
const PROXY = `/preview/${WS}/?_pt=tok`;

function status(overrides: Partial<AppPreviewStatusResponse>): AppPreviewStatusResponse {
  return {
    mode: 'command',
    status: 'running',
    port: 3000,
    preview_token: 'tok',
    ...overrides,
  };
}

function browser(host: string, scheme: 'http' | 'https' = 'http'): BrowserLocation {
  return { hostname: host, protocol: `${scheme}:` };
}

describe('resolveIframeSrc', () => {
  describe('not-running short-circuit', () => {
    it('returns proxy when status is null', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        // @ts-expect-error testing null
        status: null,
        pathProxyUrl: PROXY,
        browserLocation: browser('localhost'),
      });
      expect(r).toEqual({ url: PROXY, mode: 'proxy', reason: 'no_status' });
    });

    it('returns proxy when status.status !== "running"', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({ status: 'idle', port: null }),
        pathProxyUrl: PROXY,
        browserLocation: browser('localhost'),
      });
      expect(r.mode).toBe('proxy');
      expect(r.reason).toBe('not_running');
    });

    it('returns proxy when port is null even if status is running', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({ status: 'running', port: null }),
        pathProxyUrl: PROXY,
        browserLocation: browser('localhost'),
      });
      expect(r.mode).toBe('proxy');
      expect(r.reason).toBe('not_running');
    });

    it('returns proxy when no browser location (SSR)', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({}),
        pathProxyUrl: PROXY,
        browserLocation: null,
      });
      expect(r.mode).toBe('proxy');
      expect(r.reason).toBe('no_reachable_direct');
    });
  });

  describe('local browser', () => {
    it('direct-embeds Portless hostname when browser is on localhost', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({ mode: 'portless', hostname: 'myapp' }),
        pathProxyUrl: PROXY,
        browserLocation: browser('localhost'),
      });
      expect(r).toEqual({
        url: 'https://myapp.localhost',
        mode: 'direct',
        reason: 'local_portless',
      });
    });

    it('handles 127.0.0.1 as local', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({ mode: 'portless', hostname: 'myapp' }),
        pathProxyUrl: PROXY,
        browserLocation: browser('127.0.0.1'),
      });
      expect(r.mode).toBe('direct');
    });

    it('handles a *.localhost browser host (e.g. Portless-served Flow itself)', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({ mode: 'portless', hostname: 'myapp' }),
        pathProxyUrl: PROXY,
        browserLocation: browser('flow.localhost'),
      });
      expect(r.mode).toBe('direct');
    });

    it('direct-embeds command-mode loopback port locally', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({ mode: 'command', port: 5173 }),
        pathProxyUrl: PROXY,
        browserLocation: browser('localhost'),
      });
      expect(r).toEqual({
        url: 'http://localhost:5173',
        mode: 'direct',
        reason: 'local_command',
      });
    });

    it('falls back to proxy if Flow is HTTPS but the candidate is HTTP (mixed content)', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({ mode: 'command', port: 5173 }),
        pathProxyUrl: PROXY,
        browserLocation: browser('localhost', 'https'),
      });
      expect(r.mode).toBe('proxy');
      expect(r.reason).toBe('mixed_content');
    });

    it('HTTPS Flow + HTTPS Portless candidate is fine', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({ mode: 'portless', hostname: 'myapp' }),
        pathProxyUrl: PROXY,
        browserLocation: browser('localhost', 'https'),
      });
      expect(r.mode).toBe('direct');
    });

    it('falls back to proxy if portless mode has no hostname', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({ mode: 'portless', hostname: null, port: 4070 }),
        pathProxyUrl: PROXY,
        browserLocation: browser('localhost'),
      });
      expect(r.mode).toBe('proxy');
      expect(r.reason).toBe('no_reachable_direct');
    });
  });

  describe('tailnet browser', () => {
    it('direct-embeds the tailscaleUrl when browser is on the tailnet', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({
          mode: 'portless',
          hostname: 'myapp',
          tailscale_url: 'https://myapp.devbox.tailnet.ts.net',
        }),
        pathProxyUrl: PROXY,
        browserLocation: browser('devbox.tailnet.ts.net', 'https'),
      });
      expect(r).toEqual({
        url: 'https://myapp.devbox.tailnet.ts.net',
        mode: 'direct',
        reason: 'tailnet_direct',
      });
    });

    it('falls back to proxy on tailnet when no tailscaleUrl is registered', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({
          mode: 'portless',
          hostname: 'myapp',
          tailscale_url: null,
        }),
        pathProxyUrl: PROXY,
        browserLocation: browser('devbox.tailnet.ts.net', 'https'),
      });
      expect(r.mode).toBe('proxy');
      expect(r.reason).toBe('no_reachable_direct');
    });

    it('does NOT direct-embed tailscaleUrl when browser is on localhost (prefers local .localhost)', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({
          mode: 'portless',
          hostname: 'myapp',
          tailscale_url: 'https://myapp.devbox.tailnet.ts.net',
        }),
        pathProxyUrl: PROXY,
        browserLocation: browser('localhost'),
      });
      expect(r.url).toBe('https://myapp.localhost');
    });

    it('mixed-content guard on tailnet too', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({
          mode: 'portless',
          hostname: 'myapp',
          tailscale_url: 'http://myapp.devbox.tailnet.ts.net',  // weirdly http
        }),
        pathProxyUrl: PROXY,
        browserLocation: browser('devbox.tailnet.ts.net', 'https'),
      });
      expect(r.mode).toBe('proxy');
      expect(r.reason).toBe('mixed_content');
    });
  });

  describe('remote, non-tailnet browser', () => {
    it('falls back to proxy on ngrok', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({
          mode: 'portless',
          hostname: 'myapp',
          tailscale_url: 'https://myapp.devbox.tailnet.ts.net',
        }),
        pathProxyUrl: PROXY,
        browserLocation: browser('xxx.ngrok.io', 'https'),
      });
      expect(r.mode).toBe('proxy');
      expect(r.reason).toBe('no_reachable_direct');
    });

    it('falls back to proxy on LAN IP', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({ mode: 'portless', hostname: 'myapp' }),
        pathProxyUrl: PROXY,
        browserLocation: browser('192.168.1.42'),
      });
      expect(r.mode).toBe('proxy');
    });

    it('falls back to proxy on custom domains we cannot reason about', () => {
      const r = resolveIframeSrc({
        workspaceId: WS,
        status: status({ mode: 'portless', hostname: 'myapp' }),
        pathProxyUrl: PROXY,
        browserLocation: browser('flow.mycompany.com', 'https'),
      });
      expect(r.mode).toBe('proxy');
    });
  });
});
