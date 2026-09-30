import path from 'node:path';
import type { ServiceSession, ServiceStatus } from '../src/lib/service/client';
import type { BackendReady } from './config';

/** A viewer never picks replacement binaries for an existing owner. Older
 * owners that do not report Node remain viewable without local CLI actions. */
export function runtimeForOwner(owner: Pick<ServiceStatus, 'repo' | 'node'>, active: BackendReady['runtime'] | null): BackendReady['runtime'] {
  if (!path.isAbsolute(owner.repo)) return;
  if (active?.repo === owner.repo && (!owner.node || active.node === owner.node)) return active;
  if (owner.node && path.isAbsolute(owner.node)) return { repo: owner.repo, node: owner.node };
}

/** Attach-only wait. If the owner goes away, require an explicit retry rather
 * than silently spawning this shell's bundled code in its data directory. */
export async function attachExistingOwner<T extends ServiceStatus = ServiceSession>(dependencies: {
  status: () => Promise<ServiceStatus | null>;
  session: () => Promise<T>;
  delay?: () => Promise<void>;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + (dependencies.timeoutMs ?? 180_000);
  while (Date.now() <= deadline) {
    const status = await dependencies.status();
    if (!status) throw new Error('The existing service stopped while connecting. Start it with its matching CLI and retry.');
    if (status.phase === 'running') return dependencies.session();
    if (status.phase === 'failed') throw new Error(status.error ?? 'The existing service needs recovery.');
    if (status.phase === 'stopping') throw new Error('The existing service is stopping. Wait and retry after it restarts.');
    await (dependencies.delay?.() ?? new Promise(resolve => setTimeout(resolve, 250)));
  }
  throw new Error('The existing service did not become ready. Inspect its status before retrying.');
}
