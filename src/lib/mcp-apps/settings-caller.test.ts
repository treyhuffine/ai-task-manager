import { describe, expect, it } from 'vitest';
import { appApprovalPolicy, sessionCaller } from '@/lib/integrations/approval';
import { isMcpSettingsAction, mcpSettingsCaller } from './settings-caller';

const connection = { id: 'mcp-bits_bolts', providerId: 'mcp_bits_bolts', ownerId: 'local', accountId: 'local', status: 'active', scopes: [] } as never;
const check = { actionId: 'mcp.bits_bolts.settings.update', actionVersion: 'v1', risk: 'high' as const, mutating: true, inputDigest: 'digest',
  inputPreview: { set: { units: 'in' } }, connection, caller: mcpSettingsCaller('mcp.bits_bolts.settings.update') };

describe('the settings caller', () => {
  it('lets the person\'s own settings change through the gate, for exactly the action it names', async () => {
    // Every write asks, so only the settings bypass can allow it.
    const policy = appApprovalPolicy({ resolveMode: () => 'ask', onRequested: async () => {}, onSettled: async () => {} });
    expect(await policy.check(check)).toBe('allow');
    expect(await policy.check({ ...check, actionId: 'mcp.bits_bolts.cad.savePreviews' })).toBe('ask');
    expect(await policy.check({ ...check, caller: sessionCaller('some-agent') })).toBe('ask');
    expect(await policy.check({ ...check, caller: { type: 'agent', id: 'mcp-settings:mcp.bits_bolts.settings.update' } })).toBe('ask');
  });

  it('never stands in for an app view, a local app or a chat source', () => {
    const caller = mcpSettingsCaller('mcp.x.settings.update');
    expect(isMcpSettingsAction(caller, 'mcp.x.settings.update')).toBe(true);
    expect(isMcpSettingsAction({ ...caller, connectedApp: { viewId: 'v', invocationId: 'i', sourceRef: 's', viewerId: 'p' } }, 'mcp.x.settings.update')).toBe(false);
    expect(isMcpSettingsAction(undefined, 'mcp.x.settings.update')).toBe(false);
  });
});
