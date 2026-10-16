export type PluginsTab = 'integrations' | 'skills' | 'mcp';

export const PLUGIN_CREATE_ANCHORS = {
  connectService: 'integrations:add',
  mcpServer: 'mcp:new',
} as const;

/** A managed application's page under Connectors (Gmail, Google Calendar), as `${APP_ANCHOR}<id>`. */
export const APP_ANCHOR = 'integrations:app:';

/** Setup links describe the destination, independently of the tab being browsed. */
export function pluginsTabFor(anchor: string | null): PluginsTab {
  if (anchor === 'skills') return 'skills';
  if (anchor === 'mcp' || anchor?.startsWith('mcp:')) return 'mcp';
  return 'integrations';
}
