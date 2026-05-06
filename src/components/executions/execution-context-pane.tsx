'use client';

import { useMemo, useState } from 'react';
import {
  GitCommit, GitPullRequest, ArrowDownToLine, Send, Wand2, Rocket, Loader2,
  FilePlus, FileMinus, FileEdit, FileCode, AlertTriangle,
} from 'lucide-react';
import { useSessionStatus, usePush, usePullBase } from '@/hooks/use-execution';
import { useDiffStats } from '@/hooks/use-workspaces';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { ChatSessionRecord } from '@/db/types';
import type { WorktreeStatus } from '@/lib/api/sessions';
import { CommitModal } from './commit-modal';

interface ExecutionContextPaneProps {
  session: ChatSessionRecord;
  onOpenDiff: (file: string) => void;
}

type ChangeKind = 'added' | 'modified' | 'staged' | 'untracked';

interface ChangeEntry {
  path: string;
  kind: ChangeKind;
}

/**
 * Right-side context pane: files changed (clickable → diff slideout),
 * action buttons, then settings/metadata. Uses
 * `@agentex/workspace`'s `ws.git.status()` and `ws.git.shortstat()` via
 * /api/sessions/[id]/{status,diff-stats}.
 *
 * Action button categories follow the spec's tool/agentic split:
 *   - Tool (Commit/Push/Pull base) — wired today via library calls
 *   - Agentic (Review/Ship it) — stubbed; lands when executor wires
 */
export function ExecutionContextPane({ session, onOpenDiff }: ExecutionContextPaneProps) {
  const isGit = !!session.worktree_path;
  const { data: status } = useSessionStatus(isGit ? session.id : null);
  const { data: shortstat } = useDiffStats(isGit ? session.id : null);
  const push = usePush(session.id);
  const pullBase = usePullBase(session.id);
  const [commitOpen, setCommitOpen] = useState(false);

  const changes = useMemo(() => groupChanges(status), [status]);

  const handlePush = () => {
    push.mutate(undefined, {
      onError: (err) => alert(`Push failed: ${err instanceof Error ? err.message : String(err)}`),
    });
  };

  const handlePull = () => {
    pullBase.mutate(undefined, {
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) {
          const body = err.body as { code?: string } | null;
          if (body?.code === 'merge_conflict') {
            alert('Merge conflict — resolve in your editor or ask the agent to fix.');
            return;
          }
        }
        alert(`Pull failed: ${err instanceof Error ? err.message : String(err)}`);
      },
    });
  };

  return (
    <aside className="w-[300px] flex-shrink-0 border-l border-border bg-background overflow-y-auto">
      {!isGit ? (
        <NonGitNotice />
      ) : (
        <>
          <FilesSection
            changes={changes}
            shortstat={shortstat}
            ahead={status?.ahead}
            behind={status?.behind}
            onOpenDiff={onOpenDiff}
          />

          <ActionsSection
            onCommit={() => setCommitOpen(true)}
            onPush={handlePush}
            onPullBase={handlePull}
            pushPending={push.isPending}
            pullPending={pullBase.isPending}
            ahead={status?.ahead ?? 0}
            behind={status?.behind ?? 0}
          />

          <SettingsSection session={session} />

          <CommitModal
            sessionId={commitOpen ? session.id : null}
            onClose={() => setCommitOpen(false)}
          />
        </>
      )}
    </aside>
  );
}

function NonGitNotice() {
  return (
    <div className="p-5">
      <div className="rounded-md border border-border/60 bg-muted/30 p-3">
        <p className="text-[11px] font-medium text-foreground">Not a git workspace</p>
        <p className="text-[10.5px] text-muted-foreground/80 mt-1 leading-relaxed">
          The agent runs directly in this folder. There&apos;s no worktree, no branch, no commits — just files. Diff stats, commit, push, and pull aren&apos;t available.
        </p>
      </div>
    </div>
  );
}

interface FilesSectionProps {
  changes: ChangeEntry[];
  shortstat: { files: number; additions: number; deletions: number } | null | undefined;
  ahead: number | undefined;
  behind: number | undefined;
  onOpenDiff: (file: string) => void;
}

function FilesSection({ changes, shortstat, ahead, behind, onOpenDiff }: FilesSectionProps) {
  return (
    <div className="px-3 py-3 border-b border-border">
      <div className="flex items-baseline justify-between px-1.5 mb-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
          Files changed
        </span>
        {shortstat && (shortstat.additions > 0 || shortstat.deletions > 0) && (
          <span className="text-[10px] font-mono">
            <span className="text-emerald-500/80">+{shortstat.additions}</span>{' '}
            <span className="text-rose-500/80">-{shortstat.deletions}</span>
          </span>
        )}
      </div>

      {changes.length === 0 ? (
        <p className="px-1.5 text-[10.5px] italic text-muted-foreground/60">
          Worktree clean.
        </p>
      ) : (
        <div className="space-y-0.5">
          {changes.map((c) => (
            <button
              key={`${c.kind}:${c.path}`}
              onClick={() => onOpenDiff(c.path)}
              className="w-full flex items-center gap-2 px-1.5 py-1 rounded text-left hover:bg-muted/40 transition-colors group"
            >
              <ChangeIcon kind={c.kind} />
              <span className="text-[10.5px] font-mono text-foreground truncate flex-1">
                {c.path}
              </span>
            </button>
          ))}
        </div>
      )}

      {(ahead !== undefined && behind !== undefined && (ahead > 0 || behind > 0)) && (
        <p className="px-1.5 mt-2 text-[10px] text-muted-foreground/70">
          {ahead > 0 && <>↑ {ahead} ahead</>}
          {ahead > 0 && behind > 0 && <span className="text-muted-foreground/40"> · </span>}
          {behind > 0 && <>↓ {behind} behind</>}
        </p>
      )}
    </div>
  );
}

function ChangeIcon({ kind }: { kind: ChangeKind }) {
  switch (kind) {
    case 'added':     return <FilePlus size={10} className="text-emerald-500/80 flex-shrink-0" />;
    case 'modified':  return <FileEdit size={10} className="text-amber-500/80 flex-shrink-0" />;
    case 'staged':    return <FileCode size={10} className="text-blue-500/80 flex-shrink-0" />;
    case 'untracked': return <FilePlus size={10} className="text-muted-foreground/60 flex-shrink-0" />;
  }
}

interface ActionsSectionProps {
  onCommit: () => void;
  onPush: () => void;
  onPullBase: () => void;
  pushPending: boolean;
  pullPending: boolean;
  ahead: number;
  behind: number;
}

function ActionsSection({ onCommit, onPush, onPullBase, pushPending, pullPending, ahead, behind }: ActionsSectionProps) {
  return (
    <div className="px-3 py-3 border-b border-border">
      <div className="px-1.5 mb-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
          Actions
        </span>
      </div>

      <div className="space-y-1">
        <ActionButton icon={<GitCommit size={11} />} onClick={onCommit}>
          Commit…
        </ActionButton>

        <ActionButton
          icon={pushPending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          onClick={onPush}
          disabled={pushPending}
          subtle={ahead === 0}
        >
          Push {ahead > 0 && <span className="text-[9px] text-muted-foreground/70">({ahead})</span>}
        </ActionButton>

        <ActionButton
          icon={pullPending ? <Loader2 size={11} className="animate-spin" /> : <ArrowDownToLine size={11} />}
          onClick={onPullBase}
          disabled={pullPending}
          subtle={behind === 0}
        >
          Pull base {behind > 0 && <span className="text-[9px] text-muted-foreground/70">({behind})</span>}
        </ActionButton>

        <div className="h-px bg-border/40 my-1.5 mx-1.5" />

        <ActionButton
          icon={<Wand2 size={11} />}
          onClick={() => alert('Review the diff is an agentic action — lands when executor wires.')}
          subtle
        >
          Review the diff
        </ActionButton>

        <ActionButton
          icon={<Rocket size={11} />}
          onClick={() => alert('Ship it is an agentic action — lands when executor wires.')}
          subtle
        >
          Ship it
        </ActionButton>

        <ActionButton
          icon={<GitPullRequest size={11} />}
          onClick={() => alert('Create PR lands once gh integration is wired into the action UI.')}
          subtle
        >
          Create PR
        </ActionButton>
      </div>
    </div>
  );
}

function ActionButton({
  icon, onClick, disabled, subtle, children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  subtle?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] transition-colors',
        'hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed',
        subtle ? 'text-muted-foreground hover:text-foreground' : 'text-foreground',
      )}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="flex-1 text-left">{children}</span>
    </button>
  );
}

function SettingsSection({ session }: { session: ChatSessionRecord }) {
  return (
    <div className="px-3 py-3">
      <div className="px-1.5 mb-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
          Details
        </span>
      </div>
      <div className="space-y-1.5 text-[10.5px] px-1.5">
        {session.worktree_path && (
          <DetailRow label="Worktree">
            <code className="text-muted-foreground/80 font-mono truncate block">
              {session.worktree_path}
            </code>
          </DetailRow>
        )}
        {session.base_sha && (
          <DetailRow label="Base">
            <code className="text-muted-foreground/80 font-mono">
              @{session.base_sha.slice(0, 12)}
            </code>
          </DetailRow>
        )}
        <DetailRow label="Started">
          <span className="text-muted-foreground/80">
            {new Date(session.started_at).toLocaleString()}
          </span>
        </DetailRow>
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wide text-muted-foreground/60 mb-0.5">
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Flatten the WorktreeStatus arrays into a single list with labels.
 * Status arrays from `@agentex/workspace` are exclusive (a file is in
 * exactly one of untracked/modified/staged at any time), so no dedup
 * needed here.
 */
function groupChanges(status: WorktreeStatus | null | undefined): ChangeEntry[] {
  if (!status) return [];
  const out: ChangeEntry[] = [];
  for (const path of status.staged) out.push({ path, kind: 'staged' });
  for (const path of status.modified) out.push({ path, kind: 'modified' });
  for (const path of status.untracked) out.push({ path, kind: 'untracked' });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
