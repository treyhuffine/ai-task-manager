/**
 * Persistent config at `~/<APP_SHORT_ID>/config.json`.
 * - Directory mode 0700, file mode 0600.
 * - Only the host's own plaintext token lives here. Remote-device tokens never touch disk.
 */

import fs from 'node:fs';
import { ensureConfigDir, getConfigPath, getConfigDir } from '@/lib/config/paths';

export interface AuthConfig {
  version: 1;
  localToken: string | null;
  tunnelUrl: string | null;
  onboardedAt: string | null;
  voiceEnabled: boolean | null;
  /** Last port the server was started on. Written by `start`, read by `pair`
   *  so the CLI shows the right port even when invoked from a different shell. */
  lastPort: number | null;
  /** Stable local hostname fronting the dev server (e.g. `https://flow.localhost`
   *  via portless). Written by `start --portless`, cleared by `start` without it.
   *  When set, `getLocalBaseUrl()` prefers it over `http://localhost:<port>`. */
  staticUrl: string | null;
}

export function getAuthConfigDir(): string {
  return getConfigDir();
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
      lastPort: parsed.lastPort ?? null,
      staticUrl: parsed.staticUrl ?? null,
    };
  } catch (err) {
    console.error('[auth] failed to read config.json:', err);
    return null;
  }
}

export function writeAuthConfig(config: Partial<AuthConfig>): AuthConfig {
  ensureConfigDir();

  const existing = readAuthConfig();

  // Distinguish "caller didn't mention this field" (preserve existing) from
  // "caller explicitly set it to null" (clear). `??` can't tell those apart,
  // so use the `in` operator for presence detection.
  const pick = <K extends keyof AuthConfig>(key: K): AuthConfig[K] =>
    (key in config ? config[key] : existing?.[key]) ?? (null as AuthConfig[K]);

  const next: AuthConfig = {
    version: 1,
    localToken: pick('localToken'),
    tunnelUrl: pick('tunnelUrl'),
    onboardedAt: pick('onboardedAt'),
    voiceEnabled: pick('voiceEnabled'),
    lastPort: pick('lastPort'),
    staticUrl: pick('staticUrl'),
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
