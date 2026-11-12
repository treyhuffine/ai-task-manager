import { describe, expect, it } from 'vitest';
import { resolveIntegrationFilter, resolveRiIntegrationFilter } from './workspace-filter';
import { appPlaceAccountId, appToolkitId, isAppToolkitId, mcpToolkitId } from './mcp-servers';

/**
 * A personal app is one connector with one account per place (docs/personal-apps.md): Ri's own
 * chats, and each agent allowed to use it. Each place reaches the app only through its own
 * connection, so the access an app's consent screen gave one place never leaks to another.
 */

const toolkit = appToolkitId('reading_log');
const ri = { id: 'c-ri', ownerId: 'local', providerId: toolkit, accountId: appPlaceAccountId({ kind: 'ri' }) };
const family = { id: 'c-family', ownerId: 'local', providerId: toolkit, accountId: appPlaceAccountId({ kind: 'agent', workspaceId: 'ws-family' }) };
const work = { id: 'c-work', ownerId: 'local', providerId: toolkit, accountId: appPlaceAccountId({ kind: 'agent', workspaceId: 'ws-work' }) };
const gmail = { id: 'c-gmail', ownerId: 'local', providerId: 'google', accountId: 'sub', email: 'me@example.com' };

function runtime(connections: object[]) {
  return {
    getToolkits: () => [{ id: toolkit, providerId: toolkit }, { id: 'gmail', providerId: 'google' }] as never,
    listConnections: async () => connections as never,
    listAccountChoices: async () => [],
  };
}

describe('personal app connections', () => {
  it('names the connector after the app, shared by every place', () => {
    expect(mcpToolkitId({ slug: 'reading_log_at_ri', app: { id: 'a', slug: 'reading_log', name: 'Reading Log', place: { kind: 'ri' } } })).toBe(toolkit);
    expect(mcpToolkitId({ slug: 'notion', providerId: 'notion' })).toBe('notion');
    expect(mcpToolkitId({ slug: 'custom' })).toBe('mcp_custom');
    expect(isAppToolkitId(toolkit)).toBe(true);
    expect(isAppToolkitId('mcp_custom')).toBe(false);
  });

  it('pins an agent to its own connection, whatever its stored pins say', async () => {
    const all = runtime([ri, family, work, gmail]);
    expect(await resolveIntegrationFilter([{ toolkitId: toolkit }], all, 'local', 'ws-family'))
      .toEqual({ toolkits: [toolkit], connectionPins: { [toolkit]: 'c-family' }, allowedAccounts: {} });
    // A scope that names another place's account (by hand, or a stale copy) still reaches only this agent's.
    expect(await resolveIntegrationFilter([{ toolkitId: toolkit, accounts: [{ accountId: work.accountId }] }], all, 'local', 'ws-family'))
      .toEqual({ toolkits: [toolkit], connectionPins: { [toolkit]: 'c-family' }, allowedAccounts: {} });
  });

  it('leaves the app out for an agent that has no connection of its own, or no agent at all', async () => {
    const all = runtime([ri, work, gmail]);
    expect(await resolveIntegrationFilter([{ toolkitId: toolkit }, { toolkitId: 'gmail' }], all, 'local', 'ws-family'))
      .toEqual({ toolkits: ['gmail'], connectionPins: {}, allowedAccounts: {} });
    expect(await resolveIntegrationFilter([{ toolkitId: toolkit }], all, 'local'))
      .toEqual({ toolkits: [], connectionPins: {}, allowedAccounts: {} });
  });

  it('gives Ri\'s own chats every connected service, with the app on Ri\'s connection', async () => {
    expect(await resolveRiIntegrationFilter(runtime([family, ri, gmail]), 'local'))
      .toEqual({ toolkits: [toolkit, 'gmail'], connectionPins: { [toolkit]: 'c-ri' } });
    // Without its own connection, Ri never reaches an app through an agent's.
    expect(await resolveRiIntegrationFilter(runtime([family, gmail]), 'local'))
      .toEqual({ toolkits: ['gmail'], connectionPins: {} });
  });
});
