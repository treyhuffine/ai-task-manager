'use client';

import type { FileHistoryEntry } from '@/hooks/use-file-history';
import { ReferencesPane, type EntityChipInsert } from '../references-pane';
import { ScratchpadPane } from '../scratchpad-pane';
import { SetupPlaceholder } from '../setup-placeholder';
import { PreviewView } from '../preview/preview-view';
import { RunView } from '../preview/run-view';
import type { PreviewController } from '../preview/use-preview-controller';
import { ChangesView } from './changes-view';
import { FilesView } from './files-view';
import type { PanelView } from './workbench-state';

/** Everything the workbench's views need, gathered once by the execution view. */
export interface WorkbenchViewContext {
  sessionId: string;
  workspaceId: string | null;
  /** Execution id, or the chat's own id without one. */
  worktreeId: string;
  worktreePath: string | null;
  baseBranch: string | null;
  /** The selected chat's label, for the scratchpad (it's stored per chat). */
  chatLabel: string;
  /** The worktree is still being created (or failed to be). */
  settingUp: { failed: boolean } | null;
  controller: PreviewController;
  selectedPath: string | null;
  onSelectFile: (path: string | null) => void;
  fileHistory: FileHistoryEntry[];
  onReferenceInChat: (relativePath: string) => void;
  onInsertChip: (attrs: EntityChipInsert) => void;
  onInsertText: (text: string) => void;
  onOpenWorkspaceSettings?: () => void;
  onStartAndPreview: () => void;
  /** A peer switch to another view (no back pill). */
  show: (view: PanelView) => void;
  /** A drill-down to another view (gets a back pill). */
  jump: (view: PanelView) => void;
  /** The user opened this view during this visit, so it may take focus. */
  autoFocus: (view: PanelView) => boolean;
}

const WORKTREE_VIEWS: ReadonlySet<PanelView> = new Set(['run', 'preview', 'changes', 'files']);

/** The body of one workbench view. Shared by the desktop panel and the phone. */
export function WorkbenchViewBody({ view, ctx }: { view: PanelView; ctx: WorkbenchViewContext }) {
  if (ctx.settingUp && WORKTREE_VIEWS.has(view)) {
    return (
      <SetupPlaceholder
        variant="viewer"
        animated={!ctx.settingUp.failed}
        label={ctx.settingUp.failed ? 'Setup failed, see chat to retry' : 'Preparing environment…'}
      />
    );
  }

  switch (view) {
    case 'run':
      return (
        <RunView
          controller={ctx.controller}
          onStartAndPreview={ctx.onStartAndPreview}
          onOpenPreview={() => ctx.show('preview')}
          onOpenWorkspaceSettings={ctx.onOpenWorkspaceSettings}
        />
      );
    case 'preview':
      return (
        <PreviewView
          controller={ctx.controller}
          onOpenRun={() => ctx.show('run')}
          onOpenWorkspaceSettings={ctx.onOpenWorkspaceSettings}
        />
      );
    case 'changes':
      return (
        <ChangesView
          sessionId={ctx.sessionId}
          baseBranch={ctx.baseBranch}
          onOpenFile={(path) => {
            ctx.onSelectFile(path);
            ctx.jump('files');
          }}
        />
      );
    case 'files':
      return (
        <FilesView
          sessionId={ctx.sessionId}
          worktreeId={ctx.worktreeId}
          worktreePath={ctx.worktreePath}
          selectedPath={ctx.selectedPath}
          onSelect={ctx.onSelectFile}
          fileHistory={ctx.fileHistory}
          onReferenceInChat={ctx.onReferenceInChat}
        />
      );
    case 'notes':
      return (
        <ReferencesPane
          sessionId={ctx.sessionId}
          workspaceId={ctx.workspaceId}
          autoFocus={ctx.autoFocus('notes')}
          onInsertChip={ctx.onInsertChip}
        />
      );
    case 'scratch':
      return (
        <div className="flex h-full flex-col">
          <div
            className="flex h-8 flex-shrink-0 items-center gap-1 border-b border-border px-3 text-[11.5px] text-muted-foreground/80"
            title="The scratchpad is stored per chat, so it follows the chat tab you're on"
          >
            <span className="flex-shrink-0">For</span>
            <span className="min-w-0 truncate text-foreground/80">{ctx.chatLabel}</span>
            <span className="flex-shrink-0">· private until you send it</span>
          </div>
          <div className="min-h-0 flex-1">
            <ScratchpadPane
              sessionId={ctx.sessionId}
              workspaceId={ctx.workspaceId}
              onInsertText={ctx.onInsertText}
              onInsertChip={ctx.onInsertChip}
              autoFocus={ctx.autoFocus('scratch')}
            />
          </div>
        </div>
      );
  }
}
