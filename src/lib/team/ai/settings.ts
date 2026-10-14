/** Team AI stays off until its owner enables it. Subscription is the default.
 * An API key is used only when the owner explicitly selects API billing. */
import type { TeamAiAuthMode } from '@/db/types';
import * as q from '@/lib/db/queries';
import { processState } from '@/lib/process-state';
import { forgetTeamAiApiKey, hasTeamAiApiKey, readTeamAiApiKey, saveTeamAiApiKey } from './secrets';
import { probeTeamAiRuntime } from './probe';
import { teamAiAuthMode, teamAiAuthRevision, teamAiSubscription, TEAM_AI_SIGN_IN } from './auth';

export type TeamAiState = 'off' | 'needs_sign_in' | 'needs_key' | 'credential_rejected' | 'unavailable' | 'ready';
export interface TeamAiStatus {
  enabled: boolean;
  state: TeamAiState;
  reason: string | null;
  runtime: 'Claude Code';
  runtimeVersion: string | null;
  provider: 'Claude subscription' | 'Anthropic API';
  authMode: TeamAiAuthMode;
  hasApiKey: boolean;
  model: string | null;
  credentialLabel: string | null;
  credentialSetAt: string | null;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  mainChatId: string | null;
}
export const CREDENTIAL_REJECTED = 'credential_rejected';

function configuredStatus(): TeamAiStatus {
  const settings = q.getTeamAiSettings();
  const authMode = teamAiAuthMode(settings);
  return {
    enabled: Boolean(settings?.enabled), state: settings?.enabled ? 'ready' : 'off', reason: null,
    runtime: 'Claude Code', runtimeVersion: null,
    provider: authMode === 'api_key' ? 'Anthropic API' : 'Claude subscription', authMode,
    hasApiKey: hasTeamAiApiKey(), model: settings?.model ?? null,
    credentialLabel: authMode === 'api_key' ? settings?.credentialLabel ?? null : 'Claude Code sign-in on the team host',
    credentialSetAt: settings?.credentialSetAt ?? null,
    lastOkAt: settings?.lastOkAt ?? null, lastErrorAt: settings?.lastErrorAt ?? null,
    mainChatId: settings?.mainChatSessionId ?? null,
  };
}

export async function teamAiStatus(options: { probe?: typeof probeTeamAiRuntime; freshAuth?: boolean } = {}): Promise<TeamAiStatus> {
  const before = configuredStatus();
  // No auth discovery or runtime work at all until the owner turns AI on.
  if (!before.enabled) return before;
  const probe = await (options.probe ?? probeTeamAiRuntime)();
  let current = configuredStatus();
  if (!current.enabled) return current;
  if (!probe.ok) return {
    ...current, state: 'unavailable', runtimeVersion: probe.version,
    reason: probe.version
      ? `Claude Code ${probe.version} on the team's host can't keep Team AI to the team's tools. Update Claude Code there.`
      : "Claude Code isn't installed on the team's host, so Team AI can't run there.",
  };
  const revision = teamAiAuthRevision();
  const available = current.authMode === 'api_key'
    ? Boolean(await readTeamAiApiKey())
    : (await teamAiSubscription(options.freshAuth || q.getTeamAiSettings()?.lastError === CREDENTIAL_REJECTED)).available;
  current = configuredStatus();
  if (!current.enabled) return current;
  if (revision !== teamAiAuthRevision()) return { ...current, state: 'unavailable', reason: 'Team AI authentication changed. Try again.' };
  if (current.authMode === 'api_key') {
    if (!available) return { ...current, runtimeVersion: probe.version, state: 'needs_key', reason: 'The team owner needs to save an Anthropic API key in Settings.' };
    if (q.getTeamAiSettings()?.lastError === CREDENTIAL_REJECTED) return { ...current, runtimeVersion: probe.version, state: 'credential_rejected', reason: 'Anthropic refused the saved API key. The team owner needs to replace it in Settings.' };
  }
  return { ...current, runtimeVersion: probe.version,
    ...(available ? {} : { state: 'needs_sign_in' as const, reason: TEAM_AI_SIGN_IN }) };
}

// Credential writes include asynchronous encryption. Serialize owner changes
// so a slower save cannot overwrite a later removal or authentication choice.
const configuration = processState('team-ai:configuration', () => ({ pending: Promise.resolve() }));
function changeConfiguration<T>(change: () => Promise<T>): Promise<T> {
  const result = configuration.pending.then(change);
  configuration.pending = result.then(() => {}, () => {});
  return result;
}

export function configureTeamAi(byMemberId: string, input: { authMode?: TeamAiAuthMode; apiKey?: string; model?: string | null }) {
  return changeConfiguration(async () => {
    const apiKey = input.apiKey?.trim();
    if (apiKey !== undefined && (!apiKey || input.authMode !== 'api_key')) throw new q.TeamError('invalid', 'Choose API key authentication and paste a key.');
    if (apiKey !== undefined) await saveTeamAiApiKey(apiKey);
    return q.saveTeamAiSettings({
      ...(input.authMode !== undefined ? { authMode: input.authMode, ...(input.authMode !== teamAiAuthMode() ? { lastError: null, lastErrorAt: null } : {}) } : {}),
      ...(input.model !== undefined ? { model: input.model?.trim() || null } : {}),
      ...(apiKey !== undefined ? { credentialSetAt: new Date().toISOString(), credentialLabel: null, lastError: null, lastErrorAt: null } : {}),
    }, byMemberId);
  });
}

export async function setTeamAiEnabled(byMemberId: string, enabled: boolean) {
  if (!enabled) return q.saveTeamAiSettings({ enabled: false }, byMemberId);
  let settings = q.saveTeamAiSettings({ enabled: true }, byMemberId);
  if (!settings.mainChatSessionId || !q.getTeamChat(settings.mainChatSessionId)) {
    const main = q.createTeamChat(q.getHome()?.name ?? 'Team');
    settings = q.saveTeamAiSettings({ mainChatSessionId: main.id }, byMemberId);
  }
  return settings;
}

/** Forgetting a key never changes the billing method or native sign-in. */
export function forgetTeamAiKey(byMemberId: string) {
  return changeConfiguration(async () => {
    forgetTeamAiApiKey();
    return q.saveTeamAiSettings({ credentialSetAt: null, credentialLabel: null, lastError: null, lastErrorAt: null }, byMemberId);
  });
}

export function recordTeamAiOutcome(outcome: { ok: true } | { ok: false; code: string }, revision: string) {
  if (revision !== teamAiAuthRevision()) return;
  const now = new Date().toISOString();
  // One still-running chat's success cannot revive a rejected API key.
  const refused = teamAiAuthMode() === 'api_key' && q.getTeamAiSettings()?.lastError === CREDENTIAL_REJECTED;
  if (outcome.ok) q.saveTeamAiSettings({ lastOkAt: now, ...(!refused ? { lastError: null } : {}) }, null);
  else if (!refused) q.saveTeamAiSettings({ lastError: outcome.code, lastErrorAt: now }, null);
}
