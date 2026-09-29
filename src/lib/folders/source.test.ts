import { describe, expect, it } from 'vitest';
import { folderApiBase, folderIsWritable, folderStateId, sessionFolder, workspaceFolder } from './source';

describe('folder sources', () => {
  it("lets you edit an execution's worktree and an agent's own folder, but not an archived agent's", () => {
    expect(folderIsWritable(sessionFolder('s1'))).toBe(true);
    expect(folderIsWritable(workspaceFolder('w1'))).toBe(true);
    expect(folderIsWritable(workspaceFolder('w1', { readOnly: false }))).toBe(true);
    expect(folderIsWritable(workspaceFolder('w1', { readOnly: true }))).toBe(false);
  });

  it('addresses the same routes under each prefix, whatever the read-only flag', () => {
    expect(folderApiBase(sessionFolder('s1'))).toBe('/sessions/s1');
    expect(folderApiBase(workspaceFolder('w1'))).toBe('/workspaces/w1');
    expect(folderApiBase(workspaceFolder('w1', { readOnly: true }))).toBe('/workspaces/w1');
  });

  it('keeps per-folder client state on the folder, not on its read-only flag', () => {
    expect(folderStateId(workspaceFolder('w1', { readOnly: true }))).toBe(folderStateId(workspaceFolder('w1')));
    expect(workspaceFolder('w1')).toEqual({ kind: 'workspace', workspaceId: 'w1' });
  });
});
