'use client';

/**
 * Where an execution runs, and moving it (docs/homes-model.md, spec §3.4):
 * Move to MacBook, Move to Mac Mini, one for each of the person's other
 * devices, named from any screen. The page never has to know which
 * device it's on. Each says why when it can't happen yet, and one where the
 * agent isn't yet sets it up there first, then moves.
 *
 * Opening a read-only copy on this device (Open code here, P4.1) is parked
 * off the menu: moving is the one way to bring work to a device.
 */

import { useState } from 'react';
import { ArrowRightLeft, Laptop } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDevices } from '@/hooks/use-devices';
import { useThisDevice } from '@/hooks/use-devices';
import { useRunOn } from '@/hooks/use-workspaces';
import { useTransfer } from '@/hooks/use-execution';
import type { ChatSessionWithExecution, WorkspaceRecord } from '@/db/types';
import { SetupAgentDialog } from '@/components/agents/setup-agent-dialog';
import { START_RI } from '@/lib/executions/location';
import { ContinueDialog } from './continue-dialog';

export interface Move {
  /** The device it would move to. */
  key: string;
  label: string;
  to: { deviceId: string; name: string };
  /** Why it can't move there now. */
  problem: string | null;
  /** The agent isn't on that device yet: setting it up comes first. */
  needsSetup: boolean;
}

/** The moves on offer for an execution: to each of the person's other devices that can run its agent. */
export function useMoves(session: ChatSessionWithExecution, workspace: WorkspaceRecord | null | undefined) {
  const { data: devices } = useDevices();
  const thisDevice = useThisDevice();
  const { data: runOn } = useRunOn(workspace?.id ?? null);
  const { data: transfer } = useTransfer(session.id);

  const owner = session.location;
  const ownerAway = !!owner && !owner.isHome && devices?.find((c) => c.id === owner.deviceId)?.worker?.connected === false;

  const moves: Move[] = [];
  if (owner && workspace && session.status !== 'archived') {
    for (const choice of runOn?.choices ?? []) {
      if (choice.deviceId === owner.deviceId) continue;
      const problem = !workspace.isGit
        ? "Work that isn't in a Git repository runs on its own device, and doesn't move through Ri yet."
        : transfer?.state === 'active'
          ? `It's already moving to ${transfer.to.name}.`
          : !choice.connected
            ? `${choice.name} isn't running Ri right now. Start it there with ${START_RI}.`
            : !choice.needsSetup && !choice.ready
              ? (choice.problem ?? `${choice.name} can't take this work yet.`)
              : ownerAway
                ? `${owner.name} isn't running Ri right now, so its work can't be saved and moved. Wait for it.`
                : null;
      moves.push({
        key: choice.deviceId,
        label: `Move to ${choice.name}`,
        to: { deviceId: choice.deviceId, name: choice.name },
        problem,
        needsSetup: choice.needsSetup,
      });
    }
    // The device this screen is on first, when it's known. Nothing depends on it.
    moves.sort((a, b) => Number(b.key === thisDevice?.id) - Number(a.key === thisDevice?.id));
  }
  return { owner, moves };
}

/** Moving, with setting the agent up first when it needs it. Renders the dialogs. */
function useMoveFlow(session: ChatSessionWithExecution, workspace: WorkspaceRecord | null | undefined) {
  const [settingUp, setSettingUp] = useState<Move | null>(null);
  const [moving, setMoving] = useState<Move | null>(null);
  const owner = session.location;
  const start = (move: Move) => (move.needsSetup ? setSettingUp(move) : setMoving(move));
  const dialogs = (
    <>
      {settingUp && workspace && (
        <SetupAgentDialog
          workspaceId={workspace.id}
          agentName={workspace.name}
          device={{ id: settingUp.to.deviceId, name: settingUp.to.name }}
          open={!!settingUp}
          onOpenChange={(open) => !open && setSettingUp(null)}
          onReady={() => {
            const move = settingUp;
            setSettingUp(null);
            setMoving(move);
          }}
        />
      )}
      {moving && owner && (
        <ContinueDialog sessionId={session.id} open={!!moving} onOpenChange={(open) => !open && setMoving(null)} to={moving.to} from={owner.name} />
      )}
    </>
  );
  return { start, dialogs };
}

function hint(move: Move, agentName: string): string | null {
  if (move.problem) return move.problem;
  if (move.needsSetup) return `${agentName} isn't on ${move.to.name} yet. Set it up there first, once.`;
  return null;
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
  const { moves } = useMoves(session, workspace);
  const flow = useMoveFlow(session, workspace);

  const chip = (
    <span className="inline-flex min-w-0 flex-shrink items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Laptop size={9} className="flex-shrink-0" />
      <span className="max-w-[9rem] truncate">{name}</span>
    </span>
  );
  if (moves.length === 0) {
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
          <button type="button" title={`Runs on ${name}. Move it to another device.`} className="rounded hover:bg-muted/80">
            {chip}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Runs on {name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {moves.map((move) => {
            const note = hint(move, workspace?.name ?? 'The agent');
            return (
              <DropdownMenuItem
                key={move.key}
                disabled={!!move.problem}
                onSelect={() => flow.start(move)}
                className="flex-col items-start gap-0.5 text-[12.5px]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <ArrowRightLeft size={12} />
                  {move.label}
                </span>
                {note && <span className="pl-[18px] text-[11px] text-muted-foreground">{note}</span>}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {flow.dialogs}
    </>
  );
}

/**
 * The same moves in the execution's … menu, for work on the home, which
 * shows no device chip (the standard case goes unsaid). Nothing when
 * there's no other device to move it to.
 */
export function MoveActions({
  session,
  workspace,
}: {
  session: ChatSessionWithExecution;
  workspace: WorkspaceRecord | null | undefined;
}) {
  const { moves } = useMoves(session, workspace);
  const flow = useMoveFlow(session, workspace);
  if (moves.length === 0) return null;
  const item =
    'w-full flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60';
  return (
    <>
      {moves.map((move) => {
        const note = hint(move, workspace?.name ?? 'The agent');
        return (
          <button key={move.key} type="button" disabled={!!move.problem} onClick={() => flow.start(move)} className={item}>
            <span className="inline-flex items-center gap-2">
              <ArrowRightLeft size={12} />
              {move.label}
            </span>
            {note && <span className="pl-5 text-[11px] text-muted-foreground">{note}</span>}
          </button>
        );
      })}
      {flow.dialogs}
    </>
  );
}
