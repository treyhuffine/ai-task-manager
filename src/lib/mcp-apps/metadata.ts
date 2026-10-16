import type { McpCapabilityTool } from '@/lib/integrations/mcp-capabilities';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function viewMetadata(tool: Pick<McpCapabilityTool, '_meta'>) {
  const meta = record(tool._meta), ui = record(meta.ui);
  const resource = ui.resourceUri ?? meta['ui/resourceUri'] ?? meta['openai/outputTemplate'];
  if (typeof resource !== 'string' || !resource.startsWith('ui://') || resource.length > 2048) return null;
  const visibility = Array.isArray(ui.visibility) ? ui.visibility : ['model', 'app'];
  const entrypoints = record(meta['openai/ui']).entrypoints;
  return { resourceUri: resource, model: visibility.includes('model'), app: visibility.includes('app'),
    global: Array.isArray(entrypoints) && entrypoints.some(item => record(item).type === 'global'),
    legacy: typeof meta['openai/outputTemplate'] === 'string' };
}
export function appToolVisible(tool: Pick<McpCapabilityTool, '_meta'>) {
  const meta = record(tool._meta), ui = record(meta.ui);
  if (Array.isArray(ui.visibility)) return ui.visibility.includes('app');
  // The old bridge required an explicit widget-accessible declaration.
  if (meta['openai/widgetAccessible'] === false) return false;
  return true;
}
export function modelToolVisible(tool: Pick<McpCapabilityTool, '_meta'>) {
  const visibility = record(record(tool._meta).ui).visibility;
  return !Array.isArray(visibility) || visibility.includes('model');
}

/** Private UI metadata is deliberately absent from transcript events. */
export const MCP_APP_EVENT = 'mcp_app_result';
