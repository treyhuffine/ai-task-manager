/** Team AI uses the Claude Code subscription already signed in on its host.
 * Credential storage and refresh stay with Claude Code. Ri probes only the
 * auth report and never reads, copies or stores the subscription secret. */
import os from 'node:os';
import { getProvider } from '@agentex/agent';
import type { TeamAiAuthMode, TeamAiSettingsRecord } from '@/db/types';
import * as q from '@/lib/db/queries';
import { teamAiCredentialVersion } from './secrets';

/** The same native auth home for discovery and execution. Explicit empty
 * API credentials prevent an ambient key from selecting separate billing. */
export function teamAiAuthEnv(): Record<string, string> {
  return {
    HOME: os.homedir(),
    // Even setting the default path explicitly changes Claude's config and
    // keychain namespace. Preserve an unset variable as unset.
    ...(process.env.CLAUDE_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR } : {}),
    ...(process.env.CLAUDE_CODE_OAUTH_TOKEN ? { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN } : {}),
    ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '',
    OPENAI_API_KEY: '', GEMINI_API_KEY: '', GOOGLE_API_KEY: '', CURSOR_API_KEY: '',
    AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', AWS_SESSION_TOKEN: '', AWS_REGION: '', AWS_PROFILE: '',
    ANTHROPIC_BEDROCK_BASE_URL: '',
  };
}

export function teamAiCommand(): string | undefined {
  return process.env.CLAUDE_COMMAND?.trim() || undefined;
}

export async function teamAiSubscription(fresh = false): Promise<{ available: boolean }> {
  try {
    const auth = await getProvider('claude').resolveAuth({ env: teamAiAuthEnv(), command: teamAiCommand(), fresh });
    // A credential file's mere existence isn't proof of a subscription.
    return { available: auth.source === 'cli' && auth.binary.installed && auth.options.some(option => option.method === 'subscription' && option.present === true) };
  } catch {
    return { available: false };
  }
}

export const TEAM_AI_SIGN_IN = "Sign in to Claude Code on the computer hosting this team with your Claude subscription, then check sign-in again.";

/** A saved key never changes the selected billing method by itself. */
export function teamAiAuthMode(settings: Pick<TeamAiSettingsRecord, 'authMode'> | null = q.getTeamAiSettings()): TeamAiAuthMode {
  return settings?.authMode ?? 'subscription';
}

/** Non-secret identity for ignoring outcomes from a replaced credential. */
export function teamAiAuthRevision(): string {
  const mode = teamAiAuthMode();
  return JSON.stringify([mode, mode === 'api_key' ? teamAiCredentialVersion() : null]);
}
