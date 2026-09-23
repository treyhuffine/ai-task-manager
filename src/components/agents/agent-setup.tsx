'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, ChevronDown, ImagePlus, Loader2, SmilePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useDashboard } from '@/contexts/dashboard-context';
import { useArchiveWorkspace, useUpdateWorkspace } from '@/hooks/use-workspaces';
import { useAreas } from '@/hooks/use-areas';
import { api, ApiError } from '@/lib/api/client';
import { uploadAttachment } from '@/lib/attachments/client';
import { EmojiPicker } from '@/components/shared/emoji-picker';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { FilesToCopySection } from '@/components/workspaces/files-to-copy-section';
import { WorktreeScriptsSection } from '@/components/workspaces/worktree-scripts-section';
import { WorkspaceConnectorsSection } from '@/components/workspaces/workspace-connectors-section';
import { ReferenceFoldersSection } from '@/components/workspaces/reference-folders-section';
import type { GhStatus } from '@/lib/workspaces/gh';
import type { Attachment, UpdateWorkspaceInput, WorkspaceRecord } from '@/db/types';
import { cn } from '@/lib/utils';

/** Caps enforced by the query layer (`WORKSPACE_PURPOSE_MAX`, `WORKSPACE_INSTRUCTIONS_MAX`). */
const PURPOSE_MAX = 500;
const INSTRUCTIONS_MAX = 20_000;

/** The fields the Save button writes. Connectors and reference folders save themselves. */
interface SetupForm {
  name: string;
  emoji: string | null;
  attachment: Attachment | null;
  areaId: string;
  purpose: string;
  instructions: string;
  browserEnabled: boolean;
  baseBranch: string;
  worktreeRoot: string;
  skipLiveConfirm: boolean;
  setupCommand: string;
  startCommand: string;
  teardownCommand: string;
  filesToCopy: string[];
}

function formFromWorkspace(ws: WorkspaceRecord): SetupForm {
  return {
    name: ws.name,
    emoji: ws.emoji ?? null,
    attachment: ws.attachments?.[0] ?? null,
    areaId: ws.areaId ?? '',
    purpose: ws.purpose ?? '',
    instructions: ws.instructions ?? '',
    browserEnabled: ws.browserEnabled ?? true,
    baseBranch: ws.baseBranch ?? '',
    worktreeRoot: ws.worktreeRoot ?? '',
    skipLiveConfirm: ws.skipLiveConfirm ?? false,
    setupCommand: ws.setupCommand ?? '',
    startCommand: ws.startCommand ?? '',
    teardownCommand: ws.teardownCommand ?? '',
    filesToCopy: ws.filesToCopy ?? [],
  };
}

/**
 * Only the fields that changed. Instructions, the browser switch and the
 * folder recycle the agent's live sessions when they arrive, so a save must
 * never resend one it didn't touch.
 */
function patchFrom(form: SetupForm, ws: WorkspaceRecord): Omit<UpdateWorkspaceInput, 'id'> {
  const base = formFromWorkspace(ws);
  const text = (v: string) => v.trim() || null;
  const patch: Omit<UpdateWorkspaceInput, 'id'> = {};
  if (form.name.trim() && form.name.trim() !== ws.name) patch.name = form.name.trim();
  if (form.emoji !== base.emoji) patch.emoji = form.emoji;
  if (form.attachment?.fileName !== base.attachment?.fileName) {
    patch.attachments = form.attachment ? [form.attachment] : [];
  }
  if (form.areaId !== base.areaId) patch.areaId = form.areaId || null;
  if (form.purpose.trim() !== base.purpose.trim()) patch.purpose = text(form.purpose);
  if (form.instructions.trim() !== base.instructions.trim()) patch.instructions = text(form.instructions);
  if (form.browserEnabled !== base.browserEnabled) patch.browserEnabled = form.browserEnabled;
  if (form.baseBranch.trim() !== base.baseBranch.trim()) patch.baseBranch = text(form.baseBranch);
  if (form.worktreeRoot.trim() !== base.worktreeRoot.trim()) patch.worktreeRoot = text(form.worktreeRoot);
  if (form.skipLiveConfirm !== base.skipLiveConfirm) patch.skipLiveConfirm = form.skipLiveConfirm;
  if (form.setupCommand.trim() !== base.setupCommand.trim()) patch.setupCommand = text(form.setupCommand);
  if (form.startCommand.trim() !== base.startCommand.trim()) patch.startCommand = text(form.startCommand);
  if (form.teardownCommand.trim() !== base.teardownCommand.trim()) patch.teardownCommand = text(form.teardownCommand);
  if (JSON.stringify(form.filesToCopy) !== JSON.stringify(base.filesToCopy)) patch.filesToCopy = form.filesToCopy;
  return patch;
}

/**
 * Everything about an agent (docs/agents-view-spec.md Phase 7): who it is,
 * what it is for, what it may use, where it lives, how its executions are
 * set up. Replaces the old workspace settings sheet.
 */
export function AgentSetup({ workspace }: { workspace: WorkspaceRecord }) {
  const { goHome } = useDashboard();
  const { data: areas } = useAreas();
  const update = useUpdateWorkspace();
  const archive = useArchiveWorkspace();
  const confirm = useConfirm();
  const { data: gh } = useQuery({
    queryKey: ['gh', 'status'],
    queryFn: () => api.get<GhStatus>('/gh/status'),
    staleTime: 60_000,
    retry: false,
  });

  const [form, setForm] = useState<SetupForm>(() => formFromWorkspace(workspace));
  const patch = patchFrom(form, workspace);
  const dirty = Object.keys(patch).length > 0;

  // Follow edits made elsewhere (the agent's main chat can change its
  // purpose and instructions) while the form is untouched. Unsaved edits are
  // never overwritten.
  const [syncedAt, setSyncedAt] = useState(workspace.updatedAt);
  if (workspace.updatedAt !== syncedAt && !dirty) {
    setSyncedAt(workspace.updatedAt);
    setForm(formFromWorkspace(workspace));
  }

  const set = <K extends keyof SetupForm>(key: K, value: SetupForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file?.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const uploaded = await uploadAttachment(file);
      setForm((f) => ({ ...f, attachment: uploaded, emoji: null }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const purposeOver = form.purpose.trim().length > PURPOSE_MAX;
  const instructionsOver = form.instructions.trim().length > INSTRUCTIONS_MAX;

  const save = () => {
    if (!dirty || purposeOver || instructionsOver) return;
    update.mutate(
      { id: workspace.id, ...patch },
      {
        onSuccess: (row) => {
          setSyncedAt(row.updatedAt);
          toast.success(`${row.name} saved`);
        },
        onError: (err) => {
          const message =
            err instanceof ApiError ? ((err.body as { error?: string } | null)?.error ?? err.message) : String(err);
          toast.error(message);
        },
      },
    );
  };

  const handleArchive = async () => {
    const ok = await confirm({
      title: 'Archive this agent?',
      description: `"${workspace.name}" leaves your active list. Its executions and chats are kept, and you can restore it later.`,
      confirmLabel: 'Archive',
    });
    if (!ok) return;
    const name = workspace.name;
    archive.mutate(workspace.id, {
      onSuccess: () => {
        toast.success(`${name} archived`);
        goHome();
      },
    });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-5 py-5 space-y-8">
          <Section title="Basics">
            <Field label="Name">
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </Field>
            <Field label="Icon" hint="If empty and linked to an area, the area's icon shows instead.">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
              {form.attachment ? (
                <div className="relative group inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/attachments/${form.attachment.fileName}`}
                    alt="Agent icon"
                    className="w-16 h-16 rounded-xl object-cover border border-border"
                  />
                  <RemoveBadge onClick={() => set('attachment', null)} label="Remove image" />
                </div>
              ) : (
                <div className="flex gap-3">
                  <div className="relative group">
                    <EmojiPicker onSelect={(e) => setForm((f) => ({ ...f, emoji: e, attachment: null }))}>
                      <button
                        type="button"
                        className={cn(
                          'w-16 h-16 rounded-xl border border-border flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer',
                          form.emoji
                            ? 'text-3xl bg-accent/30'
                            : 'border-dashed border-2 text-muted-foreground hover:text-foreground hover:border-muted-foreground',
                        )}
                      >
                        {form.emoji ?? (
                          <>
                            <SmilePlus size={18} />
                            <span className="text-[9px] font-medium">Emoji</span>
                          </>
                        )}
                      </button>
                    </EmojiPicker>
                    {form.emoji && <RemoveBadge onClick={() => set('emoji', null)} label="Remove emoji" />}
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-16 h-16 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {uploading ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <>
                        <ImagePlus size={18} />
                        <span className="text-[9px] font-medium">Image</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </Field>
            <Field label="Area">
              <div className="relative">
                <select
                  value={form.areaId}
                  onChange={(e) => set('areaId', e.target.value)}
                  className="w-full appearance-none pl-3 pr-9 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">None</option>
                  {areas?.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.emoji ? `${area.emoji} ${area.name}` : area.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
            </Field>
            <Field
              label="Purpose"
              hint="What this agent is for, in a sentence or two. Its main chat keeps this in mind."
              counter={{ value: form.purpose.trim().length, max: PURPOSE_MAX }}
            >
              <textarea
                value={form.purpose}
                onChange={(e) => set('purpose', e.target.value)}
                rows={2}
                placeholder="Ship Ri: the app, its CLI and its docs"
                className={cn(
                  'w-full px-3 py-2 text-sm bg-background border rounded-md focus:outline-none focus:ring-1 resize-y',
                  purposeOver ? 'border-destructive focus:ring-destructive' : 'border-border focus:ring-primary',
                )}
              />
            </Field>
          </Section>

          <Section
            title="Instructions"
            description="Standing instructions every execution in this agent receives when it starts. The agent's main chat follows them too."
          >
            <Field counter={{ value: form.instructions.trim().length, max: INSTRUCTIONS_MAX }}>
              <textarea
                value={form.instructions}
                onChange={(e) => set('instructions', e.target.value)}
                rows={8}
                placeholder="Run pnpm ts before every commit. Keep changes small."
                className={cn(
                  'w-full px-3 py-2 text-[12.5px] leading-relaxed font-mono bg-background border rounded-md focus:outline-none focus:ring-1 resize-y',
                  instructionsOver ? 'border-destructive focus:ring-destructive' : 'border-border focus:ring-primary',
                )}
              />
            </Field>
          </Section>

          <WorkspaceConnectorsSection workspaceId={workspace.id} />

          <Section title="Browser">
            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <span className="text-[12px] text-muted-foreground/85 leading-relaxed">
                Let this agent use the browser
                <span className="block text-[11px] text-muted-foreground/60">
                  Its executions and main chat can read and act on the web, in an isolated profile, not your
                  logged-in one.
                </span>
              </span>
              <Switch checked={form.browserEnabled} onCheckedChange={(on) => set('browserEnabled', on)} className="mt-0.5" />
            </label>
          </Section>

          <ReferenceFoldersSection workspaceId={workspace.id} workspaceName={workspace.name} />

          <Section title="Folder and git">
            <Field label="Folder" hint="Fixed when the agent was created. Move the folder to relink.">
              <div className="px-3 py-2 text-xs font-mono bg-muted/40 border border-border rounded-md text-muted-foreground break-all">
                {workspace.cwd}
              </div>
            </Field>
            {workspace.isGit && (
              <>
                <Field label="Base branch">
                  <input
                    value={form.baseBranch}
                    onChange={(e) => set('baseBranch', e.target.value)}
                    placeholder="main"
                    className="w-full px-3 py-2 text-sm font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
                <Field label="Worktree root">
                  <input
                    value={form.worktreeRoot}
                    onChange={(e) => set('worktreeRoot', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
                <label className="flex items-start justify-between gap-3 cursor-pointer">
                  <span className="text-[12px] text-muted-foreground/85 leading-relaxed">
                    Confirm before Live sessions
                    <span className="block text-[11px] text-muted-foreground/60">
                      Show the explainer each time you start a Live session here. Turn off to launch directly with no
                      isolation.
                    </span>
                  </span>
                  <Switch
                    checked={!form.skipLiveConfirm}
                    onCheckedChange={(on) => set('skipLiveConfirm', !on)}
                    className="mt-0.5"
                  />
                </label>
              </>
            )}
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5 text-[11px]">
              <InfoRow label="Repository" value={workspace.isGit ? 'yes' : 'no, a plain folder'} />
              {workspace.isGit && <InfoRow label="Remote" value={workspace.remoteName ?? 'none'} mono />}
              <GhRow gh={gh ?? null} />
            </div>
          </Section>

          <Section
            title="Scripts and preview"
            description="Setup runs in each new worktree. Start is the dev server a preview runs. Teardown runs before a worktree is removed."
          >
            <WorktreeScriptsSection
              setupCommand={form.setupCommand}
              startCommand={form.startCommand}
              teardownCommand={form.teardownCommand}
              onSetupChange={(v) => set('setupCommand', v)}
              onStartChange={(v) => set('startCommand', v)}
              onTeardownChange={(v) => set('teardownCommand', v)}
              cwd={workspace.cwd}
            />
          </Section>

          {workspace.isGit && (
            <Section title="Files to copy" description="Ignored files, like .env, copied into each new worktree.">
              <FilesToCopySection value={form.filesToCopy} onChange={(v) => set('filesToCopy', v)} cwd={workspace.cwd} />
            </Section>
          )}

          {workspace.status !== 'archived' && (
            <div className="pt-2 border-t border-border/60">
              <button onClick={handleArchive} className="flex items-center gap-1.5 text-[11px] text-destructive hover:underline">
                <Archive size={11} />
                Archive agent
              </button>
            </div>
          )}
        </div>
      </div>

      {dirty && (
        <div className="shrink-0 flex items-center justify-end gap-2 border-t border-border bg-card px-5 py-2.5">
          <span className="mr-auto text-[11px] text-muted-foreground">Unsaved changes</span>
          <button
            onClick={() => setForm(formFromWorkspace(workspace))}
            className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors"
          >
            Discard
          </button>
          <button
            onClick={save}
            disabled={update.isPending || purposeOver || instructionsOver}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-all disabled:opacity-40"
          >
            {update.isPending && <Loader2 size={13} className="animate-spin" />}
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-[11px] text-muted-foreground/75">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  counter,
  children,
}: {
  label?: string;
  hint?: string;
  counter?: { value: number; max: number };
  children: ReactNode;
}) {
  const over = counter && counter.value > counter.max;
  return (
    <div>
      {(label || counter) && (
        <div className="flex items-baseline justify-between mb-1.5">
          {label ? (
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
          ) : (
            <span />
          )}
          {counter && (
            <span className={cn('text-[10px] tabular-nums', over ? 'text-destructive' : 'text-muted-foreground/60')}>
              {counter.value.toLocaleString()} / {counter.max.toLocaleString()}
            </span>
          )}
        </div>
      )}
      {children}
      {hint && <p className="mt-1 text-[10.5px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function RemoveBadge({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
    >
      <Trash2 size={10} />
    </button>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground/80">{label}</span>
      <span className={cn('text-foreground truncate', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

function GhRow({ gh }: { gh: GhStatus | null }) {
  if (gh === null) return null;
  if (!gh.installed) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 mt-1">
        <p className="text-amber-500 font-medium">gh not found</p>
        <p className="text-muted-foreground mt-0.5">
          Install with <code className="font-mono">brew install gh</code> to enable PR creation.
        </p>
      </div>
    );
  }
  if (!gh.authenticated) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 mt-1">
        <p className="text-amber-500 font-medium">gh installed but not signed in</p>
        <p className="text-muted-foreground mt-0.5">
          Run <code className="font-mono">gh auth login</code> to enable GitHub features.
        </p>
      </div>
    );
  }
  return (
    <>
      <InfoRow label="gh" value={gh.version ?? 'installed'} mono />
      <InfoRow label="user" value={gh.user ?? 'unknown'} mono />
    </>
  );
}
