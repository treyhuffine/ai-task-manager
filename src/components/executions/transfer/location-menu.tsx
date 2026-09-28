'use client';

/**
 * Where an execution runs, and moving it (docs/homes-spec.md §3.4, P4.2):
 * the location chip opens a menu. Continue here moves the work to the
 * computer this browser is on. Continue on Mac Mini moves it to the home,
 * from any screen. Each says why when it can't happen yet. A phone offers
 * only the home: it doesn't run code itself.
 */

import { useState } from 'react';
import { ArrowRightLeft, Code, Laptop } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useComputers } from '@/hooks/use-computers';
import { useThisComputer } from '@/hooks/use-opener';
import { useClientLocation } from '@/hooks/use-client-location';
import { useRunOn } from '@/hooks/use-workspaces';
import { useCommit, useOpenCodeHere, useTransfer } from '@/hooks/use-execution';
import { ApiError, apiErrorText } from '@/lib/api/client';
import { useOpenReview } from './review-bar';
import type { ChatSessionWithExecution, WorkspaceRecord } from '@/db/types';
import { ContinueDialog } from './continue-dialog';

export interface Move {
  key: 'here' | 'home';
  label: string;
  to: { computerId: string; name: string };
  problem: string | null;
}

/**
 * The moves on offer for an execution, from this browser: to the computer
 * it's on, and to the home. Each carries why it can't happen yet, if so.
 * Also the computer this browser is on, for Open code here.
 */
export function useMoves(session: ChatSessionWithExecution, workspace: WorkspaceRecord | null | undefined) {
  const { data: computers } = useComputers();
  const thisComputer = useThisComputer();
  const client = useClientLocation();
  const { data: runOn } = useRunOn(workspace?.id ?? null);
  const { data: transfer } = useTransfer(session.id);

  const owner = session.location;
  const homeComputer = computers?.find((c) => c.isHome) ?? null;
  // The computer this browser is on: the one it was linked to, or the home's
  // own when it's open there.
  const viewer = thisComputer ?? (client.kind === 'host' && homeComputer ? { id: homeComputer.id, name: homeComputer.name } : null);

  const problemFor = (computerId: string, computerName: string): string | null => {
    if (!workspace?.isGit) return "Work that isn't in a Git repository runs on its own computer, and doesn't move through Ri yet.";
    if (transfer?.state === 'active') return `It's already moving to ${transfer.to.name}.`;
    // Not judged before it's known: a menu opened early said "isn't set up".
    if (!runOn) return 'Checking where it can run…';
    const choice = runOn.choices.find((c) => c.computerId === computerId);
    if (!choice) return `${workspace.name} isn't set up on ${computerName}.`;
    if (!choice.ready) return choice.problem ?? `${computerName} can't take this work yet.`;
    if (!choice.connected) return `${computerName} isn't connected.`;
    if (owner && !owner.isHome && !computers?.find((c) => c.id === owner.computerId)?.worker?.connected) {
      return `${owner.name} isn't connected, so its work can't be saved and moved. Wait for it.`;
    }
    return null;
  };

  const moves: Move[] = [];
  if (owner && session.status !== 'archived') {
    if (viewer && viewer.id !== owner.computerId) {
      moves.push({ key: 'here', label: `Continue here, on ${viewer.name}`, to: { computerId: viewer.id, name: viewer.name }, problem: problemFor(viewer.id, viewer.name) });
    }
    if (homeComputer && !owner.isHome && viewer?.id !== homeComputer.id) {
      moves.push({
        key: 'home',
        label: `Continue on ${homeComputer.name}`,
        to: { computerId: homeComputer.id, name: homeComputer.name },
        problem: problemFor(homeComputer.id, homeComputer.name),
      });
    }
  }

  // Open code here (P4.1): its published commit on this computer, for review.
  // Not on a phone, which follows the work rather than runs it.
  const canReview = !!owner && !!viewer && viewer.id !== owner.computerId && !!workspace?.isGit;
  const reviewProblem = !canReview
    ? null
    : !runOn
      ? 'Checking where it can run…'
      : runOn.choices.some((c) => c.computerId === viewer!.id)
        ? null
        : `${workspace!.name} isn't set up on ${viewer!.name}.`;

  return { owner, viewer, moves, canReview, reviewProblem };
}

/** Open code here (P4.1), with what it says when it works and when nothing's published yet. */
function useOpenCodeHereAction(session: ChatSessionWithExecution) {
  const owner = session.location;
  const openCode = useOpenCodeHere(session.id);
  const openReview = useOpenReview(session.id);
  const commit = useCommit(session.id);

  // Nothing published yet (§8.1): the ordinary commit and push on the
  // source, which waits for a turn in flight rather than commit under it.
  const commitAndPush = () =>
    commit.mutate(
      { andPush: true },
      {
        onSuccess: () => toast.success(`Asked the agent on ${owner?.name} to commit and push`, { description: 'Open code here again once it has.' }),
        onError: (err) => toast.error("Couldn't ask for a commit", { description: apiErrorText(err) }),
      },
    );

  const openCodeHere = () =>
    openCode.mutate(undefined, {
      onSuccess: (state) => {
        if (!state.review) return;
        toast.success(`Reviewing ${state.review.sha.slice(0, 7)} from ${state.review.source?.name ?? owner?.name} here`, {
          description: state.review.dirty ? 'It has your edits, so it stayed as it was.' : undefined,
        });
        openReview(state.review.path);
      },
      onError: (err) => {
        const unpublished = err instanceof ApiError && (err.body as { error?: string } | null)?.error === 'not_published';
        toast.error("Couldn't open it here", {
          description: apiErrorText(err),
          action: unpublished && owner ? { label: `Commit and push on ${owner.name}`, onClick: commitAndPush } : undefined,
        });
      },
    });
  return { openCodeHere, pending: openCode.isPending };
}

export function LocationMenu({
  session,
  workspace,
  name,
}: {
  session: ChatSessionWithExecution;
  workspace: WorkspaceRecord | null | undefined;
  name: string;
}) {
  const { owner, viewer, moves, canReview, reviewProblem } = useMoves(session, workspace);
  const [moving, setMoving] = useState<Move | null>(null);
  const openCode = useOpenCodeHereAction(session);

  const chip = (
    <span className="inline-flex min-w-0 flex-shrink items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Laptop size={9} className="flex-shrink-0" />
      <span className="max-w-[9rem] truncate">{name}</span>
    </span>
  );
  if (moves.length === 0 && !canReview) {
    return (
      <span title={`Runs on ${name}`} className="cursor-default">
        {chip}
      </span>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" title={`Runs on ${name}. Move it to another computer.`} className="rounded hover:bg-muted/80">
            {chip}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Runs on {name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {moves.map((move) => (
            <DropdownMenuItem
              key={move.key}
              disabled={!!move.problem}
              onSelect={() => setMoving(move)}
              className="flex-col items-start gap-0.5 text-[12.5px]"
            >
              <span className="inline-flex items-center gap-1.5">
                <ArrowRightLeft size={12} />
                {move.label}
              </span>
              {move.problem && <span className="pl-[18px] text-[11px] text-muted-foreground">{move.problem}</span>}
            </DropdownMenuItem>
          ))}
          {canReview && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!!reviewProblem || openCode.pending}
                onSelect={openCode.openCodeHere}
                className="flex-col items-start gap-0.5 text-[12.5px]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Code size={12} />
                  Open code here
                </span>
                <span className="pl-[18px] text-[11px] text-muted-foreground">
                  {reviewProblem ?? `Its latest published commit, on ${viewer!.name}, to read. It keeps running on ${owner!.name}.`}
                </span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {moving && owner && (
        <ContinueDialog
          sessionId={session.id}
          open={!!moving}
          onOpenChange={(open) => !open && setMoving(null)}
          to={moving.to}
          from={owner.name}
        />
      )}
    </>
  );
}

/**
 * The same moves in the execution's … menu, for work on the home, which
 * shows no computer chip (the standard case goes unsaid). Nothing when
 * there's no move to make from this screen.
 */
export function MoveActions({
  session,
  workspace,
}: {
  session: ChatSessionWithExecution;
  workspace: WorkspaceRecord | null | undefined;
}) {
  const { owner, viewer, moves, canReview, reviewProblem } = useMoves(session, workspace);
  const [moving, setMoving] = useState<Move | null>(null);
  const openCode = useOpenCodeHereAction(session);
  if (moves.length === 0 && !canReview) return null;
  const item =
    'w-full flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60';
  return (
    <>
      {moves.map((move) => (
        <button key={move.key} type="button" disabled={!!move.problem} onClick={() => setMoving(move)} className={item}>
          <span className="inline-flex items-center gap-2">
            <ArrowRightLeft size={12} />
            {move.label}
          </span>
          {move.problem && <span className="pl-5 text-[11px] text-muted-foreground">{move.problem}</span>}
        </button>
      ))}
      {canReview && (
        <button type="button" disabled={!!reviewProblem || openCode.pending} onClick={openCode.openCodeHere} className={item}>
          <span className="inline-flex items-center gap-2">
            <Code size={12} />
            Open code here
          </span>
          <span className="pl-5 text-[11px] text-muted-foreground">
            {reviewProblem ?? `Its latest published commit, on ${viewer!.name}, to read.`}
          </span>
        </button>
      )}
      {moving && owner && (
        <ContinueDialog sessionId={session.id} open={!!moving} onOpenChange={(open) => !open && setMoving(null)} to={moving.to} from={owner.name} />
      )}
    </>
  );
}
