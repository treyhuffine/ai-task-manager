'use client';

import { usePreviewController } from './use-preview-controller';
import { PreviewView } from './preview-view';

interface PreviewPaneProps {
  /** The execution whose worktree we're previewing. */
  executionId: string | null;
  /** The owning workspace (for the default preview command). */
  workspaceId: string | null;
  /** True when the wrapping panel is visible — gates polling / iframe work. */
  active?: boolean;
  /** Opens the workspace settings sheet so the user can set the command. */
  onOpenWorkspaceSettings?: () => void;
}

/**
 * The all-in-one preview pane: the interface plus its process controls
 * (Start / Stop and a logs strip) in one header. The Agents view's Tools tab
 * uses it. The execution workbench instead splits the same controller into
 * a Run tab (the process) and a Preview tab (the interface).
 */
export function PreviewPane({ executionId, workspaceId, active = true, onOpenWorkspaceSettings }: PreviewPaneProps) {
  const controller = usePreviewController(executionId, workspaceId, { active });
  return <PreviewView controller={controller} processControls onOpenWorkspaceSettings={onOpenWorkspaceSettings} />;
}
