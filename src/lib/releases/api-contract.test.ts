import { expect, it } from 'vitest';
import { apiCompatibilityIssue, hasIndependentProtocol } from './api-contract';
it('accepts compatible patch releases and explicitly interprets legacy callers as baseline 1', () => {
  expect(apiCompatibilityIssue('1', [1])).toBeNull();
  expect(apiCompatibilityIssue(null, [1, 2])).toBeNull();
  expect(apiCompatibilityIssue(null, [2])).toMatchObject({ update: 'client', protocol: 1 });
});
it('distinguishes stale clients, newer clients and invalid reports before writes', () => {
  expect(apiCompatibilityIssue('1', [2])).toMatchObject({ code: 'api_protocol', update: 'client' });
  expect(apiCompatibilityIssue('2', [1])).toMatchObject({ update: 'home' });
  expect(apiCompatibilityIssue('bogus', [1])).toMatchObject({ update: 'client', protocol: null });
});
it('exempts only explicit independently negotiated MCP transports', () => {
  for (const url of ['/api/mcp', '/api/sse', '/api/orchestrator/mcp', '/api/orchestrator/browser/mcp', '/api/connectors/mcp']) expect(hasIndependentProtocol(url)).toBe(true);
  for (const url of ['/api/tasks', '/api/connectors/run', '/api/orchestrator/mcp/anything', '/api/mcp/../tasks']) expect(hasIndependentProtocol(url)).toBe(false);
});
