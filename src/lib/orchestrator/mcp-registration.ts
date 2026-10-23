/** Keep destination fields until dispatch, independently of tool discovery schemas. */
import { z } from 'zod';
import type { RiMcpServer, RiMcpToolHandler } from '@/lib/mcp/http-server';
import type { Action } from './types';

const STRICT_RESULT_ACTIONS = new Set(['get_handoff_context', 'report_result', 'get_result', 'list_results', 'request_result_review', 'report_result_review']);
export function registerActionTool(server: RiMcpServer, action: Pick<Action, 'name' | 'params' | 'description' | 'strictParams'>, handler: RiMcpToolHandler, contract?: { params?: z.ZodRawShape; description?: string }) {
  const schema = z.object(contract?.params ?? action.params);
  server.registerTool(action.name, {
    description: contract?.description ?? action.description,
    inputSchema: Object.keys(schema.shape).length === 0 ? {} : action.strictParams || STRICT_RESULT_ACTIONS.has(action.name) ? schema.strict() : schema,
    preserveRawInput: true,
  }, handler);
}
