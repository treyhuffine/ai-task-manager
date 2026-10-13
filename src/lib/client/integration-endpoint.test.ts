import { describe, expect, it } from 'vitest';
import type { HostedMcpEndpointSetup } from '@integrations/engine/providers';
import { integrationEndpointReady, integrationEndpointSelection } from './integration-endpoint';

const region: HostedMcpEndpointSetup = {
  kind: 'region', label: 'Workspace region', locked: false,
  options: [{ id: 'us', label: 'United States' }, { id: 'eu', label: 'Europe' }],
};
const instance: HostedMcpEndpointSetup = { kind: 'instance', label: 'Instance URL', placeholder: 'https://example.com', locked: false };

describe('hosted endpoint form selection', () => {
  it('requires an explicit valid region and never selects the first option implicitly', () => {
    expect(integrationEndpointReady(region)).toBe(false);
    expect(() => integrationEndpointSelection(region, { endpointId: 'au' })).toThrow('Choose workspace region');
    expect(integrationEndpointSelection(region, { endpointId: 'eu' })).toEqual({ endpointId: 'eu' });
  });

  it('uses saved endpoint values for reconnects even if stale drafts contain other values', () => {
    expect(integrationEndpointSelection({ ...region, selectedId: 'eu', locked: true }, { endpointId: 'us' })).toEqual({ endpointId: 'eu' });
    expect(integrationEndpointSelection({ ...instance, selectedUrl: 'https://team.n8n.example', locked: true }, { instanceUrl: 'https://other.example' })).toEqual({ instanceUrl: 'https://team.n8n.example' });
  });

  it.each(['', 'example.com', 'https://user:password@example.com', 'https://example.com?token=secret', 'https://example.com#token', 'file:///tmp/server', 'http://remote.example', 'https://example.com?', 'https://example.com\\mcp', 'https://example.com/path with spaces'])('rejects invalid or credential-bearing instance input %s before a request', (instanceUrl) => {
    expect(integrationEndpointReady(instance, { instanceUrl })).toBe(false);
    expect(() => integrationEndpointSelection(instance, { instanceUrl })).toThrow();
  });

  it('trims instance input without changing its server path', () => {
    expect(integrationEndpointSelection(instance, { instanceUrl: '  https://team.example/n8n  ' })).toEqual({ instanceUrl: 'https://team.example/n8n' });
  });

  it('permits a local development instance over HTTP', () => {
    expect(integrationEndpointReady(instance, { instanceUrl: 'http://localhost:5678' })).toBe(true);
  });

  it('does not forward endpoint-like fields for a fixed provider', () => {
    expect(integrationEndpointSelection(undefined, { endpointId: 'eu', instanceUrl: 'https://other.example' })).toEqual({});
  });
});


describe('deployment selection', () => {
  const setup = { kind: 'deployment' as const, label: 'Deployment', placeholder: 'https://seo.example', locked: false };
  it('defaults new accounts to hosted and requires a valid self-hosted URL', () => {
    expect(integrationEndpointSelection(setup)).toEqual({ endpointId: 'hosted' });
    expect(integrationEndpointReady(setup, { endpointId: 'selfhosted' })).toBe(false);
    expect(integrationEndpointSelection(setup, { endpointId: 'selfhosted', instanceUrl: 'http://localhost:3000', authMethod: 'none' })).toEqual({ endpointId: 'selfhosted', instanceUrl: 'http://localhost:3000', authMethod: 'none' });
    expect(integrationEndpointSelection(setup, { endpointId: 'selfhosted', instanceUrl: 'https://seo.example' })).toHaveProperty('authMethod', 'oauth');
  });
  it('uses saved deployment, URL and auth despite stale drafts', () => {
    const saved = { ...setup, locked: true, selectedId: 'selfhosted' as const, selectedUrl: 'https://saved.example', selectedAuthMethod: 'none' as const };
    expect(integrationEndpointSelection(saved, { endpointId: 'hosted', instanceUrl: 'https://wrong.example', authMethod: 'oauth' })).toEqual({ endpointId: 'selfhosted', instanceUrl: 'https://saved.example', authMethod: 'none' });
    expect(integrationEndpointSelection({ ...setup, locked: true, selectedId: 'hosted' }, { endpointId: 'selfhosted', instanceUrl: 'https://wrong.example', authMethod: 'none' })).toEqual({ endpointId: 'hosted' });
    expect(integrationEndpointReady({ ...setup, locked: true })).toBe(false);
  });
});
