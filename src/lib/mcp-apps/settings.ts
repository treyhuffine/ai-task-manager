import { CallToolResultSchema } from '@modelcontextprotocol/core';
import { integrationSourceMetadata } from '@/lib/integrations/source-metadata';
import { getIntegrationRuntime, getIntegrationOwnerId } from '@/lib/integrations/runtime';
import { hostedMcpConnectionId } from '@/lib/integrations/hosted-mcp';
import type { McpCapabilityTool } from '@/lib/integrations/mcp-capabilities';
import { modelToolVisible, settingsCapability } from './metadata';
import { mcpSettingsCaller } from './settings-caller';
import { parseSettingsRead, settingsTools, SettingsReadError, type SettingValue, type SettingsView } from './settings-model';

/**
 * OpenAI's structured settings on a connection's page (docs/connected-mcp-apps.md,
 * "Settings"). The person reads and changes an MCP server's own settings
 * through the tools it names in `capabilities.extensions["openai/settings"]`,
 * on that server's exact account. The server stores them.
 *
 * Every call runs through the integration runtime like any other, with the
 * narrow `mcpSettingsCaller` the approval policy lets through for exactly
 * that one action: the person opening the section, changing a setting or
 * clicking a button is the approval. These are the app's own tools acting on
 * what the app already holds, so no card asks again. A tool turned off in the
 * server's tool list stays off here too.
 */

export class SettingsUnavailableError extends Error {}

/** The server, its exact account and its settings tools, rechecked on every call. */
async function settingsTarget(serverId: string) {
  const metadata = await integrationSourceMetadata();
  const remote = metadata.servers.find(server => server.entry.id === serverId);
  if (!remote) throw new SettingsUnavailableError('This MCP server was removed.');
  const capability = settingsCapability(remote.entry.protocol?.extensions);
  if (!capability) return null;
  if (!remote.entry.enabled) throw new SettingsUnavailableError('Turn this server on to see its settings.');
  const runtime = await getIntegrationRuntime();
  const connection = (await runtime.listConnections({ownerId: getIntegrationOwnerId()})).find(candidate => candidate.id === hostedMcpConnectionId(remote.entry));
  if (!connection || connection.status !== 'active') throw new SettingsUnavailableError('Reconnect this account to see its settings.');
  return {remote, runtime, connection, capability, tools: remote.capabilities?.tools ?? []};
}
type Target = NonNullable<Awaited<ReturnType<typeof settingsTarget>>>;

/** The text a tool returned, for errors and for a button's result. */
function resultText(result: {content: unknown[]}) {
  return result.content.flatMap(item => {
    const block = item as {type?: unknown; text?: unknown};
    return block.type === 'text' && typeof block.text === 'string' ? [block.text] : [];
  }).join('\n').trim();
}

/** Run one of the server's tools for the person, through the gate, and return the MCP result. */
async function run(target: Target, name: string, args: Record<string, unknown>) {
  if (target.remote.entry.toolOverrides?.[name]?.enabled === false) throw new SettingsUnavailableError(`${name} is turned off in this server's tools.`);
  const tool: McpCapabilityTool | undefined = target.tools.find(candidate => candidate.name === name);
  if (!tool) throw new SettingsUnavailableError(`This server no longer offers ${name}.`);
  const actionId = `${target.remote.entry.providerId ?? `mcp.${target.remote.entry.slug}`}.${name}`;
  let original: unknown;
  const outcome = await target.runtime.runAction(actionId, args, {
    ownerId: getIntegrationOwnerId(), connectionId: target.connection.id, allowedConnectionIds: [target.connection.id],
    // A settings tool hidden from the model is one the host calls for the person, as an app would.
    toolAudience: modelToolVisible(tool) ? 'model' : 'app',
    caller: mcpSettingsCaller(actionId),
    captureOriginalResult: value => { original = value; },
  });
  if (!outcome.ok) throw new Error(outcome.reason === 'error' ? outcome.message : `This server needs attention before its settings can change (${outcome.reason.replace(/_/g, ' ')}).`);
  const result = CallToolResultSchema.parse(original ?? outcome.result);
  if (result.isError) throw new Error(resultText(result) || `${name} reported an error.`);
  return result;
}

async function read(target: Target): Promise<SettingsView> {
  const result = await run(target, target.capability.readTool, {});
  return parseSettingsRead(result.structuredContent, target.tools);
}

export type ConnectedSettings = {available: false} | ({available: true} & SettingsView);

/** The server's settings now: groups of fields and buttons, with their values. */
export async function readConnectedSettings(serverId: string): Promise<ConnectedSettings> {
  const target = await settingsTarget(serverId);
  if (!target) return {available: false};
  return {available: true, ...await read(target)};
}

/**
 * Change settings: what the person entered goes to the server's update tool
 * as is (`{set}`), and the server judges it. The page sends only the setting
 * that changed, as OpenAI's spec has the host do. Returns every value after
 * the update, as the server reports them. A refusal throws with the server's
 * own message.
 */
export async function updateConnectedSettings(serverId: string, set: Record<string, SettingValue>): Promise<{values: Record<string, SettingValue>}> {
  const target = await settingsTarget(serverId);
  if (!target) throw new SettingsUnavailableError('This server has no settings.');
  const result = await run(target, target.capability.updateTool, {set});
  const values = (result.structuredContent as {values?: unknown} | undefined)?.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new SettingsReadError('The server did not confirm the new settings.');
  return {values: Object.fromEntries(Object.entries(values as Record<string, unknown>).filter((entry): entry is [string, SettingValue] => ['string', 'number', 'boolean'].includes(typeof entry[1])))};
}

/**
 * A button in the settings layout. A tool with an interface opens it (the
 * page launches it as a `settings` view). Any other runs with `{}` and its
 * text is shown beside the button. Only tools the current layout names run.
 */
export async function runSettingsTool(serverId: string, name: string): Promise<{kind: 'app'} | {kind: 'text'; text: string}> {
  const target = await settingsTarget(serverId);
  if (!target) throw new SettingsUnavailableError('This server has no settings.');
  const button = settingsTools(await read(target)).get(name);
  if (!button) throw new SettingsUnavailableError('This server\'s settings no longer offer that button.');
  if (!button.available) throw new SettingsUnavailableError(`This server no longer offers ${button.title}.`);
  if (button.app) return {kind: 'app'};
  const result = await run(target, name, {});
  const text = resultText(result) || (result.structuredContent !== undefined ? JSON.stringify(result.structuredContent).slice(0, 2000) : '');
  return {kind: 'text', text: text || 'Done.'};
}
