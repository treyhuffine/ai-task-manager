/** Team AI is optional. Harness installation and sign-in use the ordinary Home flows. */
import { executionRecoveryProblem } from '@/lib/home/execution-startup';
import * as q from '@/lib/db/queries';
import { forgetTeamAiApiKey, hasTeamAiApiKey } from './secrets';
import { HARNESS_IDS, harnessDefinition, type HarnessId } from '@/lib/harness/registry';
import { getHarnessRuntime, resolveHarnessAuth } from '@/lib/harness/runtime';
import { resolveStartSelection } from '@/lib/harness/start-selection';
import { hasTeamCapability } from '@/lib/team/capabilities';

export type TeamAiState = 'off' | 'needs_sign_in' | 'unavailable' | 'ready';
export interface TeamAiStatus {
  enabled: boolean; state: TeamAiState; reason: string | null;
  runtime: string; runtimeVersion: string | null; provider: string; harness: HarnessId;
  authMode: 'subscription' | 'api_key'; hasApiKey: boolean; credentialUnused: boolean;
  model: string | null; credentialLabel: string | null; credentialSetAt: string | null;
  lastOkAt: string | null; lastErrorAt: string | null; mainChatId: string | null;
}

/** The same runtime and auth discovery used by personal Ri. No key is returned. */
export async function teamAiStatus(options: { freshAuth?: boolean } = {}): Promise<TeamAiStatus> {
  const settings = q.getTeamAiSettings();
  const harness = settings?.harness ?? HARNESS_IDS[0];
  const base: TeamAiStatus = {
    enabled: Boolean(settings?.enabled), state: settings?.enabled ? 'unavailable' : 'off', reason: null,
    harness, runtime: harnessDefinition(harness).name, runtimeVersion: null, provider: 'This team server',
    authMode: 'subscription', hasApiKey: hasTeamAiApiKey(), credentialUnused: true,
    model: settings?.model ?? null, credentialLabel: settings?.credentialLabel ?? null,
    credentialSetAt: settings?.credentialSetAt ?? null, lastOkAt: settings?.lastOkAt ?? null,
    lastErrorAt: settings?.lastErrorAt ?? null, mainChatId: settings?.mainChatSessionId ?? null,
  };
  if (!base.enabled) return base;
  const recoveryProblem = executionRecoveryProblem();
  if (recoveryProblem) return { ...base, state: 'unavailable', reason: recoveryProblem };
  const results = await Promise.all(HARNESS_IDS.map(async id => {
    try {
      const [runtime, auth] = await Promise.all([getHarnessRuntime(id, { refresh: options.freshAuth }), resolveHarnessAuth(id, { fresh: options.freshAuth })]);
      return { id, runtime, signedIn: auth.options.some(option => option.present) };
    } catch { return null; }
  }));
  const installed = results.filter(result => result?.runtime.binary.status === 'supported');
  const ready = installed.find(result => result?.signedIn && result.id === harness) ?? installed.find(result => result?.signedIn);
  if (ready) return { ...base, state: 'ready', harness: ready.id, runtime: harnessDefinition(ready.id).name, runtimeVersion: ready.runtime.binary.version ?? null };
  return { ...base, state: installed.length ? 'needs_sign_in' : 'unavailable', reason: installed.length
    ? 'Sign in to an installed harness on this team server. Everyone on the team uses this sign-in.'
    : 'Install and sign in to a supported harness on this team server.' };
}

function owner(byMemberId: string) {
  if (!hasTeamCapability(q.getMember(byMemberId), 'manageSignIns')) throw new q.TeamError('not_allowed', 'Only an authorized owner can configure Team AI.');
}
export async function configureTeamAi(byMemberId: string, input: { model?: string | null; harness?: HarnessId }) {
  owner(byMemberId);
  const current = q.getTeamAiSettings();
  const selection = await resolveStartSelection({ providerId: input.harness ?? current?.harness, model: input.model ?? current?.model });
  return q.saveTeamAiSettings({ harness: selection.providerId, model: selection.model }, byMemberId);
}
export async function setTeamAiEnabled(byMemberId: string, enabled: boolean) {
  owner(byMemberId);
  return q.saveTeamAiSettings({ enabled }, byMemberId);
}
/** The retired encrypted key is preserved, explicitly unused, until its owner removes it. */
export async function forgetTeamAiKey(byMemberId: string) {
  owner(byMemberId);
  forgetTeamAiApiKey();
  return q.saveTeamAiSettings({ credentialSetAt: null, credentialLabel: null }, byMemberId);
}
