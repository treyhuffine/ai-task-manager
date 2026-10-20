import { describe, expect, it } from 'vitest';
import { cspSource, declaredCsp, declaresNetwork, isLocalNetworkSource, NO_NETWORK, viewPolicy } from '@ri/mcp-apps-host/csp';

describe('a view\'s declared network', () => {
  it('reads both specs\' declarations and joins them', () => {
    // Excalidraw (MCP Apps) and Bits & Bolts' remote build (both specs, the same origin twice).
    expect(declaredCsp({ ui: { csp: { resourceDomains: ['https://esm.sh'], connectDomains: ['https://esm.sh'] } } }))
      .toEqual({ connectDomains: ['https://esm.sh'], resourceDomains: ['https://esm.sh'], frameDomains: [], baseUriDomains: [], blocked: [] });
    expect(declaredCsp({ 'openai/widgetCSP': { connect_domains: ['http://localhost:3916'], resource_domains: ['http://localhost:3916'], frame_domains: ['https://www.youtube.com'] },
      ui: { csp: { connectDomains: ['http://localhost:3916'], baseUriDomains: ['https://cdn.example.com'] } } }, { serverIsLocal: true }))
      .toEqual({ connectDomains: ['http://localhost:3916'], resourceDomains: ['http://localhost:3916'], frameDomains: ['https://www.youtube.com'], baseUriDomains: ['https://cdn.example.com'], blocked: [] });
    expect(declaredCsp(undefined)).toEqual({ ...NO_NETWORK, blocked: [] });
    expect(declaresNetwork(NO_NETWORK)).toBe(false);
  });

  it('keeps only domains, so a declaration can\'t add to the policy', () => {
    expect(cspSource('https://*.cloudflare.com')).toBe('https://*.cloudflare.com');
    expect(cspSource('wss://Realtime.Service.com:8443/socket')).toBe('wss://realtime.service.com:8443');
    expect(cspSource('http://[::1]:3000')).toBe('http://[::1]:3000');
    for (const bad of ['*', "'unsafe-eval'", 'https://a.com; script-src *', 'https://a.com https://b.com', 'javascript:alert(1)', 'data:', 'esm.sh', 'https://', 42])
      expect(cspSource(bad)).toBeNull();
  });

  it('allows everything local and only the declared network', () => {
    const none = viewPolicy();
    expect(none).toContain("connect-src 'none'");
    expect(none).toContain("frame-src 'none'");
    expect(none).toContain("script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:;");
    expect(none).toContain("form-action 'none'");
    const esm = viewPolicy(declaredCsp({ ui: { csp: { resourceDomains: ['https://esm.sh'], connectDomains: ['https://esm.sh'] } } }));
    expect(esm).toContain("connect-src https://esm.sh");
    expect(esm).toContain("script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data: https://esm.sh");
    expect(esm).toContain("img-src blob: data: https://esm.sh");
    expect(esm).not.toContain('*;');
  });

  it('keeps a remote app off the person\'s computer and local network, and names what it left out', () => {
    for (const local of ['http://localhost:3000', 'http://ri.localhost', 'https://printer.local', 'https://*.local', 'http://127.0.0.1:8080', 'http://127.9.9.9', 'http://0.0.0.0:80',
      'http://10.0.0.5', 'http://172.16.4.2', 'http://172.31.255.1', 'http://192.168.1.1', 'http://169.254.169.254', 'http://[::1]:3000', 'http://[::]', 'http://[fd12:3456::1]', 'http://[fc00::2]',
      'http://[fe80::1]', 'http://[febf::1]', 'http://[::ffff:192.168.1.1]'])
      expect(isLocalNetworkSource(local), local).toBe(true);
    for (const remote of ['https://esm.sh', 'https://172.32.0.1', 'https://172.15.0.1', 'https://11.0.0.1', 'https://192.169.1.1', 'https://localhost.example.com', 'https://[2001:db8::1]', 'https://[::ffff:8.8.8.8]', 'https://*.cloudflare.com'])
      expect(isLocalNetworkSource(remote), remote).toBe(false);
    const meta = { ui: { csp: { connectDomains: ['https://api.example.com', 'http://localhost:3916', 'http://192.168.1.20:8123'], resourceDomains: ['http://localhost:3916', 'https://esm.sh'], frameDomains: ['http://router.local'] } } };
    expect(declaredCsp(meta)).toEqual({ connectDomains: ['https://api.example.com'], resourceDomains: ['https://esm.sh'], frameDomains: [], baseUriDomains: [],
      blocked: ['http://localhost:3916', 'http://192.168.1.20:8123', 'http://router.local'] });
    // An app whose server runs on this computer keeps them: that is where it lives.
    expect(declaredCsp(meta, { serverIsLocal: true }).blocked).toEqual([]);
    expect(declaredCsp(meta, { serverIsLocal: true }).connectDomains).toContain('http://localhost:3916');
  });
});
