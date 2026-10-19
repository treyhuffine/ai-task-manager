import type { Caller } from '@integrations/engine';

/**
 * The person changing an MCP server's settings on its connection page
 * (OpenAI's structured settings). Like the email composer's Send, the click
 * is the approval: the person chose this exact change themselves.
 *
 * Stamped only by the owner-viewer settings procedures (`settings.ts`), never
 * from agent input, and bound to one action: the caller names the exact
 * action it runs, so the bypass can't reach any other tool. The procedures
 * stamp it only for the server's declared update tool and for tool buttons
 * the server's current settings layout names.
 */
const PREFIX = 'mcp-settings:';

export function mcpSettingsCaller(actionId: string): Caller {
  return { type: 'app', id: `${PREFIX}${actionId}` };
}

export function isMcpSettingsAction(caller: Caller | undefined, actionId: string): boolean {
  return caller?.type === 'app' && caller.id === `${PREFIX}${actionId}` && !caller.connectedApp && !caller.localApp && !caller.chatSource;
}
