import { createWorkerCheckpoint, verifyWorkerCheckpoint } from '@/lib/service/worker-checkpoint';
import { verifyRuntime } from '@/lib/service/runtime';
import { downloadRelease, type Release } from '@/lib/service/release';
import { createCheckpoint, restoreCheckpointDatabase, validateDatabase } from '@/lib/service/checkpoint';
import { acquireRuntimeJobLease, type RuntimeJobOwner } from '@/lib/service/runtime-job-owner';
process.once('disconnect', () => process.exit(1));
process.once('message', (message: { action: string; value: unknown; owner: RuntimeJobOwner }) => {
  void (async () => {
    const release = acquireRuntimeJobLease(message.owner);
    try {
      switch (message.action) {
        case 'verify': return { id: verifyRuntime(String(message.value)).id };
        case 'download': {
          const requested = message.value as Release;
          let last = 0;
          await downloadRelease(requested, bytes => {
            if (Date.now() - last > 1000 || bytes === requested.runtime.size) {
              last = Date.now();
              process.send?.({ type: 'progress', bytes });
            }
          });
          return null;
        }
        case 'worker-checkpoint': return createWorkerCheckpoint(String(message.value));
        case 'worker-checkpoint-verify': return verifyWorkerCheckpoint(String(message.value));
        case 'checkpoint': return await createCheckpoint(String(message.value));
        case 'restore': await restoreCheckpointDatabase(String(message.value)); return null;
        case 'validate-database': validateDatabase(String(message.value), true); return null;
        default: throw new Error('Unsupported runtime job');
      }
    } finally { release(); }
  })().then(value => process.send?.({ type: 'result', value }, () => process.exit(0)))
    .catch(error => process.send?.({ type: 'error', error: error instanceof Error ? error.message : 'Runtime job failed' }, () => process.exit(1)));
});
