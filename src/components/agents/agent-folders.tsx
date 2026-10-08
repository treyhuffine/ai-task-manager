'use client';

/**
 * An agent's folders on each of the person's devices (docs/homes-spec.md
 * §4.1-4.2): its project folder, and the folders it links to beside it,
 * which its agents can change unless one is read only. A switcher across the devices, and
 * for the one chosen, each folder with whether it's there, Change, and for a
 * linked folder, Go without it. The home's records are the only place these
 * are kept, so any screen can change any device's.
 */

import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, CornerUpLeft, GitBranch, Globe, Home as HomeIcon, Loader2, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import slugify from '@sindresorhus/slugify';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAgentFolders, useChangeAgentFolders } from '@/hooks/use-workspaces';
import {
  useArchiveReferenceFolder,
  useCreateReferenceFolder,
  useReferencedBy,
  useReferenceFolders,
  useUpdateReferenceFolder,
} from '@/hooks/use-reference-folders';
import { apiErrorText } from '@/lib/api/client';
import { ReferenceFolderDialog, type LinkedFolderDefinition, type ReferenceFolderDraft } from '@/components/workspaces/reference-folder-dialog';
import { SetupAgentDialog } from './setup-agent-dialog';
import { FolderField } from './folder-field';
import type { AgentFoldersOn, LinkedFolderOn } from '@/lib/setups/folders';
import type { ReferenceFolderGitState, WorkspaceRecord } from '@/db/types';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/ui/tip';

type Device = { id: string; name: string };

/** How a device stands for this agent, for its dot in the switcher. */
function standing(c: AgentFoldersOn): 'none' | 'ready' | 'unchecked' | 'problem' {
  if (!c.setup) return 'none';
  if (c.setup.status === 'ready') return 'ready';
  if (c.setup.status === 'unchecked') return 'unchecked';
  return 'problem';
}

/** Mirrors the prompt block's git line so what you see is what the agent reads. */
function gitSummary(git: ReferenceFolderGitState | null | undefined): string | null {
  if (!git) return null;
  const parts = [git.branch ?? 'detached HEAD', git.dirty ? 'uncommitted' : 'clean'];
  if (git.behind) parts.push(`${git.behind} behind`);
  if (git.ahead) parts.push(`${git.ahead} ahead`);
  return parts.join(' · ');
}

export function AgentFoldersSection({ workspace }: { workspace: WorkspaceRecord }) {
  const { data, isLoading, error } = useAgentFolders(workspace.id);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const devices = data?.devices ?? [];
  const selected = devices.find((c) => c.deviceId === chosenId) ?? devices[0] ?? null;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Folders</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground/75">
          Where {workspace.name} is on each of your devices, and the folders it links to beside it. Its executions and
          main chat can read and change linked folders, except ones you make read only.
        </p>
      </div>

      {isLoading && (
        <p className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading folders…
        </p>
      )}
      {error && <p className="text-[12px] text-destructive">{apiErrorText(error)}</p>}

      {devices.length > 1 && (
        <div role="tablist" aria-label="Devices" className="flex flex-wrap gap-1.5">
          {devices.map((c) => {
            const s = standing(c);
            const active = c.deviceId === selected?.deviceId;
            return (
              <button
                key={c.deviceId}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setChosenId(c.deviceId)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors',
                  active ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    s === 'ready' && 'bg-emerald-500',
                    s === 'unchecked' && 'bg-muted-foreground/50',
                    s === 'problem' && 'bg-amber-500',
                    s === 'none' && 'border border-muted-foreground/50',
                  )}
                />
                {c.isHome && <HomeIcon size={11} className="shrink-0" aria-label="Your Ri's home" />}
                {c.name}
                {s === 'none' && <span className="text-muted-foreground/70">· not set up</span>}
              </button>
            );
          })}
        </div>
      )}

      {selected && <OnDevice key={selected.deviceId} workspace={workspace} on={selected} />}

      {devices.length === 1 && (
        <p className="text-[10.5px] text-muted-foreground/60">
          Your other devices show here once Ri runs on them, connected to this one.
        </p>
      )}

      <ReferencedBy workspaceId={workspace.id} />
    </section>
  );
}

/** The agent's folders on one device. */
function OnDevice({ workspace, on }: { workspace: WorkspaceRecord; on: AgentFoldersOn }) {
  const change = useChangeAgentFolders(workspace.id);
  const confirm = useConfirm();
  const device: Device = { id: on.deviceId, name: on.name };
  const [settingUp, setSettingUp] = useState(false);
  const [choosing, setChoosing] = useState<null | { kind: 'project' } | { kind: 'linked'; ref: LinkedFolderOn }>(null);
  const [defining, setDefining] = useState<null | { editing: LinkedFolderDefinition | null }>(null);
  // Git state for linked folders on the home, where Ri can look at them itself.
  const { data: resolved } = useReferenceFolders(on.isHome ? workspace.id : null);
  const gitOf = (id: string) => (on.isHome ? resolved?.find((r) => r.id === id)?.git : null);

  if (!on.setup) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed border-border px-3 py-4 text-center">
        <p className="text-[12.5px] text-foreground">
          {workspace.name} isn&apos;t on {on.name} yet.
        </p>
        <Button size="sm" onClick={() => setSettingUp(true)} disabled={!on.connected}>
          Set up on {on.name}
        </Button>
        <p className="text-[11px] text-muted-foreground/75">
          {on.connected
            ? "Copy it from Git, or use a folder that's already there."
            : `${on.name} isn't running Ri right now. Start it there, then set it up.`}
        </p>
        <SetupAgentDialog
          workspaceId={workspace.id}
          agentName={workspace.name}
          device={device}
          open={settingUp}
          onOpenChange={setSettingUp}
        />
      </div>
    );
  }

  const remove = async () => {
    const ok = await confirm({
      title: `Remove ${workspace.name} from ${on.name}?`,
      description: `New work in ${workspace.name} won't run on ${on.name}. Nothing on ${on.name} is deleted, and you can set it up there again later.`,
      confirmLabel: 'Remove',
      tone: 'destructive',
    });
    if (!ok) return;
    change.remove.mutate(on.deviceId, {
      onSuccess: () => toast.success(`${workspace.name} removed from ${on.name}`),
      onError: (err) => toast.error(apiErrorText(err)),
    });
  };

  const goWithout = (ref: LinkedFolderOn) =>
    change.linked.mutate(
      { deviceId: on.deviceId, referenceFolderId: ref.referenceFolderId, folder: null },
      { onError: (err) => toast.error(apiErrorText(err)) },
    );

  const setup = on.setup;
  const projectState = setup.found === true ? 'found' : setup.found === false ? 'missing' : 'unchecked';

  return (
    <div className="space-y-3">
      {!on.connected && (
        <p className="text-[11px] text-muted-foreground/75">
          {on.name} isn&apos;t running Ri right now. Changes are kept here and checked on {on.name} when it&apos;s back.
        </p>
      )}
      {setup.problem && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-600 dark:text-amber-400">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{setup.problem}</span>
        </p>
      )}

      <FolderRow
        title="Project folder"
        path={setup.folder}
        state={projectState}
        deviceName={on.name}
        actions={
          <RowButton onClick={() => setChoosing({ kind: 'project' })} emphasis={projectState === 'missing'}>
            Change
          </RowButton>
        }
      />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Linked folders</p>
          <button
            type="button"
            onClick={() => setDefining({ editing: null })}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus size={12} />
            Add a linked folder
          </button>
        </div>
        {on.linked.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[11px] text-muted-foreground/70">
            None yet. Link the backend repo, a design system, a docs folder, anything worth reading from here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {on.linked.map((ref) => (
              <LinkedRow
                key={ref.referenceFolderId}
                refOn={ref}
                deviceName={on.name}
                git={gitOf(ref.referenceFolderId)}
                onChange={() => setChoosing({ kind: 'linked', ref })}
                onGoWithout={() => goWithout(ref)}
                onEdit={() =>
                  setDefining({
                    editing: {
                      id: ref.referenceFolderId,
                      alias: ref.alias,
                      description: ref.description,
                      workspaceId: ref.forEveryAgent ? null : workspace.id,
                      targetWorkspaceId: ref.agent?.id ?? null,
                      readOnly: ref.readOnly,
                    },
                  })
                }
                pending={change.linked.isPending && change.linked.variables?.referenceFolderId === ref.referenceFolderId}
              />
            ))}
          </ul>
        )}
      </div>

      {!on.isHome && (
        <div className="pt-1">
          <button
            type="button"
            onClick={remove}
            disabled={change.remove.isPending}
            className="flex items-center gap-1.5 text-[11px] text-destructive hover:underline disabled:opacity-50"
          >
            <Trash2 size={11} />
            Remove from {on.name}
          </button>
        </div>
      )}

      <ChooseFolderDialog
        open={choosing !== null}
        onOpenChange={(open) => !open && setChoosing(null)}
        device={device}
        browsable={on.connected}
        title={
          choosing?.kind === 'linked'
            ? `Where @${choosing.ref.alias} is on ${on.name}`
            : `Where ${workspace.name} is on ${on.name}`
        }
        description={
          choosing?.kind === 'linked'
            ? choosing.ref.forEveryAgent
              ? `Every agent on ${on.name} uses this place for it.`
              : `Only ${on.name} changes. Your other devices keep their own place for it.`
            : on.isHome
              ? `Its live sessions restart in the new folder. Only ${on.name} changes.`
              : `Only ${on.name} changes. Your other devices keep their own folder for it.`
        }
        initial={choosing?.kind === 'linked' ? (choosing.ref.path ?? '') : setup.folder}
        onSave={(folder) =>
          choosing?.kind === 'linked'
            ? change.linked.mutateAsync({ deviceId: on.deviceId, referenceFolderId: choosing.ref.referenceFolderId, folder })
            : change.project.mutateAsync({ deviceId: on.deviceId, folder })
        }
      />

      <LinkedFolderDefiner
        workspace={workspace}
        on={on}
        editing={defining?.editing ?? null}
        open={defining !== null}
        onOpenChange={(open) => !open && setDefining(null)}
      />
    </div>
  );
}

type RowState = 'found' | 'missing' | 'unchecked';

function FolderRow({
  title,
  path,
  state,
  deviceName,
  actions,
}: {
  title: string;
  path: string;
  state: RowState;
  deviceName: string;
  actions: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <PathLine path={path} state={state} deviceName={deviceName} />
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </div>
    </div>
  );
}

function PathLine({ path, state, deviceName }: { path: string; state: RowState; deviceName: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        className={cn('min-w-0 break-all font-mono text-[11px]', state === 'missing' ? 'text-destructive/80 line-through' : 'text-foreground/85')}
      >
        {path}
      </span>
      {state === 'found' && <Check size={12} className="shrink-0 text-emerald-500" aria-label="There" />}
      {state === 'missing' && <span className="shrink-0 text-[10.5px] text-destructive">Not there</span>}
      {state === 'unchecked' && (
        <Tip label={`Checked when ${deviceName} is running Ri`}>
          <span className="shrink-0 text-[10.5px] text-muted-foreground/70">
            Not checked yet
          </span>
        </Tip>
      )}
    </span>
  );
}

function LinkedRow({
  refOn,
  deviceName,
  git,
  onChange,
  onGoWithout,
  onEdit,
  pending,
}: {
  refOn: LinkedFolderOn;
  deviceName: string;
  git: ReferenceFolderGitState | null | undefined;
  onChange: () => void;
  onGoWithout: () => void;
  onEdit: () => void;
  pending: boolean;
}) {
  const { state, agent } = refOn;
  const summary = state === 'found' ? gitSummary(git) : null;
  return (
    <li className="group rounded-lg border border-border bg-muted/20 px-3 py-2 text-[11px]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono font-semibold text-foreground">@{refOn.alias}</span>
            {refOn.readOnly && (
              <span className="flex items-center gap-0.5 rounded bg-accent px-1 py-px text-[9px] text-muted-foreground">
                <Lock size={8} /> read only
              </span>
            )}
            {refOn.forEveryAgent && (
              <span className="flex items-center gap-0.5 rounded bg-accent px-1 py-px text-[9px] text-muted-foreground">
                <Globe size={8} /> every agent
              </span>
            )}
            {agent && <span className="rounded bg-accent px-1 py-px text-[9px] text-muted-foreground">agent: {agent.name}</span>}
          </div>
          {refOn.description && <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground/85">{refOn.description}</p>}
        </div>
        <Tip label={`Edit @${refOn.alias}`}>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit @${refOn.alias}`}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-60 transition-colors hover:bg-accent hover:text-foreground group-hover:opacity-100"
          >
            <Pencil size={11} />
          </button>
        </Tip>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {agent ? (
          refOn.path ? (
            <PathLine path={refOn.path} state={state === 'missing' ? 'missing' : state === 'found' ? 'found' : 'unchecked'} deviceName={deviceName} />
          ) : (
            <span className="text-[10.5px] text-muted-foreground">
              {agent.name} isn&apos;t on {deviceName}, so this goes without it there.
            </span>
          )
        ) : state === 'omitted' ? (
          <span className="text-[10.5px] text-muted-foreground">Going without it on {deviceName}.</span>
        ) : state === 'unchosen' ? (
          <span className="flex items-center gap-1 text-[10.5px] text-amber-600 dark:text-amber-400">
            <AlertTriangle size={10} className="shrink-0" />
            Not chosen on {deviceName} yet.
          </span>
        ) : (
          <PathLine path={refOn.path ?? ''} state={state} deviceName={deviceName} />
        )}
        {!agent && (
          <div className="flex shrink-0 items-center gap-1">
            {pending && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
            <RowButton onClick={onChange} emphasis={state === 'missing' || state === 'unchosen'}>
              {state === 'omitted' || state === 'unchosen' ? 'Choose' : 'Change'}
            </RowButton>
            {state !== 'omitted' && (
              <RowButton onClick={onGoWithout} disabled={pending}>
                Go without it
              </RowButton>
            )}
          </div>
        )}
      </div>
      {summary && (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <GitBranch size={9} className="shrink-0" />
          {summary}
        </p>
      )}
    </li>
  );
}

function RowButton({
  onClick,
  emphasis,
  disabled,
  children,
}: {
  onClick: () => void;
  emphasis?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40',
        emphasis ? 'bg-primary/10 text-primary hover:bg-primary/15' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** Choose a folder on a device: typed, or browsed there. Checked there on save. */
function ChooseFolderDialog({
  open,
  onOpenChange,
  device,
  browsable,
  title,
  description,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device: Device;
  browsable: boolean;
  title: string;
  description: string;
  initial: string;
  onSave: (folder: string) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted each time it opens: every open starts from where the folder is now. */}
        {open && (
          <ChooseFolderBody
            device={device}
            browsable={browsable}
            title={title}
            description={description}
            initial={initial}
            onSave={onSave}
            onBusy={setBusy}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChooseFolderBody({
  device,
  browsable,
  title,
  description,
  initial,
  onSave,
  onBusy,
  onDone,
}: {
  device: Device;
  browsable: boolean;
  title: string;
  description: string;
  initial: string;
  onSave: (folder: string) => Promise<unknown>;
  onBusy: (busy: boolean) => void;
  onDone: () => void;
}) {
  const [folder, setFolder] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const unchanged = folder.trim() === initial.trim();

  const save = async () => {
    if (!folder.trim()) {
      setProblem(`Type where it is on ${device.name}, or browse for it.`);
      return;
    }
    setProblem(null);
    setSaving(true);
    onBusy(true);
    try {
      await onSave(folder.trim());
      onDone();
    } catch (err) {
      setProblem(apiErrorText(err));
    } finally {
      setSaving(false);
      onBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="break-words">{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-2"
      >
        <FolderField value={folder} onChange={setFolder} device={device} browsable={browsable} placeholder="~/code/project" autoFocus />
        {!browsable && (
          <p className="text-[11px] text-muted-foreground/75">
            {device.name} isn&apos;t running Ri right now, so type the whole path. It&apos;s checked there when it&apos;s back.
          </p>
        )}
        {problem && <p className="text-[12px] text-destructive">{problem}</p>}
      </form>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={saving || unchanged}>
          {saving && <Loader2 size={13} className="animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Add a linked folder, placed on the device it's added from, or edit what
 * one is. Another agent needs no place: it's that agent's folder on each
 * device.
 */
function LinkedFolderDefiner({
  workspace,
  on,
  editing,
  open,
  onOpenChange,
}: {
  workspace: WorkspaceRecord;
  on: AgentFoldersOn;
  editing: LinkedFolderDefinition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const change = useChangeAgentFolders(workspace.id);
  const create = useCreateReferenceFolder();
  const update = useUpdateReferenceFolder();
  const archive = useArchiveReferenceFolder();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const existing = on.linked.map((r) => ({ id: r.referenceFolderId, alias: r.alias, global: r.forEveryAgent }));

  const submit = (draft: ReferenceFolderDraft) => {
    setError(null);
    const onError = (err: unknown) => setError(apiErrorText(err));
    const { addReverse, ...input } = draft;
    if (editing) {
      update.mutate(
        { id: editing.id, alias: input.alias, description: input.description, workspaceId: input.workspaceId, readOnly: input.readOnly, ...(input.targetWorkspaceId ? { targetWorkspaceId: input.targetWorkspaceId } : {}) },
        {
          onSuccess: () => {
            toast.success(`@${draft.alias} saved`);
            onOpenChange(false);
          },
          onError,
        },
      );
      return;
    }
    if (input.path) {
      change.add.mutate(
        { alias: input.alias, description: input.description, forEveryAgent: input.workspaceId === null, readOnly: input.readOnly, deviceId: on.deviceId, folder: input.path },
        {
          onSuccess: () => {
            toast.success(`@${draft.alias} added`);
            onOpenChange(false);
          },
          onError,
        },
      );
      return;
    }
    create.mutate(input, {
      onSuccess: async () => {
        onOpenChange(false);
        if (!addReverse || !input.targetWorkspaceId) {
          toast.success(`@${draft.alias} added`);
          return;
        }
        // The link is already saved. A failure on the one back is reported
        // but must not read as though the whole thing failed.
        const reverseAlias = slugify(workspace.name, { separator: '-' });
        try {
          await create.mutateAsync({ workspaceId: input.targetWorkspaceId, alias: reverseAlias, targetWorkspaceId: workspace.id, path: null, description: null, readOnly: input.readOnly });
          toast.success(`@${draft.alias} added, and @${reverseAlias} back the other way`);
        } catch (err) {
          toast.warning(`@${draft.alias} added, but the link back failed: ${apiErrorText(err)}`);
        }
      },
      onError,
    });
  };

  const removeIt = async () => {
    if (!editing) return;
    const everyAgent = editing.workspaceId === null;
    const ok = await confirm({
      title: `Remove @${editing.alias}?`,
      description: everyAgent
        ? 'Every agent has it, so removing it takes it from all of them, on every device. Nothing on disk is touched.'
        : `${workspace.name} and its executions stop being told about it, on every device. Nothing on disk is touched.`,
      confirmLabel: 'Remove',
      tone: 'destructive',
    });
    if (!ok) return;
    archive.mutate(editing.id, {
      onSuccess: () => {
        toast.success(`@${editing.alias} removed`);
        onOpenChange(false);
      },
      onError: (err) => setError(apiErrorText(err)),
    });
  };

  return (
    <ReferenceFolderDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      editing={editing}
      existing={existing}
      saving={create.isPending || update.isPending || change.add.isPending}
      error={error}
      onSubmit={submit}
      device={{ id: on.deviceId, name: on.name }}
      browsable={on.connected}
      onRemove={editing ? removeIt : undefined}
    />
  );
}

/** Agents that link to this one: they use its folder, and change it unless their link is read only. */
function ReferencedBy({ workspaceId }: { workspaceId: string }) {
  const { data } = useReferencedBy(workspaceId);
  if (!data || data.referencedBy.length === 0) return null;
  const names = data.referencedBy.map((r) => `${r.workspaceName ?? 'every agent'}${r.readOnly ? ' (read only)' : ''}`);
  const anyEditable = data.referencedBy.some((r) => !r.readOnly);
  return (
    <div className="flex items-start gap-1.5 rounded-lg border border-border bg-muted/20 px-2.5 py-2 text-[10.5px] text-muted-foreground">
      <CornerUpLeft size={11} className="mt-px shrink-0" />
      <span>
        Linked from {names.join(', ')}. Those agents can read this one&apos;s folder
        {anyEditable ? ", and change it where their link isn't read only" : ''}. Links go one way, so nothing in
        this agent&apos;s setup changes.
      </span>
    </div>
  );
}
