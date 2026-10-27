'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { listJoin } from '@/components/chat/onboarding/onboarding-flow';
import { APP_NAME, APP_SHORT_ID } from '@/constants/app';
import { apiErrorText } from '@/lib/api/client';
import { HARNESS_IDS, HARNESS_REGISTRY } from '@/lib/harness/registry';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { agentSkillState } from './agent-skill-state';

/**
 * Ri's user-level skills, which let every coding tool Ri runs manage tasks
 * and notes from any project on this computer, through the `ri` command even
 * before it's connected to Ri's MCP. They go into each harness's own skill
 * folder, so switching harnesses never loses them. A new home's first run
 * installs them (`src/components/onboarding/agent-skill-install.ts`),
 * connecting an agent installs them for it (`src/lib/external-ai/local-setup.ts`),
 * and Settings → Connect your agent ends with their one-click install and
 * uninstall. Uninstalling removes only Ri's own links
 * (`src/lib/agent-skills/shipped.ts`) and never touches a project.
 */
export function useAgentSkillAccess(enabled = true) {
  const qc = useQueryClient();
  const status = useQuery({ ...trpc.harness.skillsGlobalGet.queryOptions({}), enabled });
  const change = useMutation({
    mutationFn: (install: boolean) => trpcClient.harness.skillsGlobalPut.mutate({ body: { enabled: install } }),
    onSuccess: (_result, install) => {
      if (install) toast.success('Your coding tools can manage tasks and notes');
      else toast.success('Uninstalled from your coding tools', { action: { label: 'Undo', onClick: () => change.mutate(true) } });
    },
    onError: (error, install) => {
      toast.error(install ? 'Could not install the skills' : 'Could not uninstall the skills', {
        description: apiErrorText(error),
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: trpc.harness.skillsGlobalGet.queryKey() }),
  });
  return {
    status: status.data,
    state: status.data ? agentSkillState(status.data) : null,
    failed: status.isError,
    retry: () => void status.refetch(),
    busy: change.isPending,
    install: () => change.mutate(true),
    uninstall: () => change.mutate(false),
  };
}

const buttonClass =
  'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted/50 disabled:opacity-50';

/** "Codex, Claude Code, Cursor, OpenCode and Antigravity": every harness this build offers. */
const HARNESS_NAMES = listJoin(HARNESS_IDS.map((id) => HARNESS_REGISTRY[id].name));

/**
 * The end of Connect your agent: Ri's skills for the coding tools on this
 * computer, whether they're there, and the one button. Nothing in the desktop
 * app, which keeps them in its own folder until an agent is connected.
 */
export function AgentSkillFooter() {
  const skill = useAgentSkillAccess();
  const { state } = skill;
  if (state === 'app-only') return null;

  return (
    <section className="min-w-0" aria-label={`${APP_NAME}’s skills`}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{APP_NAME}’s skills</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {HARNESS_NAMES} on this computer have {APP_NAME}’s skills for tasks, notes and the agent browser, so they can use
        your work through the <code className="font-mono">{APP_SHORT_ID}</code> command even before you connect them. Connecting an agent
        installs them for it. Your projects are never changed.
      </p>
      <div className="mt-2 flex items-center gap-3 rounded-md border border-border px-3 py-2 text-xs">
        {skill.failed ? (
          <>
            <span className="min-w-0 flex-1 text-destructive">Could not check the skills.</span>
            <button type="button" className={buttonClass} onClick={skill.retry}>Retry</button>
          </>
        ) : state === null ? (
          <span className="flex flex-1 items-center gap-2 text-muted-foreground">
            <Loader2 size={12} className="animate-spin" aria-hidden /> Checking
          </span>
        ) : (
          <>
            <span
              aria-hidden
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                state === 'on' ? 'bg-emerald-500' : state === 'blocked' ? 'bg-amber-500' : 'bg-muted-foreground/40',
              )}
            />
            <span className="min-w-0 flex-1">
              {state === 'on' ? (
                <>Installed <span className="text-muted-foreground">in {listJoin(skill.status?.folders ?? [])}</span></>
              ) : 'Not installed'}
            </span>
            <button
              type="button"
              className={buttonClass}
              disabled={skill.busy}
              onClick={state === 'on' ? skill.uninstall : skill.install}
            >
              {skill.busy && <Loader2 size={12} className="animate-spin" aria-hidden />}
              {state === 'on' ? 'Uninstall' : 'Install'}
            </button>
          </>
        )}
      </div>
      {state === 'blocked' && skill.status && (
        <p role="alert" className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Another skill is already at {skill.status.conflicts.join(', ')}, so {APP_NAME} left it alone. Remove or
          rename it, then install again.
        </p>
      )}
    </section>
  );
}
