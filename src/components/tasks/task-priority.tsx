'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useRankTask, useTasks } from '@/hooks/use-tasks';
import { PRIORITY_RANK_FILTER, RANKED_STATUSES, clampRank } from '@/lib/tasks/priority-rank';
import type { TaskStatus } from '@/lib/tasks/lifecycle';
import { BUCKET_OPTIONS, bucketRank } from '@/lib/utils/bucket-placement';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Tip } from '@/components/ui/tip';

/**
 * A task's place in the Priority Order of committed work. The rank is a number
 * to type (click it), and Move drops the task into a rough bucket. Both go
 * through one rank write, so the readout always names where the task now is.
 */
export function TaskPriority({ taskId, status }: { taskId: string; status: TaskStatus }) {
  const { data: list } = useTasks(PRIORITY_RANK_FILTER);
  const rankTask = useRankTask();
  const [editing, setEditing] = useState(false);
  const rankButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  const position = useMemo(() => {
    const index = list?.findIndex((t) => t.id === taskId) ?? -1;
    if (!list || index === -1) return null;
    return { rank: index + 1, total: list.length, ranked: list[index].sortKey !== null };
  }, [list, taskId]);

  // A rank typed from the keyboard hands focus back to the rank itself.
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    rankButton.current?.focus();
  }, [editing]);

  if (!RANKED_STATUSES.includes(status)) {
    return <span className="text-[12px] text-muted-foreground/60">Only Todo and In progress tasks are ranked</span>;
  }
  if (!position) return <span className="text-foreground/80 text-[12px] font-medium">Loading…</span>;

  const setRank = (requested: number) => {
    const rank = clampRank(requested, position.total);
    if (position.ranked && rank === position.rank) return;
    rankTask.mutate({ id: taskId, rank });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {editing ? (
          <span className="inline-flex items-center gap-1.5 px-2 text-foreground/80 text-[12px] font-medium tabular-nums">
            Rank
            <RankInput
              rank={position.ranked ? position.rank : null}
              total={position.total}
              onDone={(rank, fromKeyboard) => {
                refocus.current = fromKeyboard;
                setEditing(false);
                if (rank !== null) setRank(rank);
              }}
            />
            of {position.total}
          </span>
        ) : (
          <Tip label="Type an exact rank">
            <button
              ref={rankButton}
              onClick={() => setEditing(true)}
              className="inline-flex items-center px-2 py-0.5 rounded text-foreground/80 text-[12px] font-medium tabular-nums hover:bg-muted transition-colors"
            >
              {position.ranked ? `Ranked #${position.rank} of ${position.total}` : 'Not yet ranked'}
            </button>
          </Tip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted border border-border transition-colors">
              {position.ranked ? 'Move' : 'Place'}
              <ChevronDown size={10} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-32">
            {BUCKET_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onClick={() => setRank(bucketRank(opt.value, position.total))}
                className="text-xs"
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <span className="text-[10px] text-muted-foreground/60 leading-snug">
        Click the rank to set an exact spot, or drop it into a rough bucket. Either gives AI a
        starting point it can refine.
      </span>
    </div>
  );
}

/**
 * The rank as a number field. Enter or leaving the field sets it, Escape
 * keeps the old one. Anything that isn't a number changes nothing, and a
 * number outside 1 to `total` lands on the nearest end.
 */
function RankInput({
  rank,
  total,
  onDone,
}: {
  rank: number | null;
  total: number;
  onDone: (rank: number | null, fromKeyboard: boolean) => void;
}) {
  // Enter and Escape unmount the field, and a removed field can still fire
  // blur. Finish once.
  const finished = useRef(false);
  const finish = (value: string | null, fromKeyboard: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
    onDone(Number.isFinite(parsed) ? parsed : null, fromKeyboard);
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      max={total}
      step={1}
      autoFocus
      defaultValue={rank ?? ''}
      aria-label={`Rank, 1 to ${total}`}
      // The slideout leaves Escape to this field instead of closing.
      data-cancel-on-escape=""
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value, false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(e.currentTarget.value, true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(null, true);
        }
      }}
      style={{ width: `${String(total).length + 2}ch` }}
      className="h-5 rounded border border-border bg-card px-1 text-center text-[12px] font-medium tabular-nums outline-none focus:border-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}
