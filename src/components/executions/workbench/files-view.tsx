'use client';

import { useMemo, useRef, useState } from 'react';
import { useDefaultLayout, type Layout, type LayoutStorage } from 'react-resizable-panels';
import { ChevronDown, FilePlus, FileText, FolderPlus, PanelLeft, Plus } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FileIcon } from '@/components/file-icon';
import { HOTKEYS } from '@/constants/commands';
import { useSessionDiff } from '@/hooks/use-execution';
import type { FileHistoryEntry } from '@/hooks/use-file-history';
import { folderIsWritable, sessionFolder } from '@/lib/folders/source';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { cn } from '@/lib/utils';
import { FileTree, type FileTreeHandle } from '../file-tree/file-tree';
import { OpenWorktreeButton } from '../open-worktree-button';
import { FileViewer } from '../viewer/file-viewer';
import { FileHistoryMenu } from '../viewer/file-history-menu';
import { summarizeChanges } from './changes-summary';

const TREE_PANEL = 'exec-files-tree';
const VIEWER_PANEL = 'exec-files-viewer';
const DEFAULT_LAYOUT: Layout = { [TREE_PANEL]: 34, [VIEWER_PANEL]: 66 };
const NOOP_STORAGE: LayoutStorage = { getItem: () => null, setItem: () => {} };
const TREE_HIDDEN_KEY = 'ri.execution.files.treeHidden';

interface FilesViewProps {
  sessionId: string;
  /** Execution id (or the chat's id without one): keys tree state and history. */
  worktreeId: string;
  worktreePath: string | null;
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
  fileHistory: FileHistoryEntry[];
  onReferenceInChat?: (relativePath: string) => void;
}

function readTreeHidden(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TREE_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The Files view: the worktree's tree and the open file, side by side, like
 * the workbench always had. A thin bar across the top holds the view's
 * controls (show or hide the tree, New, recent files, open the worktree in
 * an app), so the tree column keeps only search and the All / Changes
 * switch, and never crowds at narrow widths. With nothing open, the viewer
 * side offers what the agent changed and what was opened recently.
 */
export function FilesView({
  sessionId,
  worktreeId,
  worktreePath,
  selectedPath,
  onSelect,
  fileHistory,
  onReferenceInChat,
}: FilesViewProps) {
  const source = sessionFolder(sessionId);
  const [treeHidden, setTreeHidden] = useState(readTreeHidden);
  const [storage] = useState<LayoutStorage>(() => (typeof window === 'undefined' ? NOOP_STORAGE : window.localStorage));
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'ri.execution.files.layout', storage });

  const setHidden = (hidden: boolean) => {
    setTreeHidden(hidden);
    try {
      window.localStorage.setItem(TREE_HIDDEN_KEY, hidden ? '1' : '0');
    } catch {
      /* best-effort */
    }
  };

  const treeRef = useRef<FileTreeHandle | null>(null);
  const writable = folderIsWritable(source);

  const viewer = selectedPath ? (
    <FileViewer source={source} selectedPath={selectedPath} onClose={() => onSelect(null)} onReferenceInChat={onReferenceInChat} />
  ) : (
    <PickAFile sessionId={sessionId} fileHistory={fileHistory} onSelect={onSelect} />
  );

  const bar = (
    <div className="flex h-9 flex-shrink-0 items-center gap-1 border-b border-border px-1.5">
      <BarButton
        onClick={() => setHidden(!treeHidden)}
        pressed={!treeHidden}
        title={treeHidden ? 'Show the file tree' : 'Hide the file tree'}
      >
        <PanelLeft size={14} />
      </BarButton>
      {writable && !treeHidden && (
        // Non-modal: a modal menu traps focus while it closes, so the tree's
        // new-name field couldn't take the cursor.
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
            title="Create a file or folder"
          >
            <Plus size={13} />
            New
            <ChevronDown size={11} className="opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={4}
            className="min-w-40"
            // The item opens an inline name field in the tree that focuses
            // itself. Restoring focus to this trigger on close would steal
            // it, so the next keystroke (or Escape) would miss the field.
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <DropdownMenuItem onClick={() => treeRef.current?.beginCreate('file')}>
              <FilePlus size={14} />
              New file
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => treeRef.current?.beginCreate('dir')}>
              <FolderPlus size={14} />
              New folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <FileHistoryMenu sessionId={sessionId} history={fileHistory} selectedPath={selectedPath} />
      <span className="flex-1" />
      {worktreePath && <OpenWorktreeButton path={worktreePath} source={sessionFolder(sessionId)} />}
    </div>
  );

  if (treeHidden) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {bar}
        <div className="min-h-0 flex-1">{viewer}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {bar}
      <ResizablePanelGroup
        orientation="horizontal"
        defaultLayout={defaultLayout ?? DEFAULT_LAYOUT}
        onLayoutChanged={onLayoutChanged}
        className="min-h-0 flex-1"
      >
        <ResizablePanel id={TREE_PANEL} minSize={180} className="flex min-h-0 min-w-0 flex-col">
          <FileTree
            source={source}
            worktreeId={worktreeId}
            selectedPath={selectedPath}
            onSelect={onSelect}
            worktreePath={worktreePath}
            onReferenceInChat={onReferenceInChat}
            titleRow={false}
            controlRef={treeRef}
            searchShortcut={HOTKEYS.goToFile.label}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id={VIEWER_PANEL} minSize={240} className="flex min-h-0 min-w-0 flex-col">
          {viewer}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function BarButton({
  children,
  onClick,
  pressed,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md transition-colors',
        pressed ? 'text-foreground hover:bg-muted/60' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** No file open: start with what the agent changed, then what you opened lately. */
function PickAFile({
  sessionId,
  fileHistory,
  onSelect,
}: {
  sessionId: string;
  fileHistory: FileHistoryEntry[];
  onSelect: (path: string) => void;
}) {
  const diff = useSessionDiff(sessionId);
  const changed = useMemo(() => summarizeChanges(diff.data).files.filter((f) => f.letter !== 'D').slice(0, 8), [diff.data]);
  const recent = fileHistory.slice(0, 6);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-lg px-5 py-6">
        <div className="mb-4 flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <FileText size={14} className="text-muted-foreground/70" />
          Pick a file from the tree, or start with what the agent touched.
        </div>
        {changed.length > 0 && (
          <Section title="Changed in this worktree">
            {changed.map((f) => (
              <Row key={f.file.path} name={f.name} dir={f.dir} onClick={() => onSelect(f.file.path)}>
                <span className="font-mono text-[11px] tabular-nums">
                  {f.additions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{f.additions}</span>}
                  {f.additions > 0 && f.deletions > 0 && ' '}
                  {f.deletions > 0 && <span className="text-rose-600 dark:text-rose-400">−{f.deletions}</span>}
                </span>
              </Row>
            ))}
          </Section>
        )}
        {recent.length > 0 && (
          <Section title="Recently opened">
            {recent.map((h) => {
              const slash = h.path.lastIndexOf('/');
              return (
                <Row
                  key={h.path}
                  name={slash >= 0 ? h.path.slice(slash + 1) : h.path}
                  dir={slash >= 0 ? h.path.slice(0, slash + 1) : ''}
                  onClick={() => onSelect(h.path)}
                >
                  <span className="text-[11px] text-muted-foreground/70">{formatCompactRelative(new Date(h.openedAt).toISOString())}</span>
                </Row>
              );
            })}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">{title}</div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Row({ name, dir, onClick, children }: { name: string; dir: string; onClick: () => void; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-muted/50"
    >
      <FileIcon name={name} size={13} className="flex-shrink-0" />
      <span className="flex-shrink-0 text-[12.5px] text-foreground">{name}</span>
      <span className="min-w-0 truncate text-[11.5px] text-muted-foreground/70">{dir.replace(/\/$/, '')}</span>
      <span className="ml-auto flex-shrink-0 pl-2">{children}</span>
    </button>
  );
}
