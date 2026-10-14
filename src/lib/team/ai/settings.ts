/**
 * Team AI's settings (docs/homes-spec.md §9.9, P8.4): off until the team's
 * owner turns it on with a provider key provisioned for the team, in Settings,
 * Team AI. Everyone's use counts against that account. A missing or refused
 * key makes Team AI unavailable: it never falls back to anyone's own.
 *
 * Every member sees whether it's on and why it might not be ready. Only the
 * owner configures it, and nobody ever sees the key again once it's saved.
 */

import * as q from '@/lib/db/queries';
import { forgetTeamAiApiKey, hasTeamAiApiKey, saveTeamAiApiKey, teamAiCredentialVersion } from './secrets';
import { probeTeamAiRuntime } from './probe';

export type TeamAiState = 'off' | 'needs_key' | 'unavailable' | 'ready';

export interface TeamAiStatus {
  enabled: boolean;
  state: TeamAiState;
  /** Why it isn't ready, in a sentence a member can act on. */
  reason: string | null;
  runtime: 'Claude Code';
  runtimeVersion: string | null;
  provider: 'Anthropic API';
  model: string | null;
  credentialLabel: string | null;
  credentialSetAt: string | null;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  mainChatId: string | null;
}

/** The error code a refused key leaves, until the owner saves another. */
export const CREDENTIAL_REJECTED = 'credential_rejected';

/** The synchronous part of readiness, rechecked after a runtime probe yields. */
function configuredStatus(): TeamAiStatus {
  const settings = q.getTeamAiSettings();
  const base = {
    enabled: Boolean(settings?.enabled),
    runtime: 'Claude Code' as const,
    provider: 'Anthropic API' as const,
    model: settings?.model ?? null,
    credentialLabel: settings?.credentialLabel ?? null,
    credentialSetAt: settings?.credentialSetAt ?? null,
    lastOkAt: settings?.lastOkAt ?? null,
    lastErrorAt: settings?.lastErrorAt ?? null,
    mainChatId: settings?.mainChatSessionId ?? null,
  };
  if (!settings?.enabled) return { ...base, state: 'off', reason: null, runtimeVersion: null };
  if (!hasTeamAiApiKey()) {
    return { ...base, state: 'needs_key', reason: "Team AI needs a provider key. The team's owner adds one in Settings, Team AI.", runtimeVersion: null };
  }
  if (settings.lastError === CREDENTIAL_REJECTED) {
    return { ...base, state: 'unavailable', reason: "The team's provider key was refused. The team's owner can save a new one in Settings, Team AI.", runtimeVersion: null };
  }
  return { ...base, state: 'ready', reason: null, runtimeVersion: null };
}

export async function teamAiStatus(options: { probe?: typeof probeTeamAiRuntime } = {}): Promise<TeamAiStatus> {
  const before = configuredStatus();
  if (before.state !== 'ready') return before;
  const probe = await (options.probe ?? probeTeamAiRuntime)();
  // Disabling AI, removing its key or a refusal can happen during the probe.
  const current = configuredStatus();
  if (current.state !== 'ready') return current;
  if (!probe.ok) {
    return {
      ...current,
      state: 'unavailable',
      reason: probe.version
        ? `Claude Code ${probe.version} on the team's host can't keep Team AI to the team's tools. Update Claude Code there.`
        : "Claude Code isn't installed on the team's host, so Team AI can't run there.",
      runtimeVersion: probe.version,
    };
  }
  return { ...current, runtimeVersion: probe.version };
}

/** Save the team's provider key and what to call its account. The key replaces any earlier one. */
export async function configureTeamAi(byMemberId: string, input: { apiKey?: string; credentialLabel: string; model?: string | null }) {
  const label = input.credentialLabel.trim();
  if (!label) throw new q.TeamError('invalid', 'Name the account the key belongs to, so everyone knows whose usage it is.');
  const apiKey = input.apiKey?.trim();
  if (apiKey !== undefined) {
    if (!apiKey) throw new q.TeamError('invalid', 'Paste the provider key.');
    await saveTeamAiApiKey(apiKey);
  } else if (!hasTeamAiApiKey()) {
    throw new q.TeamError('invalid', 'Paste the provider key.');
  }
  return q.saveTeamAiSettings({
    credentialLabel: label,
    ...(input.model !== undefined ? { model: input.model?.trim() || null } : {}),
    // A new key gets a fresh start: an earlier refusal was of the old one.
    ...(apiKey !== undefined ? { credentialSetAt: new Date().toISOString(), lastError: null, lastErrorAt: null } : {}),
  }, byMemberId);
}

/**
 * Turn Team AI on or off. On, the team gets its main chat the first time.
 * Off, queued work is cancelled and running work stopped (chat.ts); history,
 * tasks, notes and the members' own AI clients all stay.
 */
export async function setTeamAiEnabled(byMemberId: string, enabled: boolean) {
  if (!enabled) return q.saveTeamAiSettings({ enabled: false }, byMemberId);
  let settings = q.saveTeamAiSettings({ enabled: true }, byMemberId);
  if (!settings.mainChatSessionId || !q.getTeamChat(settings.mainChatSessionId)) {
    const main = q.createTeamChat(q.getHome()?.name ?? 'Team');
    settings = q.saveTeamAiSettings({ mainChatSessionId: main.id }, byMemberId);
  }
  return settings;
}

/** Remove the team's key. Team AI then needs a new one before it answers again. */
export function forgetTeamAiKey(byMemberId: string) {
  forgetTeamAiApiKey();
  return q.saveTeamAiSettings({ credentialSetAt: null, lastError: null, lastErrorAt: null }, byMemberId);
}

/** Record how the last turn went, for Settings and for availability. */
export function recordTeamAiOutcome(outcome: { ok: true } | { ok: false; code: string }, credentialVersion: string | null) {
  // An older turn cannot change the availability of a replacement key.
  if (!credentialVersion || credentialVersion !== teamAiCredentialVersion()) return;
  const now = new Date().toISOString();
  const refused = q.getTeamAiSettings()?.lastError === CREDENTIAL_REJECTED;
  // A refusal stays until the owner saves a key, even if another chat that
  // started earlier now succeeds or fails for an unrelated reason.
  if (outcome.ok) q.saveTeamAiSettings({ lastOkAt: now, ...(!refused ? { lastError: null } : {}) }, null);
  else if (refused) return;
  else q.saveTeamAiSettings({ lastError: outcome.code, lastErrorAt: now }, null);
}
