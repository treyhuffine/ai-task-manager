import { describe, it, expect } from 'vitest';
import { resolvePreviewSrc, pickReachability, isLocalViewer, type BrowserLocation } from './resolve-iframe-src';
import type { PreviewState } from '@/lib/api/preview';

const LOCAL: BrowserLocation = { hostname: 'localhost', protocol: 'http:' };
const LOCAL_SUB: BrowserLocation = { hostname: 'flow-a3f9.localhost', protocol: 'http:' };
const REMOTE: BrowserLocation = { hostname: 'flow.example.com', protocol: 'https:' };

function state(partial: Partial<PreviewState>): PreviewState {
  return {
    executionId: 'ex1',
    service: null,
    previewName: 'flow-a3f9',
    assignedPort: 3000,
    serverStatus: 'running',
    port: 3000,
    message: null,
    localUrl: 'http://localhost:3000',
    pinned: false,
    activeRemoteProviderId: 'beamd',
    activeRemoteProviderLabel: 'Beam',
    remoteUrl: null,
    remoteError: null,
    manualUrls: [],
    ...partial,
  };
}

describe('isLocalViewer / pickReachability', () => {
  it('treats loopback + *.localhost as local', () => {
    expect(isLocalViewer(LOCAL)).toBe(true);
    expect(isLocalViewer({ hostname: '127.0.0.1', protocol: 'http:' })).toBe(true);
    expect(isLocalViewer(LOCAL_SUB)).toBe(true);
  });
  it('treats everything else as remote', () => {
    expect(isLocalViewer(REMOTE)).toBe(false);
    expect(isLocalViewer({ hostname: '100.74.1.2', protocol: 'https:' })).toBe(false);
  });
  it('maps to a reachability mode', () => {
    expect(pickReachability(LOCAL)).toBe('local');
    expect(pickReachability(REMOTE)).toBe('remote');
  });
});

describe('resolvePreviewSrc — local viewer', () => {
  it('uses the loopback URL when running', () => {
    const r = resolvePreviewSrc(state({}), LOCAL);
    expect(r).toEqual({ url: 'http://localhost:3000', mode: 'local', reason: 'local' });
  });
  it('reports not_running when the server is down', () => {
    const r = resolvePreviewSrc(state({ serverStatus: 'stopped', localUrl: null, port: null }), LOCAL);
    expect(r.url).toBeNull();
    expect(r.reason).toBe('not_running');
  });
  it('reports no_local_url when running but no port yet', () => {
    const r = resolvePreviewSrc(state({ serverStatus: 'running', localUrl: null, port: null }), LOCAL);
    expect(r.reason).toBe('no_local_url');
  });
});

describe('resolvePreviewSrc — remote viewer', () => {
  it('uses the remote provider URL once resolved', () => {
    const r = resolvePreviewSrc(state({ remoteUrl: 'https://flow-a3f9.beam.example' }), REMOTE);
    expect(r).toEqual({ url: 'https://flow-a3f9.beam.example', mode: 'remote', reason: 'remote' });
  });
  it('surfaces a remote error', () => {
    const r = resolvePreviewSrc(
      state({ remoteUrl: null, remoteError: { code: 'beamd_not_configured', message: 'x' } }),
      REMOTE,
    );
    expect(r.url).toBeNull();
    expect(r.reason).toBe('remote_error');
  });
  it('reports no_remote_url before the provider resolves', () => {
    const r = resolvePreviewSrc(state({ remoteUrl: null, remoteError: null }), REMOTE);
    expect(r.reason).toBe('no_remote_url');
  });
});

it('handles a null state (initial load)', () => {
  expect(resolvePreviewSrc(null, LOCAL).url).toBeNull();
  expect(resolvePreviewSrc(null, REMOTE).url).toBeNull();
});
