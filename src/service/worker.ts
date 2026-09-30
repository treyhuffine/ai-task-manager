/** Supervised execution child. The IPC parent owns lifetime, never its Home. */
import fs from 'node:fs';
import path from 'node:path';
import { readConnection } from '@/lib/connection/config';
import { readWorkerConfig } from '@/lib/worker/config';
import { resolveServiceRole } from '@/lib/service/role';
import { runWorker, finishWorker, liveSnapshot, type WorkerExit } from '@/lib/worker/run';
import { installRunnerSink } from '@/lib/runner/sink';
import { closeIdleSessions } from '@/lib/runner/local-runner';
import { executionHandlers, executionRequests } from '@/lib/worker/handlers';
import { workerDescendants, stopWorkerDescendants } from '@/lib/service/worker-processes';
import { assertWorkerJournalFormats } from '@/lib/worker/journal-formats';
import { workerUpdateCompatibility } from '@/lib/releases/runtime-identity';
import type { CommandJournal } from '@/lib/worker/command-journal';
import type { EventJournal } from '@/lib/worker/event-journal';

async function main() {
  if (!process.send) throw new Error('The execution worker must be started by its background service.');
  if (process.argv.includes('--validate')) {
    const role = resolveServiceRole().role;
    if (!['worker', 'viewer'].includes(role)) throw new Error('The connected-device role changed during validation.');
    const enrolled = readWorkerConfig();
    if (enrolled) assertWorkerJournalFormats(enrolled.homeId);
    const reasons = workerUpdateCompatibility(process.cwd());
    if (reasons.length) throw new Error(reasons.join(' '));
    process.exit(0);
  }
  if (resolveServiceRole().role !== 'worker') throw new Error('This device is not enrolled with its connected Home.');
  const connection = readConnection()!;
  const worker = readWorkerConfig()!;
  const target = { homeUrl: connection.homeUrl, homeId: connection.homeId, homeName: connection.homeName, deviceName: worker.deviceName, workerKey: worker.workerKey };
  const version = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version as string;
  const controller = new AbortController();
  let paused = false;
  let commands: CommandJournal | undefined;
  let events: EventJournal | undefined;
  let inFlightRequests = () => 0;
  const send = (value: object) => { if (process.connected) process.send?.(value, () => {}); };
  const stop = () => controller.abort();
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.once('disconnect', () => { stop(); setTimeout(() => process.exit(1), 45_000).unref(); });
  const activity = async () => {
    const live = liveSnapshot();
    if (paused) await closeIdleSessions(Date.now(), 0);
    return [
      !commands && 'Worker is starting',
      live.running.length && `${live.running.length} running sessions`,
      live.pending.length && `${live.pending.length} pending permissions`,
      Object.keys(live.backgroundTasks).length && `${Object.keys(live.backgroundTasks).length} background tasks`,
      inFlightRequests() > 0 && `${inFlightRequests()} local requests are still running`,
      commands?.interrupted().length && 'Worker commands are still being handled',
      commands?.openTurns().length && 'Worker turns have not finished',
    ].filter(Boolean) as string[];
  };
  const pending = () => ({ events: events?.pending().length ?? 0, acknowledgements: commands?.unconfirmed().length ?? 0 });
  let control = Promise.resolve();
  process.on('message', (message: { action?: string; id?: string }) => {
    if (typeof message?.id !== 'string' || !['prepare', 'resume', 'activity'].includes(message.action ?? '')) return;
    // Close admission synchronously before waiting for an earlier snapshot.
    if (message.action === 'prepare') paused = true;
    control = control.then(async () => {
      try {
        if (message.action === 'prepare') await closeIdleSessions(Date.now(), 0);
        if (message.action === 'resume') paused = false;
        send({ type: 'reply', id: message.id, activity: await activity(), pending: pending() });
      } catch (error) { send({ type: 'reply', id: message.id, error: error instanceof Error ? error.message : 'Worker control failed' }); }
    });
  });
  const sweep = setInterval(() => void closeIdleSessions().catch(() => {}), 60_000);
  const report = setInterval(() => void activity().then(reasons => send({ type: 'activity', activity: reasons, pending: pending() })).catch(() => {}), 5000);
  sweep.unref(); report.unref();
  let unclosed: string[] = [];
  let exit: WorkerExit;
  try {
    exit = await runWorker({ target, version, signal: controller.signal, paused: () => paused,
      onSink: installRunnerSink,
      onJournals: journals => { commands = journals.commands; events = journals.events; inFlightRequests = journals.requests; },
      handlers: (journal, extras) => executionHandlers({ journal, ...extras }),
      requests: journal => executionRequests({ journal, homeId: target.homeId }),
      onStatus: state => send({ type: 'state', state }),
      beforeUnlock: async outcome => {
        paused = true;
        const descendants = await workerDescendants();
        unclosed = await finishWorker(target, version, outcome ?? { reason: 'protocol', message: 'The local worker failed.' });
        const remaining = await stopWorkerDescendants(descendants);
        const deadline = Date.now() + 2000;
        while (inFlightRequests() > 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        const late = await stopWorkerDescendants(await workerDescendants());
        if (remaining.length || late.length) throw new Error('Local worker processes did not close. Inspect them before resuming.');
      },
    });
  } finally { clearInterval(sweep); clearInterval(report); }
  if (unclosed.length) throw new Error(`${unclosed.length} worker sessions did not close. Inspect local processes before resuming.`);
  await new Promise<void>(resolve => {
    if (!process.connected) return resolve();
    process.send?.({ type: 'exit', exit }, () => resolve());
  });
  process.exit(exit.reason === 'stopped' ? 0 : 1);
}
void main().catch(error => {
  const exit = { reason: 'failed', message: error instanceof Error ? error.message : 'The local worker failed to start.' };
  if (process.connected) process.send?.({ type: 'exit', exit }, () => process.exit(1));
  else process.exit(1);
});
