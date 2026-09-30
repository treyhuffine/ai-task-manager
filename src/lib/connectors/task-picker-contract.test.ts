import { describe, expect, it, vi } from 'vitest';
import { captureTaskPickerContract } from './task-picker-contract';

const tool = { name: 'filter_tasks', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, annotations: { readOnlyHint: true } };
const client = () => ({
  listTools: vi.fn(async () => ({ tools: [tool] })),
  callTool: vi.fn(async () => ({ content: [], structuredContent: { example: true } })),
});

describe('opt-in task-picker qualification capture', () => {
  it('exports actual definitions without reading account data by default', async () => {
    const remote = client();
    const output = await captureTaskPickerContract('ticktick', remote);
    expect(output.tools).toEqual([expect.objectContaining(tool)]);
    expect(Object.keys(output).sort()).toEqual(['capturedAt', 'providerId', 'revision', 'tools']);
    expect(remote.callTool).not.toHaveBeenCalled();
  });

  it('performs exactly the explicitly requested read with unchanged operator arguments', async () => {
    const remote = client();
    const sample = { tool: 'filter_tasks', input: { status: 'operator-selected-value' } };
    const output = await captureTaskPickerContract('ticktick', remote, sample);
    expect(remote.callTool).toHaveBeenCalledExactlyOnceWith({ name: sample.tool, arguments: sample.input });
    expect(output).toHaveProperty('sample.response.structuredContent.example', true);
  });

  it.each(['complete_task', 'delete_task', 'unknown_tool', 'search_items'])('rejects %s without making a call', async (name) => {
    const remote = client();
    await expect(captureTaskPickerContract('ticktick', remote, { tool: name, input: {} })).rejects.toThrow('not an approved');
    expect(remote.callTool).not.toHaveBeenCalled();
  });

  it.each([undefined, { readOnlyHint: false }, { readOnlyHint: true, destructiveHint: true }])('requires an explicitly read-only advertised tool', async (annotations) => {
    const remote = client();
    remote.listTools.mockResolvedValue({ tools: [{ ...tool, annotations: annotations as typeof tool.annotations }] });
    await expect(captureTaskPickerContract('ticktick', remote, { tool: 'filter_tasks', input: {} })).rejects.toThrow('advertise');
    expect(remote.callTool).not.toHaveBeenCalled();
  });

  it('does not call an absent read tool', async () => {
    const remote = client();
    remote.listTools.mockResolvedValue({ tools: [] });
    await expect(captureTaskPickerContract('ticktick', remote, { tool: 'filter_tasks', input: {} })).rejects.toThrow('advertise');
    expect(remote.callTool).not.toHaveBeenCalled();
  });
});
