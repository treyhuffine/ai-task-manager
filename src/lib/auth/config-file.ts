/**
 * Persistent machine-local config at the app's configured config path.
 * - Directory mode 0700, file mode 0600.
 * - The host token and machine-specific preferences live here. Remote-device
 *   tokens never touch disk.
 */

import fs from 'node:fs';
import { ensureConfigDir, getConfigPath, getConfigDir } from '@/lib/config/paths';

export interface AuthConfig {
  version: 1;
  localToken: string | null;
  tunnelUrl: string | null;
  onboardedAt: string | null;
  voiceEnabled: boolean | null;
  /** Whether the shipped productivity skill should be installed in the
   *  user-level agent skill directories. Null means the user has not made
   *  an explicit choice yet. */
  globalSkillEnabled: boolean | null;
  /** Last port the server was started on. Written by `start`, read by `pair`
   *  so the CLI shows the right port even when invoked from a different shell. */
  lastPort: number | null;
  /** Stable local hostname fronting the dev server (e.g. `https://flow.localhost`
   *  via portless). Written by `start --portless`, cleared by `start` without it.
   *  When set, `getLocalBaseUrl()` prefers it over `http://localhost:<port>`. */
  staticUrl: string | null;
  /** Opt-in: re-open the app's beamd tunnel at boot (and keep it alive) so
   *  this machine stays reachable across restarts/reboots without a manual
   *  settings click. Null = never chosen (treated as off). See
   *  `src/lib/auth/auto-tunnel.ts`. */
  autoTunnel: boolean | null;
  /** Custom beamd tunnel name (a single DNS label) for THIS machine's app
   *  tunnel. Null = derive it from the app short id. Needed whenever one
   *  beamd account runs the app on more than one machine — the default name
   *  is identical everywhere, so the second machine gets `name_taken`. See
   *  `src/lib/auth/beamd-base-url.ts`. */
  tunnelName: string | null;
  /** Master switch for the agent browser capability. Null = enabled
   *  (batteries-included when a browser is present), false = explicitly off.
   *  See `src/lib/browser/`. */
  browserEnabled: boolean | null;
  /** Absolute path to the Chromium-family binary the agent browser drives.
   *  Null = autodetect (Chrome, Brave, Edge, Chromium). */
  browserChromiumPath: string | null;
  /** Whether unattended runs default to headless. Null = true (headless for
   *  scheduled/trigger runs, headed only for interactive login). */
  browserHeadlessDefault: boolean | null;
  /** Idle milliseconds before an unattended agent browser auto-closes. Null =
   *  default (10 minutes). 0 disables auto-close. */
  browserIdleCloseMs: number | null;
  /** Name of the default agent browser profile. Null = "agent". Letters,
   *  digits, underscore, and hyphen only (it becomes a directory name). */
  browserDefaultProfile: string | null;
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
      globalSkillEnabled: parsed.globalSkillEnabled ?? null,
      lastPort: parsed.lastPort ?? null,
      staticUrl: parsed.staticUrl ?? null,
      autoTunnel: parsed.autoTunnel ?? null,
      tunnelName: parsed.tunnelName ?? null,
      browserEnabled: parsed.browserEnabled ?? null,
      browserChromiumPath: parsed.browserChromiumPath ?? null,
      browserHeadlessDefault: parsed.browserHeadlessDefault ?? null,
      browserIdleCloseMs: parsed.browserIdleCloseMs ?? null,
      browserDefaultProfile: parsed.browserDefaultProfile ?? null,
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
    globalSkillEnabled: pick('globalSkillEnabled'),
    lastPort: pick('lastPort'),
    staticUrl: pick('staticUrl'),
    autoTunnel: pick('autoTunnel'),
    tunnelName: pick('tunnelName'),
    browserEnabled: pick('browserEnabled'),
    browserChromiumPath: pick('browserChromiumPath'),
    browserHeadlessDefault: pick('browserHeadlessDefault'),
    browserIdleCloseMs: pick('browserIdleCloseMs'),
    browserDefaultProfile: pick('browserDefaultProfile'),
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
