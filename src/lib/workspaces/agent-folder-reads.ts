/**
 * Reading an agent's own folder for the agent view's Files tab
 * (docs/agents-view-spec.md Phase 5): its tree and one file. Filesystem and
 * git only, so the computer the agent lives on answers these for its folder
 * there (P3.5), with the same shapes the home gives for its own.
 *
 * For a git agent this is the source checkout, opened with its current
 * branch at HEAD as the base, so status flags mean uncommitted changes
 * (`openFolderHandle`). Non-git folders open as bare handles. A checkout on
 * a detached HEAD can't be opened as a handle, so it gets a plain listing
 * without flags and direct reads. Read-only: nothing here writes.
 */

import { openFolderHandle } from './index';
import { listTree } from './list-tree';
import { readBaseFile, readWorkspaceFile } from './read-file';
import { fileErrorAnswer } from './file-http';
import { listReferenceTree } from '@/lib/reference-folders/tree';
import type { ReadAnswer } from './execution-reads';

export type AgentFolderRead = { kind: 'tree' } | { kind: 'file'; path: string; base: boolean };

export async function readAgentFolder(folder: string, filesToCopy: string[], read: AgentFolderRead): Promise<ReadAnswer> {
  const handle = await openFolderHandle(folder);
  if (read.kind === 'tree') {
    const entries = handle ? await listTree(handle, filesToCopy) : (await listReferenceTree(folder)).entries;
    return { status: 200, body: { entries } };
  }
  try {
    if (read.base) {
      const content = handle ? await readBaseFile(handle, read.path) : '';
      return { status: 200, body: { path: read.path, content, encoding: 'utf8', mime: 'text/plain', size: content.length, isBinary: false } };
    }
    return { status: 200, body: await readWorkspaceFile({ path: folder }, read.path) };
  } catch (err) {
    const answer = fileErrorAnswer(err);
    if (answer) return answer;
    throw err;
  }
}
