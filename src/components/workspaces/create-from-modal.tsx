'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import {
  X, Loader2, GitBranch, GitPullRequest, CircleDot, Search,
} from 'lucide-react';
import {
  useCreateExecution,
  useWorkspacePRs,
  useWorkspaceIssues,
  useWorkspaceBranches,
} from '@/hooks/use-workspaces';
import { useDashboard } from '@/contexts/dashboard-context';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { PRSummary, IssueSummary } from '@/lib/api/workspaces';

interface CreateFromModalProps {
  workspaceId: string | null;
  workspaceName: string | null;
  onClose: () => void;
}

type Tab = 'pr' | 'branch' | 'issue';

interface Selection {
  kind: Tab;
  /** Branch name to use as the base of the new worktree. Empty for the
   *  PR kind — server resolves via `prNumber` instead, which works for
   *  forks and PRs the user has never checked out locally. */
  baseBranch: string;
  /** GitHub PR number. Set only when `kind === 'pr'`. */
  prNumber?: number;
  /** Suggested label seed for the execution (PR title, issue title, or branch name). */
  labelSeed: string;
  /** Display fields used in the picker. */
  display: { primary: string; secondary?: string };
}

/**
 * "Create from" modal: dispatch a new execution against an existing PR
 * head, a remote branch, or an issue's base. Three tabs back the three
 * picker lists; selecting an item enables the Start button at the
 * bottom; clicking Start fires the standard create-execution mutation
 * with `baseBranch` overridden so the new worktree forks from the
 * selected ref instead of the workspace default.
 */
export function CreateFromModal({ workspaceId, workspaceName, onClose }: CreateFromModalProps) {
  const [tab, setTab] = useState<Tab>('pr');
  const [pending, setPending] = useState<Selection | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateExecution();
  const { setActiveView } = useDashboard();

  useEffect(() => {
    if (workspaceId) {
      setTab('pr');
      setPending(null);
      setError(null);
    }
  }, [workspaceId]);

  const handleStart = (selection: Selection) => {
    if (!workspaceId || create.isPending) return;
    setError(null);
    setPending(selection);
    create.mutate(
      {
        workspaceId,
        label: selection.labelSeed,
        // baseBranch is left null for PR selections — the server resolves
        // the head deterministically via the PR number's pull ref.
        baseBranch: selection.kind === 'pr' ? null : selection.baseBranch,
        prNumber: selection.kind === 'pr' ? (selection.prNumber ?? null) : null,
      },
      {
        onSuccess: (session) => {
          setActiveView(session.id);
          onClose();
        },
        onError: (err) => {
          setPending(null);
          if (err instanceof ApiError) {
            const body = err.body as { error?: string; message?: string } | null;
            setError(body?.message ?? body?.error ?? `Request failed (${err.status})`);
          } else {
            setError(String(err));
          }
        },
      },
    );
  };

  return (
    <DialogPrimitive.Root open={!!workspaceId} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Create from</DialogPrimitive.Title>
            <DialogPrimitive.Description>Start an execution from a pull request, branch, or issue</DialogPrimitive.Description>
          </VisuallyHidden.Root>
          <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col h-[600px] max-h-[80vh]">
            {/* Header + tabs */}
            <div className="flex-shrink-0 border-b border-border">
              <div className="flex items-center justify-between px-5 py-3">
                <div>
                  <span className="text-xs font-semibold tracking-wide text-foreground">
                    Create from…
                  </span>
                  {workspaceName && (
                    <span className="ml-2 text-[10px] text-muted-foreground/70 font-mono">
                      in {workspaceName}
                    </span>
                  )}
                </div>
                <DialogPrimitive.Close asChild>
                  <button className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                    <X size={16} />
                  </button>
                </DialogPrimitive.Close>
              </div>

              <div className="flex items-center gap-1 px-3 pb-1">
                <TabButton
                  active={tab === 'pr'}
                  onClick={() => { setTab('pr'); setError(null); }}
                  icon={<GitPullRequest size={12} />}
                  label="Pull Request"
                />
                <TabButton
                  active={tab === 'branch'}
                  onClick={() => { setTab('branch'); setError(null); }}
                  icon={<GitBranch size={12} />}
                  label="Branch"
                />
                <TabButton
                  active={tab === 'issue'}
                  onClick={() => { setTab('issue'); setError(null); }}
                  icon={<CircleDot size={12} />}
                  label="Issue"
                />
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {tab === 'pr' && (
                <PRTab workspaceId={workspaceId} pending={pending} isCreating={create.isPending} onStart={handleStart} />
              )}
              {tab === 'branch' && (
                <BranchTab workspaceId={workspaceId} pending={pending} isCreating={create.isPending} onStart={handleStart} />
              )}
              {tab === 'issue' && (
                <IssueTab workspaceId={workspaceId} pending={pending} isCreating={create.isPending} onStart={handleStart} />
              )}
            </div>

            {error && (
              <div className="flex-shrink-0 px-5 py-2 border-t border-border bg-destructive/5 text-[11px] text-destructive">
                {error}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Compact relative-time formatter — "just now", "12m ago", "3h ago",
 * "2d ago", "Mar 14". Falls back to a short date for anything older
 * than ~30 days. Negative deltas (clock skew) get clamped to "just now".
 */
function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function TabButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors border',
        active
          ? 'border-primary/30 bg-primary/10 text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Search input ─────────────────────────────────────────────

function SearchBar({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div className="relative px-3 pt-3 pb-2 flex-shrink-0 border-b border-border/60">
      <Search size={11} className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-7 pr-3 py-1.5 text-[12px] bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
        autoFocus
      />
    </div>
  );
}

// ─── PR tab ───────────────────────────────────────────────────

function PRTab({ workspaceId, pending, isCreating, onStart }: {
  workspaceId: string | null;
  pending: Selection | null;
  isCreating: boolean;
  onStart: (s: Selection) => void;
}) {
  const [filter, setFilter] = useState('');
  const { data: prs, isLoading, error } = useWorkspacePRs(workspaceId);

  const filtered = useMemo(() => {
    if (!prs) return [];
    if (!filter.trim()) return prs;
    const q = filter.toLowerCase();
    return prs.filter((p) =>
      p.title.toLowerCase().includes(q)
      || String(p.number).includes(q)
      || p.headRefName.toLowerCase().includes(q),
    );
  }, [prs, filter]);

  return (
    <div className="h-full flex flex-col">
      <SearchBar value={filter} onChange={setFilter} placeholder="Filter pull requests…" />
      {isLoading && <ListLoading />}
      {error && <ErrorState error={error} hint="Make sure gh is installed and authenticated." />}
      {!isLoading && !error && filtered.length === 0 && <EmptyList kind="open pull requests" />}
      {!isLoading && !error && filtered.length > 0 && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {filtered.map((pr) => (
            <PRRow
              key={pr.number}
              pr={pr}
              isPending={isCreating && pending?.kind === 'pr' && pending.prNumber === pr.number}
              disabled={isCreating}
              onSelect={() => onStart({
                kind: 'pr',
                // Server uses prNumber to fetch `refs/pull/<N>/head` — the
                // bare headRefName isn't reliable because it only exists
                // locally if the user has checked the branch out.
                baseBranch: '',
                prNumber: pr.number,
                labelSeed: `#${pr.number} ${pr.title}`,
                display: {
                  primary: `#${pr.number} ${pr.title}`,
                  secondary: `${pr.headRefName} · @${pr.author.login}`,
                },
              })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PRRow({ pr, isPending, disabled, onSelect }: {
  pr: PRSummary; isPending: boolean; disabled: boolean; onSelect: () => void;
}) {
  const opened = formatRelativeTime(pr.createdAt);
  const updated = formatRelativeTime(pr.updatedAt);
  const sameTime = opened === updated;
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'w-full flex items-start gap-2.5 px-3 py-2 rounded-md text-left transition-colors',
        isPending
          ? 'bg-primary/10 border border-primary/30'
          : 'border border-transparent hover:bg-muted/40',
        disabled && !isPending && 'opacity-50 cursor-not-allowed',
      )}
    >
      {isPending ? (
        <Loader2 size={12} className="mt-0.5 flex-shrink-0 animate-spin text-primary" />
      ) : (
        <GitPullRequest size={12} className={cn('mt-0.5 flex-shrink-0', pr.isDraft ? 'text-muted-foreground' : 'text-emerald-500/80')} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-mono text-muted-foreground/70">#{pr.number}</span>
          <span className="text-[12px] font-medium text-foreground truncate">{pr.title}</span>
          {pr.isDraft && (
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 px-1 py-0.5 rounded bg-muted/60">draft</span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground/70 mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span className="font-mono truncate">{pr.headRefName} → {pr.baseRefName}</span>
          <span className="opacity-60">·</span>
          <span>@{pr.author.login}</span>
          <span className="opacity-60">·</span>
          <span title={new Date(pr.createdAt).toLocaleString()}>
            opened {opened}
          </span>
          {!sameTime && (
            <>
              <span className="opacity-60">·</span>
              <span title={new Date(pr.updatedAt).toLocaleString()}>
                updated {updated}
              </span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Branch tab ───────────────────────────────────────────────

function BranchTab({ workspaceId, pending, isCreating, onStart }: {
  workspaceId: string | null;
  pending: Selection | null;
  isCreating: boolean;
  onStart: (s: Selection) => void;
}) {
  const [filter, setFilter] = useState('');
  const { data: branches, isLoading, error } = useWorkspaceBranches(workspaceId);

  const filtered = useMemo(() => {
    if (!branches) return [];
    if (!filter.trim()) return branches;
    const q = filter.toLowerCase();
    return branches.filter((b) => b.toLowerCase().includes(q));
  }, [branches, filter]);

  return (
    <div className="h-full flex flex-col">
      <SearchBar value={filter} onChange={setFilter} placeholder="Filter branches…" />
      {isLoading && <ListLoading />}
      {error && <ErrorState error={error} hint="Couldn't list branches." />}
      {!isLoading && !error && filtered.length === 0 && <EmptyList kind="branches" />}
      {!isLoading && !error && filtered.length > 0 && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
          {filtered.map((branch) => {
            const isPending = isCreating && pending?.kind === 'branch' && pending.baseBranch === branch;
            const labelSeed = branch.replace(/^origin\//, '');
            return (
              <button
                key={branch}
                disabled={isCreating}
                onClick={() => onStart({
                  kind: 'branch',
                  baseBranch: branch,
                  labelSeed: `From ${labelSeed}`,
                  display: { primary: branch },
                })}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-colors',
                  isPending
                    ? 'bg-primary/10 border border-primary/30'
                    : 'border border-transparent hover:bg-muted/40',
                  isCreating && !isPending && 'opacity-50 cursor-not-allowed',
                )}
              >
                {isPending ? (
                  <Loader2 size={11} className="flex-shrink-0 animate-spin text-primary" />
                ) : (
                  <GitBranch size={11} className="flex-shrink-0 text-muted-foreground/70" />
                )}
                <span className="text-[12px] font-mono text-foreground truncate">{branch}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Issue tab ────────────────────────────────────────────────

function IssueTab({ workspaceId, pending, isCreating, onStart }: {
  workspaceId: string | null;
  pending: Selection | null;
  isCreating: boolean;
  onStart: (s: Selection) => void;
}) {
  const [filter, setFilter] = useState('');
  const { data: issues, isLoading, error } = useWorkspaceIssues(workspaceId);

  const filtered = useMemo(() => {
    if (!issues) return [];
    if (!filter.trim()) return issues;
    const q = filter.toLowerCase();
    return issues.filter((i) =>
      i.title.toLowerCase().includes(q) || String(i.number).includes(q),
    );
  }, [issues, filter]);

  return (
    <div className="h-full flex flex-col">
      <SearchBar value={filter} onChange={setFilter} placeholder="Filter issues…" />
      {isLoading && <ListLoading />}
      {error && <ErrorState error={error} hint="Make sure gh is installed and authenticated." />}
      {!isLoading && !error && filtered.length === 0 && <EmptyList kind="open issues" />}
      {!isLoading && !error && filtered.length > 0 && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {filtered.map((issue) => (
            <IssueRow
              key={issue.number}
              issue={issue}
              isPending={
                isCreating && pending?.kind === 'issue' &&
                pending.labelSeed === `#${issue.number} ${issue.title}`
              }
              disabled={isCreating}
              onSelect={() => onStart({
                kind: 'issue',
                // Issues don't have a head branch — branch off the workspace
                // default. baseBranch left empty defers to ws.base_branch.
                baseBranch: '',
                labelSeed: `#${issue.number} ${issue.title}`,
                display: {
                  primary: `#${issue.number} ${issue.title}`,
                  secondary: `@${issue.author.login}`,
                },
              })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function IssueRow({ issue, isPending, disabled, onSelect }: {
  issue: IssueSummary; isPending: boolean; disabled: boolean; onSelect: () => void;
}) {
  const opened = formatRelativeTime(issue.createdAt);
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'w-full flex items-start gap-2.5 px-3 py-2 rounded-md text-left transition-colors',
        isPending
          ? 'bg-primary/10 border border-primary/30'
          : 'border border-transparent hover:bg-muted/40',
        disabled && !isPending && 'opacity-50 cursor-not-allowed',
      )}
    >
      {isPending ? (
        <Loader2 size={12} className="mt-0.5 flex-shrink-0 animate-spin text-primary" />
      ) : (
        <CircleDot size={12} className="mt-0.5 flex-shrink-0 text-emerald-500/80" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-mono text-muted-foreground/70">#{issue.number}</span>
          <span className="text-[12px] font-medium text-foreground truncate">{issue.title}</span>
        </div>
        <div className="text-[10px] text-muted-foreground/70 mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span>@{issue.author.login}</span>
          <span className="opacity-60">·</span>
          <span title={new Date(issue.createdAt).toLocaleString()}>opened {opened}</span>
          {issue.labels.slice(0, 3).map((l) => (
            <span key={l.name} className="px-1.5 py-0.5 rounded text-[9px] bg-muted/60 text-muted-foreground">
              {l.name}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

// ─── Shared list states ───────────────────────────────────────

function ListLoading() {
  return (
    <div className="flex-1 flex items-center justify-center text-[11px] text-muted-foreground/70 gap-2">
      <Loader2 size={12} className="animate-spin" />
      Loading…
    </div>
  );
}

function EmptyList({ kind }: { kind: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-[11px] text-muted-foreground/70 italic">
      No {kind} found.
    </div>
  );
}

function ErrorState({ error, hint }: { error: unknown; hint: string }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-[11px] text-center px-8 gap-1.5">
      <span className="text-destructive">{message}</span>
      <span className="text-muted-foreground/70">{hint}</span>
    </div>
  );
}
