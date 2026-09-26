'use client';

/**
 * A move between computers, in one place (docs/homes-spec.md §8.2, P4.2 to
 * P4.4): Preparing, Saving work, Setting up MacBook, Continuing. When it
 * stops, where and why, and the ways on: before the destination took the
 * work, Try again or Resume on the source. After, Finish there. Messages
 * sent meanwhile were held, and say so under each one.
 */

import { useState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useFinishTransfer, useResumeTransfer, useStartTransfer, useTransfer } from '@/hooks/use-execution';
import { transferStepLabel, type TransferView } from '@/lib/transfer/view';
import { apiErrorText } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { TransferStage } from '@/db/types';

const STEPS: TransferStage[] = ['stopping', 'saving', 'setting_up', 'continuing'];

function stepIndex(stage: TransferStage): number {
  if (stage === 'preparing') return 0;
  if (stage === 'done') return STEPS.length;
  return STEPS.indexOf(stage);
}

export function TransferProgress({ sessionId }: { sessionId: string }) {
  const { data: transfer } = useTransfer(sessionId);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!transfer || transfer.state === 'succeeded' || transfer.state === 'cancelled') return null;
  if (transfer.state === 'failed' && dismissed === transfer.id && transfer.heldCount === 0) return null;
  return transfer.state === 'active' ? <Moving transfer={transfer} /> : <Stopped sessionId={sessionId} transfer={transfer} onDismiss={() => setDismissed(transfer.id)} />;
}

function Steps({ transfer, failedAt }: { transfer: TransferView; failedAt?: number }) {
  const at = failedAt ?? stepIndex(transfer.stage);
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
      {STEPS.map((step, i) => {
        const done = i < at;
        const current = i === at;
        return (
          <li key={step} className={cn('inline-flex items-center gap-1', done ? 'text-foreground/80' : current ? 'font-medium text-foreground' : 'text-muted-foreground/60')}>
            {done ? (
              <Check size={11} />
            ) : current && failedAt === undefined ? (
              <Loader2 size={11} className="animate-spin" />
            ) : current ? (
              <AlertTriangle size={11} className="text-amber-500" />
            ) : (
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
            )}
            {transferStepLabel(step, transfer.to.name)}
          </li>
        );
      })}
    </ol>
  );
}

function Moving({ transfer }: { transfer: TransferView }) {
  return (
    <div role="status" className="mx-auto w-full max-w-3xl rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="mb-1.5 text-[12.5px] font-medium text-foreground">
        Continuing on {transfer.to.name}, from {transfer.from.name}
      </p>
      <Steps transfer={transfer} />
      {transfer.heldCount > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground/80">
          {transfer.heldCount === 1 ? 'A message you sent is' : `${transfer.heldCount} messages you sent are`} held until it arrives.
        </p>
      )}
    </div>
  );
}

function Stopped({ sessionId, transfer, onDismiss }: { sessionId: string; transfer: TransferView; onDismiss: () => void }) {
  const retry = useStartTransfer(sessionId);
  const resume = useResumeTransfer(sessionId);
  const finish = useFinishTransfer(sessionId);
  const stage = transfer.failedStage ?? transfer.stage;
  const where = transferStepLabel(stage, transfer.to.name).toLowerCase();
  const busy = retry.isPending || resume.isPending || finish.isPending;
  const button = 'rounded-md border border-border px-2.5 py-1 text-[12px] hover:bg-muted/60 disabled:opacity-50';

  return (
    <div role="alert" className="mx-auto w-full max-w-3xl rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5">
      <p className="mb-1.5 text-[12.5px] font-medium text-foreground">
        The move to {transfer.to.name} stopped while {where}.
      </p>
      <Steps transfer={transfer} failedAt={stepIndex(stage)} />
      {transfer.error && <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] text-muted-foreground">{transfer.error}</p>}
      <p className="mt-1.5 text-[11px] text-muted-foreground/80">
        {transfer.ownershipChanged
          ? `${transfer.to.name} has the work now.`
          : `${transfer.from.name} still has the work, stopped. Nothing was lost: its folder${transfer.checkpoint ? ` and ${transfer.checkpoint.branch}` : ''} are as they were.`}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {transfer.ownershipChanged ? (
          <button type="button" className={button} disabled={busy} onClick={() => finish.mutate()}>
            {transfer.heldCount > 0 ? `Deliver held messages on ${transfer.to.name}` : 'Done'}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={cn(button, 'bg-primary text-primary-foreground border-primary hover:opacity-90 hover:bg-primary')}
              disabled={busy}
              onClick={() => retry.mutate({ toComputerId: transfer.to.computerId, includeUntracked: transfer.includeUntracked })}
            >
              Try again
            </button>
            <button type="button" className={button} disabled={busy} onClick={() => resume.mutate()}>
              Resume on {transfer.from.name}
            </button>
            {transfer.heldCount === 0 && (
              <button type="button" className={button} onClick={onDismiss}>
                Dismiss
              </button>
            )}
          </>
        )}
      </div>
      {retry.error && <p className="mt-1.5 text-[11.5px] text-destructive">{apiErrorText(retry.error)}</p>}
    </div>
  );
}
