/**
 * The team's MCP for a member's own AI client (docs/homes-spec.md §9.8).
 * Stateless Streamable HTTP: POST carries every call. GET and DELETE answer
 * that there is no stream or session to open or close.
 */

import { handleTeamMcp } from '@/lib/team/mcp/server';

export const POST = handleTeamMcp;
export const GET = handleTeamMcp;
export const DELETE = handleTeamMcp;
