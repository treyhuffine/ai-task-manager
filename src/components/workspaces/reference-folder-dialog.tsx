'use client';

/**
 * Add or edit one reference folder (docs/reference-folders-spec.md §9).
 *
 * The whole point is that adding one should feel like nothing: pick a folder,
 * confirm the alias we guessed, done. Description is optional and the global
 * toggle is off by default, so the common path is two clicks.
 */

import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Loader2, AlertTriangle } from 'lucide-react';
import slugify from '@sindresorhus/slugify';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { FolderPickerDialog } from './folder-picker-dialog';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import type { ResolvedReferenceFolder } from '@/db/types';

export interface ReferenceFolderDraft {
  alias: string;
  path: string | null;
  targetWorkspaceId: string | null;
  description: string | null;
  workspaceId: string | null;
  /**
   * Also create the mirror reference, pointing the target workspace back at
   * this one. References are one-way by design, so this is opt-in — but when
   * two codebases genuinely depend on each other, wanting both is the norm.
   */
  addReverse?: boolean;
}

interface ReferenceFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Workspace the reference is being added from. Null = editing a global row. */
  workspaceId: string | null;
  /** Name of that workspace, used in the "add the reverse too" copy. */
  workspaceName?: string;
  /** Existing row when editing; null when adding. */
  editing?: ResolvedReferenceFolder | null;
  /** Aliases already taken in this view, used for the shadow/conflict warning. */
  existing: ResolvedReferenceFolder[];
  saving: boolean;
  error: string | null;
  onSubmit: (draft: ReferenceFolderDraft) => void;
}

type Mode = 'folder' | 'workspace';

/** Alias suggestion from a folder name or workspace name. Never overrides typing. */
function aliasFromPath(p: string): string {
  const leaf = p.replace(/\/+$/, '').split('/').pop() ?? '';
  return slugify(leaf, { separator: '-' });
}

export function ReferenceFolderDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  editing,
  existing,
  saving,
  error,
  onSubmit,
}: ReferenceFolderDialogProps) {
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  const [mode, setMode] = useState<Mode>('folder');
  const [path, setPath] = useState('');
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('');
  const [alias, setAlias] = useState('');
  const [aliasTouched, setAliasTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [global, setGlobal] = useState(false);
  const [addReverse, setAddReverse] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Reset on every open so a previous add doesn't bleed into the next one.
  useEffect(() => {
    if (!open) return;
    setMode(editing?.targetWorkspaceId ? 'workspace' : 'folder');
    setPath(editing?.path ?? '');
    setTargetWorkspaceId(editing?.targetWorkspaceId ?? '');
    setAlias(editing?.alias ?? '');
    setAliasTouched(!!editing);
    setDescription(editing?.description ?? '');
    setGlobal(editing ? editing.workspaceId === null : false);
    setAddReverse(false);
    setPickerOpen(false);
  }, [open, editing]);

  const selectableWorkspaces = useMemo(
    // A workspace referencing itself is rejected server-side; don't offer it.
    () => (workspaces ?? []).filter((w) => w.id !== workspaceId),
    [workspaces, workspaceId],
  );

  // Keep the alias in lockstep with the target until the user types their own.
  useEffect(() => {
    if (aliasTouched) return;
    if (mode === 'folder' && path) setAlias(aliasFromPath(path));
    if (mode === 'workspace' && targetWorkspaceId) {
      const ws = selectableWorkspaces.find((w) => w.id === targetWorkspaceId);
      if (ws) setAlias(slugify(ws.name, { separator: '-' }));
    }
  }, [mode, path, targetWorkspaceId, aliasTouched, selectableWorkspaces]);

  const normalizedAlias = alias.trim().toLowerCase();
  const aliasValid = /^[a-z0-9][a-z0-9._-]*$/.test(normalizedAlias);
  const hasTarget = mode === 'folder' ? path.trim().length > 0 : targetWorkspaceId.length > 0;
  const canSubmit = aliasValid && hasTarget && !saving;

  // Adding a workspace-scoped alias that matches a global one is allowed —
  // the workspace row wins — but it's worth saying out loud.
  const shadowed = existing.find(
    (r) => r.alias === normalizedAlias && r.id !== editing?.id && r.global && !global,
  );
  const duplicate = existing.find(
    (r) => r.alias === normalizedAlias && r.id !== editing?.id && r.global === global,
  );

  // Only meaningful when adding a workspace→workspace reference from a real
  // workspace. A global reference is already visible everywhere, and editing
  // an existing row shouldn't quietly create a second one.
  const canAddReverse =
    !editing && mode === 'workspace' && !global && !!workspaceId && !!targetWorkspaceId;
  const reverseTargetName = selectableWorkspaces.find((w) => w.id === targetWorkspaceId)?.name;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      alias: normalizedAlias,
      path: mode === 'folder' ? path.trim() : null,
      targetWorkspaceId: mode === 'workspace' ? targetWorkspaceId : null,
      description: description.trim() || null,
      workspaceId: global ? null : workspaceId,
      addReverse: canAddReverse && addReverse,
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit reference folder' : 'Add reference folder'}</DialogTitle>
            <DialogDescription>
              A folder this workspace&apos;s agents can read and search but never change.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
              <ModeTab active={mode === 'folder'} onClick={() => setMode('folder')}>
                Folder on disk
              </ModeTab>
              <ModeTab active={mode === 'workspace'} onClick={() => setMode('workspace')}>
                Another workspace
              </ModeTab>
            </div>

            {mode === 'folder' ? (
              <Field label="Folder">
                <div className="flex gap-2">
                  <input
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="/Users/you/code/api"
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <FolderOpen size={13} />
                    Browse
                  </button>
                </div>
                <FieldHint>
                  Anything with a path works: a sibling repo, a docs folder, even an installed
                  dependency under <code className="font-mono">node_modules</code>.
                </FieldHint>
              </Field>
            ) : (
              <Field label="Workspace">
                <select
                  value={targetWorkspaceId}
                  onChange={(e) => setTargetWorkspaceId(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Choose a workspace…</option>
                  {selectableWorkspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.emoji ? `${w.emoji} ${w.name}` : w.name}
                    </option>
                  ))}
                </select>
                <FieldHint>
                  Follows the workspace if its folder moves. The agent reads whatever is checked
                  out there, not any in-progress worktree.
                </FieldHint>
              </Field>
            )}

            <Field label="Alias">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">@</span>
                <input
                  value={alias}
                  onChange={(e) => {
                    setAlias(e.target.value);
                    setAliasTouched(true);
                  }}
                  placeholder="backend"
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              {normalizedAlias && !aliasValid ? (
                <FieldHint tone="error">
                  Lowercase letters, digits, dot, dash or underscore. Must start with a letter or
                  digit.
                </FieldHint>
              ) : (
                <FieldHint>What you type after @ in chat to point the agent here.</FieldHint>
              )}
            </Field>

            <Field label="Why you'd look there">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Go API server this app calls. HTTP routes live in internal/http/."
                className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <FieldHint>
                Optional. Worth a line when the name alone doesn&apos;t say why the agent would
                open it.
              </FieldHint>
            </Field>

            <label className="flex cursor-pointer items-start justify-between gap-3">
              <span className="text-[11px] leading-relaxed text-muted-foreground/85">
                Visible in every workspace
                <span className="block text-muted-foreground/60">
                  Use for something shared, like a design system several apps consume.
                </span>
              </span>
              <Switch checked={global} onCheckedChange={setGlobal} className="mt-0.5" />
            </label>

            {canAddReverse && (
              <label className="flex cursor-pointer items-start justify-between gap-3">
                <span className="text-[11px] leading-relaxed text-muted-foreground/85">
                  Also reference back
                  <span className="block text-muted-foreground/60">
                    Adds{' '}
                    <span className="font-mono">@{slugify(workspaceName ?? '', { separator: '-' })}</span>{' '}
                    inside {reverseTargetName ?? 'that workspace'}, so the two can read each other.
                  </span>
                </span>
                <Switch checked={addReverse} onCheckedChange={setAddReverse} className="mt-0.5" />
              </label>
            )}

            {duplicate && (
              <Notice tone="error">
                A {global ? 'global' : 'workspace'} reference named{' '}
                <code className="font-mono">{normalizedAlias}</code> already exists.
              </Notice>
            )}
            {!duplicate && shadowed && (
              <Notice tone="warning">
                This shadows the global <code className="font-mono">{normalizedAlias}</code>. In
                this workspace, yours wins.
              </Notice>
            )}
            {error && <Notice tone="error">{error}</Notice>}
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:opacity-40"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              {editing ? 'Save' : 'Add reference'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FolderPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialPath={path || undefined}
        onChoose={(chosen) => {
          setPath(chosen);
          setPickerOpen(false);
        }}
      />
    </>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function FieldHint({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'error';
}) {
  return (
    <p
      className={cn(
        'mt-1 text-[10px] leading-snug',
        tone === 'error' ? 'text-destructive' : 'text-muted-foreground/70',
      )}
    >
      {children}
    </p>
  );
}

function Notice({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'warning' | 'error';
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border p-2.5 text-[11px]',
        tone === 'error'
          ? 'border-destructive/20 bg-destructive/10 text-destructive'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-500',
      )}
    >
      <AlertTriangle size={13} className="mt-px shrink-0" />
      <span>{children}</span>
    </div>
  );
}
