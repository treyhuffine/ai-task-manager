import * as q from '@/lib/db/queries';
import { processState } from '@/lib/process-state';
import { perfScope } from '@/lib/perf/recorder';
import { syncFinanceBank, FinanceSourceError } from './sources';
import { syncFinanceMailbox } from './mail';
import { reconcileFinance } from './service';
const state = processState<{
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
}>('finance.worker', () => ({ timer: null, running: false, lastStartedAt: null, lastFinishedAt: null }));
export async function runFinanceCatchup() {
  if (state.running) return;
  state.running = true;
  state.lastStartedAt = new Date().toISOString();
  try {
    q.cleanupFinanceFiles();
    for (const job of q.claimFinanceJobs(new Date().toISOString(), 3)) {
      const heartbeat=setInterval(()=>{if(job.leaseToken)q.renewFinanceJobLease(job.id,job.leaseToken,job.generation);},60000);heartbeat.unref();
      try {
        const a = q.requireFinance(q.financeOwner, [job.accountId], 'sync')[0];
        let cursor = job.cursor,
          more = false,
          monitoring = true;
        if (a.provider === 'plaid')
          cursor = await syncFinanceBank(q.financeOwner, job);
        else if (['google', 'microsoft'].includes(a.provider)) {
          const result = await syncFinanceMailbox(q.financeOwner, job);
          cursor = result.cursor;
          more = result.hasMore;
          monitoring = result.monitoring ?? true;
        } else {
          q.finishFinanceJob(job.id, {
            generation: job.generation,
            leaseToken:job.leaseToken,
            stop: true,
          });
          continue;
        }
        q.finishFinanceJob(job.id, {
          generation: job.generation,
            leaseToken:job.leaseToken,
          cursor,
          catchup: more,
          stop: !more && !monitoring,
        });
        const accounts = q
          .listFinanceAccounts(q.financeOwner)
          .filter((a) => a.access === 'connected');
        if (accounts.length) {
          const budget = q
            .listFinanceBudgets(q.financeOwner)
            .find((b) => b.state === 'adopted');
          const endOn = new Date(Date.now() + 86400000)
              .toISOString()
              .slice(0, 10),
            start = new Date();
          start.setUTCFullYear(start.getUTCFullYear() - 2);
          reconcileFinance(q.financeOwner, {
            accountIds: accounts.map((a) => a.id),
            startOn: start.toISOString().slice(0, 10),
            endOn,
            budgetId: budget?.id ?? null,
            evidenceId: null,
          });
        }
      } catch (e) {
        const reconnect =
          e instanceof FinanceSourceError &&
          ['auth_required', 'needs_consent', 'ITEM_LOGIN_REQUIRED'].includes(
            e.code,
          );
        try {
          if(job.leaseToken)q.assertFinanceJobLease(job.id,job.leaseToken,job.generation);
          q.updateFinanceAccountSource(q.financeOwner, job.accountId, {
            syncStatus: reconnect ? 'reconnect' : 'stale',
          });
        } catch {
          /* Deleted, disabled or revoked during the job. */
        }
        q.finishFinanceJob(job.id, {
          generation: job.generation,
            leaseToken:job.leaseToken,
          failed: true,
          reconnect,
        });
      } finally { clearInterval(heartbeat); }
    }
  } finally {
    state.running = false;
    state.lastFinishedAt = new Date().toISOString();
  }
}
export function startFinanceWorker() {
  if (state.timer) return;
  const run = () =>
    void perfScope('timer:finance-catchup', () => runFinanceCatchup()).catch(
      () => {},
    );
  state.timer = setInterval(run, 60000);
  state.timer.unref();
  run();
}
export function stopFinanceWorker() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

export function financeWorkerHealth() {
  return { started: !!state.timer, running: state.running, lastStartedAt: state.lastStartedAt, lastFinishedAt: state.lastFinishedAt };
}
