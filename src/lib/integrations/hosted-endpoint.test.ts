import { describe, expect, it } from 'vitest';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { hostedMcpEndpointSetup, hostedMcpUrlMatches, resolveHostedMcpUrl, trustHostedMcpAnnotations } from './hosted-endpoint';

const atlassian = getHostedMcpProvider('atlassian')!;
const intercom = getHostedMcpProvider('intercom')!;
const n8n = getHostedMcpProvider('n8n')!;

describe('hosted endpoint resolution', () => {
  it('keeps fixed Atlassian discovery parameters pinned exactly', () => {
    const url = 'https://mcp.atlassian.com/v2/mcp?tools=all';
    expect(resolveHostedMcpUrl(atlassian)).toBe(url);
    expect(hostedMcpUrlMatches(atlassian, url)).toBe(true);
    for (const changed of [url.replace('?tools=all', ''), `${url}&extra=1`, url.replace('tools=all', 'tools=other')]) {
      expect(hostedMcpUrlMatches(atlassian, changed)).toBe(false);
    }
    expect(() => resolveHostedMcpUrl(atlassian, { instanceUrl: url })).toThrow('fixed service address');
    expect(() => resolveHostedMcpUrl(atlassian, { endpointId: 'us' })).toThrow('fixed service address');
    expect(hostedMcpEndpointSetup(atlassian)).toBeUndefined();
  });

  it('requires an explicit catalog region and never accepts a replacement URL', () => {
    expect(resolveHostedMcpUrl(intercom, { endpointId: 'us' })).toBe('https://mcp.intercom.com/mcp');
    expect(resolveHostedMcpUrl(intercom, { endpointId: 'eu' })).toBe('https://mcp.eu.intercom.com/mcp');
    for (const endpointId of [undefined, null, '', 'other', 'https://attacker.example', 1]) {
      expect(() => resolveHostedMcpUrl(intercom, { endpointId })).toThrow('supported workspace region');
    }
    expect(() => resolveHostedMcpUrl(intercom, { endpointId: 'us', instanceUrl: 'https://attacker.example' })).toThrow('not an instance URL');
    expect(hostedMcpUrlMatches(intercom, 'https://mcp.eu.intercom.com/mcp')).toBe(true);
    expect(hostedMcpUrlMatches(intercom, 'https://mcp.intercom.com/mcp?region=eu')).toBe(false);
    expect(hostedMcpUrlMatches(intercom, 'https://mcp.eu.intercom.com.attacker.example/mcp')).toBe(false);
  });

  it.each([
    ['https://example.app.n8n.cloud', 'https://example.app.n8n.cloud/mcp-server/http'],
    ['https://EXAMPLE.app.n8n.cloud:443/', 'https://example.app.n8n.cloud/mcp-server/http'],
    ['https://automation.example/n8n/', 'https://automation.example/n8n/mcp-server/http'],
    ['https://automation.example/n8n/mcp-server/http/', 'https://automation.example/n8n/mcp-server/http'],
    ['http://localhost:5678', 'http://localhost:5678/mcp-server/http'],
    ['http://127.0.0.1:5678/', 'http://127.0.0.1:5678/mcp-server/http'],
    ['http://[::1]:5678/', 'http://[::1]:5678/mcp-server/http'],
  ])('normalizes n8n instance %s once', (input, expected) => {
    expect(resolveHostedMcpUrl(n8n, { instanceUrl: input })).toBe(expected);
    expect(resolveHostedMcpUrl(n8n, { instanceUrl: expected })).toBe(expected);
    expect(hostedMcpUrlMatches(n8n, expected)).toBe(true);
  });

  it.each([
    undefined, null, 42, '', 'not-a-url', 'ftp://automation.example', 'javascript:alert(1)',
    'http://automation.example', 'http://127.0.0.1.attacker.example', 'http://0.0.0.0:5678',
    'https://user:password@automation.example', 'https://user@automation.example',
    'https://automation.example?token=secret', 'https://automation.example#secret',
    'https://automation.example?', 'https://automation.example#',
    'https://automation.example/path with space', 'https://automation.example/line\nbreak',
    'https://automation.example\\other', 'https://automation.example/a%2fb', 'https://automation.example/a%5cb',
  ])('rejects malformed or credential-bearing n8n instance %j', (instanceUrl) => {
    expect(() => resolveHostedMcpUrl(n8n, { instanceUrl })).toThrow();
  });

  it('requires an instance selection and distrusts server annotations', () => {
    expect(() => resolveHostedMcpUrl(n8n)).toThrow('instance URL is required');
    expect(() => resolveHostedMcpUrl(n8n, { endpointId: 'us', instanceUrl: 'https://automation.example' })).toThrow('not a region');
    expect(hostedMcpUrlMatches(n8n, 'https://automation.example')).toBe(false);
    expect(hostedMcpUrlMatches(n8n, 'https://automation.example/mcp-server/http?token=secret')).toBe(false);
    expect(trustHostedMcpAnnotations(n8n)).toBe(false);
    expect(trustHostedMcpAnnotations(intercom)).toBe(true);
    expect(trustHostedMcpAnnotations(atlassian)).toBe(true);
  });
});

describe('public endpoint setup metadata', () => {
  it('requires a fresh selection, then exposes only the frozen region', () => {
    const setup = hostedMcpEndpointSetup(intercom);
    expect(setup).toEqual({ kind: 'region', label: 'Workspace region', locked: false,
      options: [{ id: 'us', label: 'United States' }, { id: 'eu', label: 'Europe' }] });
    expect(setup).not.toHaveProperty('selectedId');
    expect(hostedMcpEndpointSetup(intercom, { url: 'https://mcp.eu.intercom.com/mcp' })).toMatchObject({ selectedId: 'eu', locked: true });
    const invalid = hostedMcpEndpointSetup(intercom, { url: 'https://attacker.example/mcp' });
    expect(invalid).toMatchObject({ locked: true });
    expect(invalid).not.toHaveProperty('selectedId');
  });

  it('shows the chosen instance base without exposing OAuth data', () => {
    expect(hostedMcpEndpointSetup(n8n)).toMatchObject({ kind: 'instance', locked: false });
    expect(hostedMcpEndpointSetup(n8n)).not.toHaveProperty('selectedUrl');
    expect(hostedMcpEndpointSetup(n8n, { url: 'https://automation.example/n8n/mcp-server/http' })).toEqual({
      kind: 'instance', label: 'Instance URL', placeholder: 'https://your-instance.app.n8n.cloud',
      selectedUrl: 'https://automation.example/n8n', locked: true,
    });
    const invalid = hostedMcpEndpointSetup(n8n, { url: 'https://user:secret@automation.example/mcp-server/http' });
    expect(invalid).toMatchObject({ locked: true });
    expect(invalid).not.toHaveProperty('selectedUrl');
    expect(JSON.stringify(invalid)).not.toContain('secret');
  });
});
