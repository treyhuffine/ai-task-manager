import type { McpClientLike } from '@connectors/engine/mcp';
import { snapshotMcpCapabilities } from './mcp-capabilities';

/** Bounded read candidates. Live discovery must independently advertise them as reads. */
export const TASK_PICKER_QUALIFICATION_READS = {
  clickup: ['clickup_search', 'clickup_get_task', 'clickup_get_workspace_hierarchy'],
  trello: ['trelloReadMember', 'trelloReadWorkspace', 'trelloReadBoard', 'trelloReadList', 'trelloReadCard', 'trelloReadInbox', 'trelloSearch'],
  ticktick: ['list_projects', 'get_project_with_undone_tasks', 'search_task', 'get_task_by_id', 'filter_tasks'],
  wrike: ['search_items', 'get_item_details', 'get_users', 'search_spaces', 'get_items_children'],
} as const;

export type TaskPickerQualificationProvider = keyof typeof TASK_PICKER_QUALIFICATION_READS;

/**
 * Always discovers real schemas. No task read happens unless the operator names
 * a specific allowlisted read and supplies its arguments after reviewing them.
 */
export async function captureTaskPickerContract(
  providerId: TaskPickerQualificationProvider,
  client: McpClientLike,
  sample?: { tool: string; input: Record<string, unknown> },
) {
  const { tools } = await client.listTools();
  const snapshot = snapshotMcpCapabilities(tools);
  const base = { providerId, capturedAt: new Date().toISOString(), ...snapshot };
  if (!sample) return base;
  if (!(TASK_PICKER_QUALIFICATION_READS[providerId] as readonly string[]).includes(sample.tool)) {
    throw new Error('The sample tool is not an approved task-picker qualification read.');
  }
  const advertised = tools.find((tool) => tool.name === sample.tool);
  if (!advertised || advertised.annotations?.readOnlyHint !== true || advertised.annotations.destructiveHint === true) {
    throw new Error('The server must advertise the selected tool as read-only before a sample can be captured.');
  }
  const response = await client.callTool({ name: sample.tool, arguments: sample.input });
  // Inputs and output contain account data only for this explicit opt-in sample.
  return { ...base, sample: { tool: sample.tool, input: sample.input, response } };
}
