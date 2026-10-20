import { describe, expect, it } from 'vitest';
import { cspSource, declaredCsp, declaresNetwork, NO_NETWORK, viewPolicy } from '@ri/mcp-apps-host/csp';

describe('a view\'s declared network', () => {
  it('reads both specs\' declarations and joins them', () => {
    // Excalidraw (MCP Apps) and Bits & Bolts' remote build (both specs, the same origin twice).
    expect(declaredCsp({ ui: { csp: { resourceDomains: ['https://esm.sh'], connectDomains: ['https://esm.sh'] } } }))
      .toEqual({ connectDomains: ['https://esm.sh'], resourceDomains: ['https://esm.sh'], frameDomains: [], baseUriDomains: [] });
    expect(declaredCsp({ 'openai/widgetCSP': { connect_domains: ['http://localhost:3916'], resource_domains: ['http://localhost:3916'], frame_domains: ['https://www.youtube.com'] },
      ui: { csp: { connectDomains: ['http://localhost:3916'], baseUriDomains: ['https://cdn.example.com'] } } }))
      .toEqual({ connectDomains: ['http://localhost:3916'], resourceDomains: ['http://localhost:3916'], frameDomains: ['https://www.youtube.com'], baseUriDomains: ['https://cdn.example.com'] });
    expect(declaredCsp(undefined)).toEqual(NO_NETWORK);
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
});
