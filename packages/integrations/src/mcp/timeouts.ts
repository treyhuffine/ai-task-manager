/** Host-controlled MCP budgets. Paid research can be slow and may not emit progress. */
export const MCP_CONNECT_TIMEOUT_MS = 30_000;
export const MCP_DISCOVERY_TIMEOUT_MS = 60_000;
export const MCP_RESOURCE_TIMEOUT_MS = 2 * 60_000;
export const MCP_TOOL_TIMEOUT_MS = 10 * 60_000;
export const MCP_TOOL_TOTAL_TIMEOUT_MS = 30 * 60_000;
/** The HTTP layer must never expire before the MCP protocol's hard total deadline. */
export const MCP_HTTP_TIMEOUT_MS = MCP_TOOL_TOTAL_TIMEOUT_MS + 60_000;
