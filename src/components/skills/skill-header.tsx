'use client';

import { PluginSetupHelpButton } from '@/components/plugins/setup-help-button';
import { documentSaves } from '@/lib/client/document-saves';
import { Archive, ChevronLeft, Copy, GitCommitHorizontal, Loader2, MoreHorizontal, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import type { SkillView } from '@/lib/api/skills';
import { useArchiveSkill, useCommitSkill } from '@/hooks/use-skills';
import { useSkillNavigation } from '@/components/skills/skill-navigation';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { SkillLocationControl } from './skill-location-control';
import { Tip } from '@/components/ui/tip';

export type SkillPane = 'chat' | 'skill';

/**
 * The skill builder's header, one row: the skill's name (its slash command,
 * renamed in the editor's Name field), setup help, where it's installed
 * (Install, for a draft), and for a project skill with changes the repo
 * hasn't committed, committing them. The location menu says who uses it, so
 * the header doesn't repeat it.
 */
export function SkillHeader({
  skill,
  onBack,
  pane,
}: {
  skill: SkillView;
  onBack?: () => void;
  pane?: { value: SkillPane; onChange: (pane: SkillPane) => void };
}) {
  const { goHome, canManage, showSetupHelp } = useSkillNavigation();
  const confirm = useConfirm();
  const commit = useCommitSkill(skill.ref);
  const archive = useArchiveSkill();
  const showCommit = skill.location.kind === 'project' && skill.git !== null && skill.uncommitted;

  const onArchive = async () => {
    const ok = await confirm({
      title: `Archive ${skill.name}?`,
      description:
        skill.location.kind === 'project'
          ? "It leaves the repo, and its chats are archived with it. The folder moves to the archive in your Ri folder, so nothing is deleted. Commit the removal to take it away from your team too."
          : skill.location.kind === 'draft'
            ? 'Its chats are archived with it. The folder moves to the archive in your Ri folder, so nothing is deleted.'
            : 'No agent will use it anymore, and its chats are archived with it. The folder moves to the archive in your Ri folder, so nothing is deleted.',
      confirmLabel: 'Archive',
      tone: 'destructive',
    });
    if (!ok) return;
    try { await documentSaves.flushAll(); } catch (error) { toast.error(apiErrorText(error)); return; }
    archive.mutate(skill.ref, {
      onSuccess: () => {
        toast.success(`${skill.name} archived`);
        goHome();
      },
      onError: (err) => toast.error(apiErrorText(err)),
    });
  };

  return (
    <header className="@container flex-shrink-0 min-w-0 border-b border-border">
      <div className="flex min-w-0 items-center gap-3 px-4 py-2">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            className="-ml-2 rounded-md p-1.5 text-muted-foreground hover:text-foreground active:bg-muted/40"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <span className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ScrollText size={16} />
        </span>
        <h1 className="min-w-0 truncate font-mono text-[13px] font-semibold text-foreground">{skill.name}</h1>

        {showCommit && (
          <Tip label="Commit only this skill's files. Other changes in the repo are left alone.">
            <button
              onClick={() =>
                commit.mutate(undefined, {
                  onSuccess: ({ commit: done }) =>
                    toast.success(`Committed to ${done.branch ?? 'the repo'} (${done.sha}). Push it to share it with your team.`),
                  onError: (err) => toast.error(apiErrorText(err)),
                })
              }
              disabled={commit.isPending}
              className="flex h-7 flex-shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {commit.isPending ? <Loader2 size={12} className="animate-spin" /> : <GitCommitHorizontal size={12} strokeWidth={2.5} />}
              {skill.git?.branch ? `Commit to ${skill.git.branch}` : 'Commit'}
            </button>
          </Tip>
        )}

        <div className="flex-1" />

        {showSetupHelp && <PluginSetupHelpButton compact target={{ kind: 'skill', skill }} />}
        {canManage && <SkillLocationControl skill={skill} />}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="More"
              className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <MoreHorizontal size={15} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                void navigator.clipboard.writeText(skill.dir).then(() => toast.success('Folder path copied'));
              }}
            >
              <Copy size={13} /> Copy folder path
            </DropdownMenuItem>
            {skill.editable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void onArchive()} className="text-destructive focus:text-destructive">
                  <Archive size={13} /> Archive
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {pane && (
        <div role="tablist" aria-label="Chat or skill" className="flex gap-1 px-4 pb-2">
          {(['chat', 'skill'] as const).map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={pane.value === p}
              onClick={() => pane.onChange(p)}
              className={cn(
                'flex flex-1 items-center justify-center rounded-md py-1.5 text-[12px] font-medium transition-colors',
                pane.value === p ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground active:bg-muted/50',
              )}
            >
              {p === 'chat' ? 'Chat' : 'Skill'}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
