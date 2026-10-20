import type { Caller } from '@integrations/engine';

/**
 * The person using an MCP server's settings on its connection page (OpenAI's
 * structured settings): opening the section, changing a setting, or clicking
 * one of its buttons. Like the email composer's Send, that is the approval:
 * the person's own action on the app's own tools.
 *
 * Stamped only by the owner-viewer settings procedures (`settings.ts`), never
 * from agent input, and bound to one action: the caller names the exact
 * action it runs, so the bypass can't reach any other tool. The procedures
 * stamp it only for the server's declared read and update tools and for tool
 * buttons the server's current settings layout names.
 */
const PREFIX = 'mcp-settings:';

export function mcpSettingsCaller(actionId: string): Caller {
  return { type: 'app', id: `${PREFIX}${actionId}` };
}

export function isMcpSettingsAction(caller: Caller | undefined, actionId: string): boolean {
  return caller?.type === 'app' && caller.id === `${PREFIX}${actionId}` && !caller.connectedApp && !caller.localApp && !caller.chatSource;
}
