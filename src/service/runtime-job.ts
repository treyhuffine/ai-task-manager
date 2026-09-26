import { verifyRuntime } from '@/lib/service/runtime';
import { downloadRelease, type Release } from '@/lib/service/release';
import { createCheckpoint, restoreCheckpointDatabase, validateDatabase } from '@/lib/service/checkpoint';
process.once('disconnect', () => process.exit(1));
process.once('message', (message: { action: string; value: unknown }) => {
  void (async () => {
    switch (message.action) {
      case 'verify': return { id: verifyRuntime(String(message.value)).id };
      case 'download': {
        let last = 0;
        await downloadRelease(message.value as Release, bytes => { if (Date.now() - last > 1000) { last = Date.now(); process.send?.({ type: 'progress', bytes }); } });
        return null;
      }
      case 'checkpoint': return createCheckpoint(String(message.value));
      case 'restore': await restoreCheckpointDatabase(String(message.value)); return null;
      case 'validate-database': validateDatabase(String(message.value), true); return null;
      default: throw new Error('Unsupported runtime job');
    }
  })().then(value => process.send?.({ type: 'result', value }, () => process.exit(0)))
    .catch(error => process.send?.({ type: 'error', error: error instanceof Error ? error.message : 'Runtime job failed' }, () => process.exit(1)));
});
