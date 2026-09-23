'use client';

import { useState } from 'react';
import { useDefaultLayout, type Layout, type LayoutStorage } from 'react-resizable-panels';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { FileTree } from '@/components/executions/file-tree/file-tree';
import { FileViewer } from '@/components/executions/viewer/file-viewer';
import { folderStateId, workspaceFolder } from '@/lib/folders/source';
import type { WorkspaceRecord } from '@/db/types';

const TREE_PANEL = 'agent-files-tree';
const VIEWER_PANEL = 'agent-files-viewer';
const DEFAULT_LAYOUT: Layout = { [TREE_PANEL]: 34, [VIEWER_PANEL]: 66 };
const NOOP_STORAGE: LayoutStorage = { getItem: () => null, setItem: () => {} };

/**
 * The agent's own folder: the execution view's file tree and viewer, pointed
 * at the workspace (docs/agents-view-spec.md Phase 7). Read-only: a git
 * agent's checkout changes through executions, and editing from here is out
 * of scope. Changed files carry the same status flags, measured against
 * HEAD, so the tree shows what is uncommitted.
 */
export function AgentFiles({ workspace }: { workspace: WorkspaceRecord }) {
  const source = workspaceFolder(workspace.id);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [storage] = useState<LayoutStorage>(() => (typeof window === 'undefined' ? NOOP_STORAGE : window.localStorage));
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'ri.agent.files.layout', storage });

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      defaultLayout={defaultLayout ?? DEFAULT_LAYOUT}
      onLayoutChanged={onLayoutChanged}
      className="flex-1 min-h-0"
    >
      <ResizablePanel id={TREE_PANEL} minSize={180} className="flex flex-col min-w-0 min-h-0">
        <FileTree
          source={source}
          worktreeId={folderStateId(source)}
          selectedPath={selectedPath}
          onSelect={setSelectedPath}
          worktreePath={workspace.cwd}
        />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id={VIEWER_PANEL} minSize={240} className="flex flex-col min-w-0 min-h-0">
        <FileViewer source={source} selectedPath={selectedPath} onClose={() => setSelectedPath(null)} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
