import { expect, it, vi } from 'vitest';
import { createIntegrationRuntime, type IntegrationRuntimeOptions } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { inMemoryStore, plaintextSecretBox } from '../testing';
import { ingestMcpServer } from '../mcp';
import { staticOAuthApps } from '../oauth-apps';

it('captures completed MCP results for the resolved account without exposing private data to the model or audit', async () => {
  const registry = createRegistry(), store = inMemoryStore(), secretBox = plaintextSecretBox();
  const capture = vi.fn(), audit = vi.fn(), call = vi.fn(async () => ({content: [{type: 'text', text: 'Model summary'}], structuredContent: {value: 7}, _meta: {privateUi: 'only the view'}}));
  const prepare = vi.fn<NonNullable<IntegrationRuntimeOptions['prepareMcpResult']>>(async () => capture);
  const runtime = createIntegrationRuntime({registry, store, authRequests: store, secretBox, oauthApps: staticOAuthApps({}), approval: {check: async () => 'allow'}, prepareMcpResult: prepare, onActionRun: audit});
  await ingestMcpServer(registry, store, secretBox, {name: 'fixture', client: {listTools: async () => ({tools: [{name: 'calculate', inputSchema: {type: 'object', properties: {amount: {type: 'number'}}, required: ['amount']}, _meta: {ui: {resourceUri: 'ui://fixture/index.html'}}}]}), callTool: call}});
  const caller = {type: 'mcp' as const, id: 'session:chat'};
  const result = await runtime.runAction('mcp.fixture.calculate', {amount: 2}, {caller});
  expect(result.ok).toBe(true);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(prepare.mock.calls[0][0]).toMatchObject({connectionId: (await store.list({}))[0]!.id, actionId: 'mcp.fixture.calculate', caller, audience: 'model', input: {amount: 2}});
  expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(call.mock.invocationCallOrder[0]!);
  expect(capture.mock.calls[0][0]).toMatchObject({_meta: {privateUi: 'only the view'}});
  expect(JSON.stringify(result)).not.toContain('only the view'); expect(JSON.stringify(audit.mock.calls)).not.toContain('only the view');
  await runtime.runAction('mcp.fixture.calculate', {amount: 'invalid'}, {caller});
  expect(call).toHaveBeenCalledTimes(1); expect(capture).toHaveBeenCalledTimes(1);
  capture.mockRejectedValueOnce(new Error('UI unavailable'));
  expect((await runtime.runAction('mcp.fixture.calculate', {amount: 3}, {caller})).ok).toBe(true);
  expect(call).toHaveBeenCalledTimes(2);
  prepare.mockRejectedValueOnce(new Error('Capture preparation unavailable'));
  expect((await runtime.runAction('mcp.fixture.calculate', {amount: 4}, {caller})).ok).toBe(true);
  expect(call).toHaveBeenCalledTimes(3); expect(capture).toHaveBeenCalledTimes(2);
});

it('keeps each originating operation bound to its pre-dispatch capture even when authority changes during the call', async () => {
  const registry = createRegistry(), store = inMemoryStore(), secretBox = plaintextSecretBox();
  let revision = 1;
  const captured: number[] = [], prepare = vi.fn(async () => {
    const admitted = revision;
    return async () => {if (revision !== admitted) throw new Error('Authority changed'); captured.push(admitted);};
  });
  const call = vi.fn(async () => {revision++; return {content: [{type: 'text', text: 'Completed once'}], _meta: {private: true}};});
  await ingestMcpServer(registry, store, secretBox, {name: 'fixture', client: {listTools: async () => ({tools: [{name: 'calculate'}]}), callTool: call}});
  const runtime = createIntegrationRuntime({registry, store, authRequests: store, secretBox, oauthApps: staticOAuthApps({}), approval: {check: async () => 'allow'}, prepareMcpResult: prepare});
  const result = await runtime.runAction('mcp.fixture.calculate', {});
  expect(result.ok).toBe(true); expect(JSON.stringify(result)).toContain('Completed once');
  expect(captured).toEqual([]); expect(call).toHaveBeenCalledTimes(1);
});
