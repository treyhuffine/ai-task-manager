import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inputDigest, fileLock, type ActionOutcome } from '@integrations/engine';
import { processState } from '@/lib/process-state';
import { getIntegrationsDir } from './storage';

const pending = processState('integrations.source-invocations', () => new Map<string, { digest: string; promise: Promise<ActionOutcome> }>());
interface Receipt { digest: string; state: 'running' | 'paused' | 'finished'; outcome?: ActionOutcome }
/** Durable attempts make an unknown post-crash outcome non-replayable. Only pre-effect pauses retry. */
export async function runSourceInvocation(chatId: string, invocationId: string, binding: unknown, run: () => Promise<ActionOutcome>): Promise<ActionOutcome> {
  const dir = path.join(getIntegrationsDir(), 'source-invocations');
  const file = path.join(dir, `${inputDigest([chatId, invocationId])}.json`);
  const digest = inputDigest(binding);
  const current = pending.get(file);
  if (current) {
    if (current.digest !== digest) throw new Error('This invocation ID already names a different operation');
    return current.promise;
  }
  const promise = (async () => {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const lock = fileLock({ dir: path.join(dir, 'locks') });
    const write = async (receipt: Receipt) => {
      const temp = `${file}.${randomUUID()}.tmp`;
      const handle = await fs.open(temp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(receipt)); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temp, file);
    };
    const existing = await lock.withLock(path.basename(file), async () => {
      const stored = await fs.readFile(file, 'utf8').then(v => JSON.parse(v) as Receipt).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (stored && stored.digest !== digest) throw new Error('This invocation ID already names a different operation');
      if (stored?.state === 'finished') return stored;
      if (stored?.state === 'running') throw new Error('The previous attempt has an unknown outcome. Check the service before starting a new operation.');
      await write({ digest, state: 'running' });
      return null;
    });
    if (existing) {
      if (!existing.outcome) throw new Error('This operation finished. Its result was too large to retain and will not be replayed.');
      return existing.outcome;
    }
    // A thrown transport error deliberately leaves a durable unknown attempt.
    const outcome = await run();
    const paused = !outcome.ok && ['approval_required', 'auth_required', 'needs_consent', 'needs_account', 'denied'].includes(outcome.reason);
    const retained = Buffer.byteLength(JSON.stringify(outcome)) <= 512 * 1024;
    await write({ digest, state: paused ? 'paused' : 'finished', ...(retained ? { outcome } : {}) });
    return outcome;
  })();
  pending.set(file, { digest, promise });
  try { return await promise; } finally { pending.delete(file); }
}
