'use client';

/**
 * Reference folders for a workspace (docs/reference-folders-spec.md §9).
 *
 * Read-only folders this workspace's agents may consult. The list shows the
 * workspace's own rows plus every global one, since that's exactly what an
 * agent running here would see.
 *
 * The copy deliberately does not promise a sandbox. The guard is a prompt
 * instruction plus a tool filter, and a determined shell command could still
 * write. Saying "read-only" and nothing else would overclaim.
 */

import { useState } from 'react';
import { Loader2, Plus, Globe, GitBranch, AlertTriangle, Trash2, Pencil, CornerUpLeft } from 'lucide-react';
import { toast } from 'sonner';
import slugify from '@sindresorhus/slugify';
import {
  useReferenceFolders,
  useReferencedBy,
  useCreateReferenceFolder,
  useUpdateReferenceFolder,
  useArchiveReferenceFolder,
} from '@/hooks/use-reference-folders';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ReferenceFolderDialog, type ReferenceFolderDraft } from './reference-folder-dialog';
import { cn } from '@/lib/utils';
import type { ResolvedReferenceFolder } from '@/db/types';

function errMsg(e: unknown): string {
  const body = (e as { body?: { error?: string } }).body;
  if (body?.error) return body.error;
  return e instanceof Error ? e.message : String(e);
}

/** Mirrors the prompt block's git line so what you see is what the agent reads. */
function gitSummary(ref: ResolvedReferenceFolder): string | null {
  if (!ref.git) return null;
  const parts = [ref.git.branch ?? 'detached HEAD', ref.git.dirty ? 'uncommitted' : 'clean'];
  if (ref.git.behind) parts.push(`${ref.git.behind} behind`);
  if (ref.git.ahead) parts.push(`${ref.git.ahead} ahead`);
  return parts.join(' · ');
}

export function ReferenceFoldersSection({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName?: string;
}) {
  const { data: refs, isLoading } = useReferenceFolders(workspaceId);
  const { data: referencedBy } = useReferencedBy(workspaceId);
  const create = useCreateReferenceFolder();
  const update = useUpdateReferenceFolder();
  const archive = useArchiveReferenceFolder();
  const confirm = useConfirm();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ResolvedReferenceFolder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openAdd = () => {
    setEditing(null);
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (ref: ResolvedReferenceFolder) => {
    setEditing(ref);
    setError(null);
    setDialogOpen(true);
  };

  const handleSubmit = (draft: ReferenceFolderDraft) => {
    setError(null);
    const onError = (e: unknown) => setError(errMsg(e));
    const { addReverse, ...input } = draft;

    if (editing) {
      update.mutate(
        { id: editing.id, ...input },
        {
          onSuccess: () => {
            toast.success(`@${draft.alias} updated`);
            setDialogOpen(false);
          },
          onError,
        },
      );
      return;
    }

    create.mutate(input, {
      onSuccess: async () => {
        setDialogOpen(false);
        if (!addReverse || !input.targetWorkspaceId || !workspaceName) {
          toast.success(`@${draft.alias} added`);
          return;
        }
        // The forward reference is already saved. A failure on the mirror is
        // reported but must not read as though the whole thing failed.
        const reverseAlias = slugify(workspaceName, { separator: '-' });
        try {
          await create.mutateAsync({
            workspaceId: input.targetWorkspaceId,
            alias: reverseAlias,
            targetWorkspaceId: workspaceId,
            path: null,
            description: null,
          });
          toast.success(`@${draft.alias} added, and @${reverseAlias} back the other way`);
        } catch (e) {
          toast.warning(
            `@${draft.alias} added, but the reverse reference failed: ${errMsg(e)}`,
          );
        }
      },
      onError,
    });
  };

  const handleArchive = async (ref: ResolvedReferenceFolder) => {
    const ok = await confirm({
      title: `Remove @${ref.alias}?`,
      description: ref.global
        ? 'This reference is visible in every workspace, so removing it affects all of them. Nothing on disk is touched.'
        : 'Agents in this workspace stop being told about the folder. Nothing on disk is touched.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    archive.mutate(ref.id, {
      onSuccess: () => toast.success(`@${ref.alias} removed`),
      onError: (e) => toast.error(errMsg(e)),
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Reference folders</h3>
        <p className="text-[12px] leading-normal text-muted-foreground">
          Read-only folders this workspace can see. Agents are told they exist and may search them,
          so they stop guessing at what a sibling repo contains.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading reference folders…
        </div>
      ) : !refs || refs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground/70">
          No reference folders yet. Add the backend repo, a design system, a docs folder, anything
          worth consulting from here.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {refs.map((ref) => (
            <li
              key={ref.id}
              className="group rounded-lg border border-border bg-muted/20 px-3 py-2 text-[11px]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold text-foreground">@{ref.alias}</span>
                    {ref.global && (
                      <span
                        title="Visible in every workspace"
                        className="flex items-center gap-0.5 rounded bg-accent px-1 py-px text-[9px] text-muted-foreground"
                      >
                        <Globe size={8} /> global
                      </span>
                    )}
                    {!ref.exists && (
                      <span className="flex items-center gap-0.5 rounded bg-destructive/15 px-1 py-px text-[9px] text-destructive">
                        <AlertTriangle size={8} /> missing
                      </span>
                    )}
                    {ref.redundantWithCwd && (
                      <span
                        title="Already inside this workspace's own folder"
                        className="rounded bg-amber-500/15 px-1 py-px text-[9px] text-amber-500"
                      >
                        inside cwd
                      </span>
                    )}
                  </div>
                  <p
                    className={cn(
                      'mt-0.5 truncate font-mono text-[10px]',
                      ref.exists ? 'text-muted-foreground/70' : 'text-destructive/70 line-through',
                    )}
                    title={ref.absolutePath}
                  >
                    {ref.absolutePath}
                  </p>
                  {ref.description && (
                    <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground/85">
                      {ref.description}
                    </p>
                  )}
                  {gitSummary(ref) && (
                    <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/60">
                      <GitBranch size={9} className="shrink-0" />
                      {gitSummary(ref)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => openEdit(ref)}
                    title="Edit"
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleArchive(ref)}
                    title="Remove"
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={openAdd}
        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus size={12} />
        Add reference folder
      </button>

      {referencedBy && referencedBy.referencedBy.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-lg border border-border bg-muted/20 px-2.5 py-2 text-[10.5px] text-muted-foreground">
          <CornerUpLeft size={11} className="mt-px shrink-0" />
          <span>
            Referenced by{' '}
            {referencedBy.referencedBy
              .map((r) => r.workspaceName ?? 'every workspace (global)')
              .join(', ')}
            . References are one-way, so those agents can read this folder but nothing here
            changes.
          </span>
        </div>
      )}

      <p className="text-[10px] leading-snug text-muted-foreground/60">
        Read-only means an instruction plus a tool filter that blocks the editing tools, not an OS
        sandbox. To change one of these folders, open it as its own workspace.
      </p>

      <ReferenceFolderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        editing={editing}
        existing={refs ?? []}
        saving={create.isPending || update.isPending}
        error={error}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
