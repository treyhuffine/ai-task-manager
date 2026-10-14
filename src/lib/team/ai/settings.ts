/** Team AI stays off until its owner enables it. It then uses the host's
 * existing Claude Code subscription, with no separate API key or billing. */
import * as q from '@/lib/db/queries';
import { forgetTeamAiApiKey } from './secrets';
import { probeTeamAiRuntime } from './probe';
import { teamAiSubscription, TEAM_AI_SIGN_IN } from './auth';

export type TeamAiState = 'off' | 'needs_sign_in' | 'unavailable' | 'ready';
export interface TeamAiStatus {
  enabled: boolean;
  state: TeamAiState;
  reason: string | null;
  runtime: 'Claude Code';
  runtimeVersion: string | null;
  provider: 'Claude subscription';
  model: string | null;
  credentialLabel: string | null;
  /** Retained for older clients. Team AI no longer provisions API keys. */
  credentialSetAt: null;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  mainChatId: string | null;
}
export const CREDENTIAL_REJECTED = 'credential_rejected';

function configuredStatus(): TeamAiStatus {
  const settings = q.getTeamAiSettings();
  return {
    enabled: Boolean(settings?.enabled), state: settings?.enabled ? 'ready' : 'off', reason: null,
    runtime: 'Claude Code', runtimeVersion: null, provider: 'Claude subscription',
    model: settings?.model ?? null,
    credentialLabel: settings?.enabled ? 'Claude Code sign-in on the team host' : null,
    credentialSetAt: null,
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
  const auth = await teamAiSubscription(options.freshAuth || q.getTeamAiSettings()?.lastError === CREDENTIAL_REJECTED);
  current = configuredStatus();
  if (!current.enabled) return current;
  return { ...current, runtimeVersion: probe.version,
    ...(auth.available ? {} : { state: 'needs_sign_in' as const, reason: TEAM_AI_SIGN_IN }) };
}

/** The only model setting is optional. Authentication belongs to Claude Code. */
export async function configureTeamAi(byMemberId: string, input: { model?: string | null }) {
  return q.saveTeamAiSettings({ ...(input.model !== undefined ? { model: input.model?.trim() || null } : {}) }, byMemberId);
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

/** Compatibility cleanup for API keys saved by an older client. Removing one
 * never signs the host out or stops subscription-backed work. */
export function forgetTeamAiKey(byMemberId: string) {
  forgetTeamAiApiKey();
  return q.saveTeamAiSettings({ credentialSetAt: null, credentialLabel: null }, byMemberId);
}

/** A failed turn is visible in its chat. Readiness always checks the native
 * sign-in again, so reauthentication can recover without replacing a key. */
export function recordTeamAiOutcome(outcome: { ok: true } | { ok: false; code: string }) {
  const now = new Date().toISOString();
  q.saveTeamAiSettings(outcome.ok ? { lastOkAt: now, lastError: null } : { lastError: outcome.code, lastErrorAt: now }, null);
}
