/**
 * The setup link for the computer the CLI runs on (src/lib/setups/service.ts).
 *
 * - On a home: in-process against its database.
 * - On a connected computer: through the home's API. The first time, the
 *   computer registers with the home under its key and remembers the id it
 *   was given.
 */

import { getInstallationRole } from '@/lib/config/role';
import { readConnection, rememberComputerId, rememberedComputerId, writeConnection } from '@/lib/connection/config';
import { thisComputerFacts } from '@/lib/home/computer-name';
import type { DispatchEnvelope } from '@/lib/orchestrator/dispatch';
import { SetupError, type SetupContext, type SetupHomeLink } from '@/lib/setups/service';
import { dispatchAction } from './dispatch';

function unwrap<T>(envelope: DispatchEnvelope): T {
  if (!envelope.ok) throw new SetupError(envelope.error?.message ?? `The home refused ${envelope.action}.`);
  return envelope.result as T;
}

async function ensureRegistered(): Promise<void> {
  const connection = readConnection();
  if (!connection || connection.computerId) return;
  const { computer } = unwrap<{ computer: { id: string } }>(
    await dispatchAction('register_computer', { ...thisComputerFacts(), computerId: rememberedComputerId(connection.homeId) }),
  );
  writeConnection({ ...connection, computerId: computer.id });
  rememberComputerId(connection.homeId, computer.id);
}

export async function setupLinkForThisComputer(): Promise<SetupHomeLink> {
  if (getInstallationRole() === 'home') {
    const { inProcessSetupLink } = await import('@/lib/setups/home-context');
    return inProcessSetupLink();
  }
  await ensureRegistered();
  return {
    async context() {
      return unwrap<SetupContext>(await dispatchAction('get_setup_context', {}));
    },
    async report(reports, complete) {
      return unwrap(await dispatchAction('report_agent_setups', { reports, complete }));
    },
  };
}
