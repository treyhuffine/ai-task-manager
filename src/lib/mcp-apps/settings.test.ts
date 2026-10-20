import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bitsAndBoltsSettings, bitsAndBoltsTools } from '@/test/fixtures/bits-and-bolts-settings';

const mocks = vi.hoisted(() => ({metadata: vi.fn(), runtime: vi.fn(), connections: vi.fn(), run: vi.fn()}));
vi.mock('@/lib/integrations/source-metadata', () => ({integrationSourceMetadata: mocks.metadata}));
vi.mock('@/lib/integrations/runtime', () => ({getIntegrationRuntime: mocks.runtime, getIntegrationOwnerId: () => 'local'}));
import { readConnectedSettings, runSettingsTool, updateConnectedSettings } from './settings';
import { isMcpSettingsAction } from './settings-caller';

let entry: Record<string, unknown>;
let values: Record<string, unknown>;
const connection = {id: 'mcp-bits_bolts', providerId: 'mcp_bits_bolts', ownerId: 'local', accountId: 'local', status: 'active', scopes: []};
const tools = [...bitsAndBoltsTools, {name: 'cad.rebuild', title: 'Rebuild previews'}];
/** What the fake server returns for each tool, as an MCP result. */
function respond(name: string, args: Record<string, unknown>) {
  if (name === 'settings.read') return {content: [], structuredContent: {...bitsAndBoltsSettings, values}};
  if (name === 'settings.update') { values = {...values, ...(args.set as Record<string, unknown>)}; return {content: [], structuredContent: {values}}; }
  if (name === 'cad.rebuild') return {content: [{type: 'text', text: 'Rebuilt 12 previews'}]};
  throw new Error(`unexpected ${name}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  values = {...bitsAndBoltsSettings.values};
  entry = {id: 'server', slug: 'bits_bolts', enabled: true, displayName: 'Bits & Bolts', url: 'http://localhost:3917/mcp',
    protocol: {checkedAt: 'now', extensions: {'openai/settings': {readTool: 'settings.read', updateTool: 'settings.update'}}}};
  mocks.metadata.mockImplementation(async () => ({servers: [{entry, capabilities: {revision: 'r', tools}}], connections: [connection], toolkits: []}));
  mocks.connections.mockResolvedValue([connection]);
  mocks.runtime.mockResolvedValue({listConnections: mocks.connections, runAction: mocks.run});
  mocks.run.mockImplementation(async (actionId: string, args: Record<string, unknown>, options: {captureOriginalResult: (value: unknown) => void}) => {
    const result = respond(actionId.slice('mcp.bits_bolts.'.length), args);
    options.captureOriginalResult(result);
    return {ok: true, result};
  });
});

describe('structured settings', () => {
  it('reads with {} on the exact account, as the person, and lays the result out', async () => {
    const settings = await readConnectedSettings('server');
    expect(settings).toMatchObject({available: true, values: {units: 'mm', showGrid: true, defaultView: 'isometric'}});
    expect(settings.available && settings.groups.map(group => group.title)).toEqual(['Measurements', '3D viewer', 'Library']);
    const [actionId, args, options] = mocks.run.mock.calls[0];
    expect([actionId, args]).toEqual(['mcp.bits_bolts.settings.read', {}]);
    expect(options).toMatchObject({connectionId: 'mcp-bits_bolts', allowedConnectionIds: ['mcp-bits_bolts'], toolAudience: 'model'});
    // The approval policy lets this caller through for exactly this action and no other.
    expect(isMcpSettingsAction(options.caller, 'mcp.bits_bolts.settings.read')).toBe(true);
    expect(isMcpSettingsAction(options.caller, 'mcp.bits_bolts.settings.update')).toBe(false);
  });

  it('says there are none, without calling the server, when it publishes no settings', async () => {
    entry.protocol = {checkedAt: 'now'};
    expect(await readConnectedSettings('server')).toEqual({available: false});
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('sends only the settings that change, checked against a fresh read, and returns every value after', async () => {
    expect(await updateConnectedSettings('server', {units: 'in', showGrid: true})).toEqual({values: {units: 'in', showGrid: true, defaultView: 'isometric'}});
    expect(mocks.run.mock.calls.map(call => [call[0], call[1]])).toEqual([
      ['mcp.bits_bolts.settings.read', {}],
      ['mcp.bits_bolts.settings.update', {set: {units: 'in'}}],
    ]);
    expect(isMcpSettingsAction(mocks.run.mock.calls[1][2].caller, 'mcp.bits_bolts.settings.update')).toBe(true);
    mocks.run.mockClear();
    // Nothing changes, so nothing is sent.
    expect(await updateConnectedSettings('server', {units: 'in'})).toEqual({values: {units: 'in', showGrid: true, defaultView: 'isometric'}});
    expect(mocks.run.mock.calls.map(call => call[0])).toEqual(['mcp.bits_bolts.settings.read']);
  });

  it('refuses an invalid or unknown setting before the server sees it', async () => {
    await expect(updateConnectedSettings('server', {units: 'cm'})).rejects.toThrow('Units: Choose one of the listed options.');
    await expect(updateConnectedSettings('server', {theme: 'dark'})).rejects.toThrow('no setting named theme');
    expect(mocks.run.mock.calls.map(call => call[0])).toEqual(['mcp.bits_bolts.settings.read', 'mcp.bits_bolts.settings.read']);
  });

  it('reports a server that does not confirm, or rejects, the change', async () => {
    mocks.run.mockImplementation(async (actionId: string, args: Record<string, unknown>, options: {captureOriginalResult: (value: unknown) => void}) => {
      const name = actionId.slice('mcp.bits_bolts.'.length);
      const result = name === 'settings.update' ? {content: [{type: 'text', text: 'Units are locked by your team'}], isError: true} : respond(name, args);
      options.captureOriginalResult(result);
      return {ok: true, result};
    });
    await expect(updateConnectedSettings('server', {units: 'in'})).rejects.toThrow('Units are locked by your team');
    mocks.run.mockImplementation(async (actionId: string, args: Record<string, unknown>, options: {captureOriginalResult: (value: unknown) => void}) => {
      const name = actionId.slice('mcp.bits_bolts.'.length);
      const result = name === 'settings.update' ? {content: []} : respond(name, args);
      options.captureOriginalResult(result);
      return {ok: true, result};
    });
    await expect(updateConnectedSettings('server', {units: 'in'})).rejects.toThrow('did not confirm');
  });

  it('opens a button with an interface as an app and runs a plain one with {}, but only buttons the layout names', async () => {
    expect(await runSettingsTool('server', 'cad.library')).toEqual({kind: 'app'});
    expect(mocks.run.mock.calls.map(call => call[0])).toEqual(['mcp.bits_bolts.settings.read']);
    await expect(runSettingsTool('server', 'cad.rebuild')).rejects.toThrow('no longer offer that button');
    bitsAndBoltsSettings.layout.push({kind: 'group', title: 'Maintenance', items: [{kind: 'tool', tool: 'cad.rebuild'}]} as never);
    try {
      mocks.run.mockClear();
      expect(await runSettingsTool('server', 'cad.rebuild')).toEqual({kind: 'text', text: 'Rebuilt 12 previews'});
      expect(mocks.run.mock.calls.map(call => [call[0], call[1]])).toEqual([['mcp.bits_bolts.settings.read', {}], ['mcp.bits_bolts.cad.rebuild', {}]]);
      expect(isMcpSettingsAction(mocks.run.mock.calls[1][2].caller, 'mcp.bits_bolts.cad.rebuild')).toBe(true);
    } finally { bitsAndBoltsSettings.layout.pop(); }
  });

  it('keeps a tool turned off in the server\'s tool list off, and needs the server on and its account connected', async () => {
    entry.toolOverrides = {'settings.read': {enabled: false}};
    await expect(readConnectedSettings('server')).rejects.toThrow('settings.read is turned off');
    entry.toolOverrides = undefined;
    entry.enabled = false;
    await expect(readConnectedSettings('server')).rejects.toThrow('Turn this server on');
    entry.enabled = true;
    mocks.connections.mockResolvedValue([{...connection, status: 'expired'}]);
    await expect(readConnectedSettings('server')).rejects.toThrow('Reconnect this account');
    await expect(readConnectedSettings('removed')).rejects.toThrow('removed');
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('calls a settings tool hidden from the model with the app audience', async () => {
    const hidden = tools.map(tool => tool.name === 'settings.read' ? {...tool, _meta: {ui: {visibility: ['app']}}} : tool);
    mocks.metadata.mockImplementation(async () => ({servers: [{entry, capabilities: {revision: 'r', tools: hidden}}], connections: [connection], toolkits: []}));
    await readConnectedSettings('server');
    expect(mocks.run.mock.calls[0][2]).toMatchObject({toolAudience: 'app'});
  });
});

describe('the person\'s own approval choices', () => {
  it('runs the read tool on its own only when the server marks it read-only', async () => {
    const unmarked = tools.map(tool => tool.name === 'settings.read' ? {name: 'settings.read', title: 'Read settings'} : tool);
    mocks.metadata.mockImplementation(async () => ({servers: [{entry, capabilities: {revision: 'r', tools: unmarked}}], connections: [connection], toolkits: []}));
    await expect(readConnectedSettings('server')).rejects.toThrow('Read settings, is not marked read-only, so Ri doesn\'t run it on its own.');
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('never runs a tool the person set to Ask first, on the tool or for the whole server', async () => {
    entry.toolOverrides = {'settings.update': {approvalMode: 'ask'}};
    await expect(updateConnectedSettings('server', {units: 'in'})).rejects.toThrow('You set settings.update to Ask first, so Ri doesn\'t run it from settings.');
    expect(mocks.run.mock.calls.map(call => call[0])).toEqual(['mcp.bits_bolts.settings.read']);
    // Reading still works: only the tool they chose asks first.
    expect(await readConnectedSettings('server')).toMatchObject({available: true});
    mocks.run.mockClear();
    entry.toolOverrides = {};
    entry.approvalPolicy = 'ask';
    await expect(readConnectedSettings('server')).rejects.toThrow('Ask first');
    await expect(runSettingsTool('server', 'cad.rebuild')).rejects.toThrow('Ask first');
    expect(mocks.run).not.toHaveBeenCalled();
    // A tool they let run without asking runs, even on a server that asks first.
    entry.toolOverrides = {'settings.read': {approvalMode: 'auto'}};
    expect(await readConnectedSettings('server')).toMatchObject({available: true});
  });
});

