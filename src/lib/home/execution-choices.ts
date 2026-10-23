import type { RequestKey } from '@/lib/auth/request-key';
import { getTeamAiSettings, listWorkspaces } from '@/lib/db/queries';
import { HARNESS_IDS } from '@/lib/harness/registry';
import { getHarnessRuntime, resolveHarnessAuth } from '@/lib/harness/runtime';
import { resolveHomeContext, type HomeContext } from './context';
import { executionRecoveryProblem } from './execution-startup';

/** Runtime discovery is optional UI data. It never gates Home identity or content. */
export async function resolveHomeExecutionChoices(key: RequestKey | null): Promise<HomeExecutionChoice[]> {
  const { home, executionChoices } = await resolveHomeContext(key);
  const enabled = home.kind === 'personal' || Boolean(getTeamAiSettings()?.enabled);
  const agents = listWorkspaces({ status: 'active' });
  const recoveryProblem = home.kind === 'team' ? executionRecoveryProblem() : null;
  const ready = !recoveryProblem && enabled && agents.length > 0 && (await Promise.all(HARNESS_IDS.map(async harness => {
    try {
      const [runtime, auth] = await Promise.all([getHarnessRuntime(harness), resolveHarnessAuth(harness)]);
      return runtime.binary.status === 'supported' && auth.options.some(option => option.present);
    } catch { return false; }
  }))).some(Boolean);
  // A member, key or Team AI setting may have changed during a slow probe.
  await resolveHomeContext(key);
  const stillEnabled = home.kind === 'personal' || Boolean(getTeamAiSettings()?.enabled);
  const problem = home.kind === 'team' ? executionRecoveryProblem() : null;
  const available = Boolean(ready && stillEnabled && !problem);
  return executionChoices.map(choice => ({ ...choice, available,
    unavailableReason: available ? null : problem ?? (!stillEnabled ? 'Team AI is off.' : !agents.length ? 'Configure an agent first.' : 'Install and sign in to a harness in Settings.'),
  }));
}

export type HomeExecutionChoice = HomeContext['executionChoices'][number] & { available: boolean; unavailableReason: string | null };
