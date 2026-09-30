import { describe, expect, it } from 'vitest';
import type { HostedMcpEndpointSetup } from '@connectors/engine/providers';
import { connectorEndpointReady, connectorEndpointSelection } from './connector-endpoint';

const region: HostedMcpEndpointSetup = {
  kind: 'region', label: 'Workspace region', locked: false,
  options: [{ id: 'us', label: 'United States' }, { id: 'eu', label: 'Europe' }],
};
const instance: HostedMcpEndpointSetup = { kind: 'instance', label: 'Instance URL', placeholder: 'https://example.com', locked: false };

describe('hosted endpoint form selection', () => {
  it('requires an explicit valid region and never selects the first option implicitly', () => {
    expect(connectorEndpointReady(region)).toBe(false);
    expect(() => connectorEndpointSelection(region, { endpointId: 'au' })).toThrow('Choose workspace region');
    expect(connectorEndpointSelection(region, { endpointId: 'eu' })).toEqual({ endpointId: 'eu' });
  });

  it('uses saved endpoint values for reconnects even if stale drafts contain other values', () => {
    expect(connectorEndpointSelection({ ...region, selectedId: 'eu', locked: true }, { endpointId: 'us' })).toEqual({ endpointId: 'eu' });
    expect(connectorEndpointSelection({ ...instance, selectedUrl: 'https://team.n8n.example', locked: true }, { instanceUrl: 'https://other.example' })).toEqual({ instanceUrl: 'https://team.n8n.example' });
  });

  it.each(['', 'example.com', 'https://user:password@example.com', 'https://example.com?token=secret', 'https://example.com#token', 'file:///tmp/server', 'http://remote.example', 'https://example.com?', 'https://example.com\\mcp', 'https://example.com/path with spaces'])('rejects invalid or credential-bearing instance input %s before a request', (instanceUrl) => {
    expect(connectorEndpointReady(instance, { instanceUrl })).toBe(false);
    expect(() => connectorEndpointSelection(instance, { instanceUrl })).toThrow();
  });

  it('trims instance input without changing its server path', () => {
    expect(connectorEndpointSelection(instance, { instanceUrl: '  https://team.example/n8n  ' })).toEqual({ instanceUrl: 'https://team.example/n8n' });
  });

  it('permits a local development instance over HTTP', () => {
    expect(connectorEndpointReady(instance, { instanceUrl: 'http://localhost:5678' })).toBe(true);
  });

  it('does not forward endpoint-like fields for a fixed provider', () => {
    expect(connectorEndpointSelection(undefined, { endpointId: 'eu', instanceUrl: 'https://other.example' })).toEqual({});
  });
});
