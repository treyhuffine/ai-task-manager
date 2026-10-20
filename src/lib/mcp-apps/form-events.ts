/**
 * Transcript markers for a server's form, like `MCP_TOOL_RESULT_EVENT`: the request
 * card (its event id is the form id) and the recorded end of the form. The
 * form itself stays in the Home's memory, never in the transcript.
 */
export const MCP_FORM_EVENT = 'mcp_form_request';
export const MCP_FORM_RESPONSE_EVENT = 'mcp_form_response';
