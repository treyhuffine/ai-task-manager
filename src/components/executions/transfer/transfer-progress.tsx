'use client';

/**
 * A move between devices, in one place (docs/homes-spec.md §8.2, P4.2 to
 * P4.4): Preparing, Saving work, Setting up MacBook, Continuing. When it
 * stops, where and why, and the ways on: before the destination took the
 * work, Try again or Resume on the source. After, Finish there. Messages
 * sent meanwhile are held until one of those, and say so under each one.
 * There's no dismissing it: a stopped move holds new messages until it's
 * settled (P4 review). Once settled, its held messages going out, and if
 * one wasn't taken, that delivery stopping with Send them again (P4
 * re-check).
 */

import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useDeliverHeld, useFinishTransfer, useResumeTransfer, useStartTransfer, useTransfer } from '@/hooks/use-execution';
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
  if (!transfer) return null;
  if (transfer.state === 'succeeded' || transfer.state === 'cancelled') {
    return transfer.heldCount > 0 ? <Delivering sessionId={sessionId} transfer={transfer} /> : null;
  }
  return transfer.state === 'active' ? <Moving transfer={transfer} /> : <Stopped sessionId={sessionId} transfer={transfer} />;
}

/** Held messages going out after Resume or Finish, or stopped short at one nothing took. */
function Delivering({ sessionId, transfer }: { sessionId: string; transfer: TransferView }) {
  const again = useDeliverHeld(sessionId);
  const where = transfer.state === 'cancelled' ? transfer.from.name : transfer.to.name;
  const count = transfer.heldCount === 1 ? 'A held message' : `${transfer.heldCount} held messages`;
  if (!transfer.error || transfer.delivering) {
    return (
      <p role="status" className="mx-auto flex w-full max-w-3xl items-center gap-1.5 px-1 text-[11.5px] text-muted-foreground">
        <Loader2 size={11} className="animate-spin" /> Sending {count.toLowerCase()} to {where}
      </p>
    );
  }
  return (
    <div role="alert" className="mx-auto w-full max-w-3xl rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5">
      <p className="text-[12.5px] font-medium text-foreground">{count} didn&apos;t go to {where}.</p>
      <p className="mt-1 whitespace-pre-wrap text-[11.5px] text-muted-foreground">{transfer.error}</p>
      <p className="mt-1 text-[11px] text-muted-foreground/80">They stay in order, and new messages wait behind them.</p>
      <button
        type="button"
        disabled={again.isPending}
        onClick={() => again.mutate()}
        className="mt-2 rounded-md border border-primary bg-primary px-2.5 py-1 text-[12px] text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        Send them again
      </button>
    </div>
  );
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

function Stopped({ sessionId, transfer }: { sessionId: string; transfer: TransferView }) {
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
          : `${transfer.from.name} still has the work, stopped. Nothing was lost: ${transfer.checkpoint ? `its folder and ${transfer.checkpoint.branch} are as they were` : 'its folder is as it was'}.`}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground/80">
        {transfer.heldCount > 0
          ? `${transfer.heldCount === 1 ? 'A message you sent is' : `${transfer.heldCount} messages you sent are`} held until you choose. New ones wait too.`
          : 'Messages you send wait here until you choose.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {transfer.ownershipChanged ? (
          <button type="button" className={button} disabled={busy} onClick={() => finish.mutate()}>
            {transfer.heldCount > 0 ? `Deliver held messages on ${transfer.to.name}` : `Finish on ${transfer.to.name}`}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={cn(button, 'bg-primary text-primary-foreground border-primary hover:opacity-90 hover:bg-primary')}
              disabled={busy}
              onClick={() => retry.mutate({ toDeviceId: transfer.to.deviceId, includeUntracked: transfer.includeUntracked })}
            >
              Try again
            </button>
            <button type="button" className={button} disabled={busy} onClick={() => resume.mutate()}>
              Resume on {transfer.from.name}
            </button>
          </>
        )}
      </div>
      {[retry.error, resume.error, finish.error].filter(Boolean).map((err, i) => (
        <p key={i} className="mt-1.5 text-[11.5px] text-destructive">
          {apiErrorText(err)}
        </p>
      ))}
    </div>
  );
}
