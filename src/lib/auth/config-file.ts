/**
 * Persistent config at `~/.<APP_SHORT_ID>/config.json`.
 * - Directory mode 0700, file mode 0600.
 * - Only the host's own plaintext token lives here. Remote-device tokens never touch disk.
 */

import fs from 'node:fs';
import { ensureUserDataDir, getConfigPath, getUserDataDir } from '@/lib/config/paths';

export interface AuthConfig {
  version: 1;
  localToken: string | null;
  tunnelUrl: string | null;
  onboardedAt: string | null;
  voiceEnabled: boolean | null;
}

export function getAuthConfigDir(): string {
  return getUserDataDir();
}

export function getAuthConfigPath(): string {
  return getConfigPath();
}

export function readAuthConfig(): AuthConfig | null {
  const p = getAuthConfigPath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AuthConfig>;
    return {
      version: 1,
      localToken: parsed.localToken ?? null,
      tunnelUrl: parsed.tunnelUrl ?? null,
      onboardedAt: parsed.onboardedAt ?? null,
      voiceEnabled: parsed.voiceEnabled ?? null,
    };
  } catch (err) {
    console.error('[auth] failed to read config.json:', err);
    return null;
  }
}

export function writeAuthConfig(config: Partial<AuthConfig>): AuthConfig {
  ensureUserDataDir();

  const existing = readAuthConfig();
  const next: AuthConfig = {
    version: 1,
    localToken: config.localToken ?? existing?.localToken ?? null,
    tunnelUrl: config.tunnelUrl ?? existing?.tunnelUrl ?? null,
    onboardedAt: config.onboardedAt ?? existing?.onboardedAt ?? null,
    voiceEnabled: config.voiceEnabled ?? existing?.voiceEnabled ?? null,
  };

  const p = getAuthConfigPath();
  fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    // Best-effort.
  }

  return next;
}
