/**
 * Resolved browser settings, read from the machine-local AuthConfig.
 *
 * Batteries-included defaults: the capability is on when a browser is present
 * unless the user explicitly disabled it, and unattended runs are headless
 * unless configured otherwise. Only the master switch and the chosen binary
 * are user-facing knobs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readAuthConfig } from '@/lib/auth/config-file';
import { getBrowserProfilesDir } from '@/lib/config/paths';
import { ActionError } from '@/lib/orchestrator/types';
import { detectBrowsers, resolveChromium, type DetectedBrowser } from './chromium';

/** The built-in fallback profile name, used when none is configured. */
export const DEFAULT_PROFILE = 'agent';

// Profile names become directory names, so keep them path-safe.
const PROFILE_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** The configured default profile name, or "agent". Invalid config is ignored. */
export function getDefaultProfile(): string {
  const configured = readAuthConfig()?.browserDefaultProfile;
  return configured && PROFILE_RE.test(configured) ? configured : DEFAULT_PROFILE;
}

/**
 * Resolve the profile to use: the given name, else the configured default.
 * Validates it is a safe directory name (no traversal), throwing otherwise.
 */
export function resolveProfile(name?: string | null): string {
  const profile = name ?? getDefaultProfile();
  if (!PROFILE_RE.test(profile)) {
    throw new ActionError(
      'invalid_params',
      `Invalid profile name "${profile}". Use letters, digits, underscore, or hyphen (max 64).`,
    );
  }
  return profile;
}

/** Whether the agent browser capability is enabled. Null config = enabled. */
export function isBrowserEnabled(): boolean {
  return readAuthConfig()?.browserEnabled !== false;
}

/** Explicit Chromium path from config, if the user pinned one. */
export function getConfiguredChromiumPath(): string | null {
  return readAuthConfig()?.browserChromiumPath ?? null;
}

/** Unattended default. Null config = headless. */
export function getHeadlessDefault(): boolean {
  return readAuthConfig()?.browserHeadlessDefault !== false;
}

const DEFAULT_IDLE_CLOSE_MS = 10 * 60_000;

/** Idle ms before an agent browser auto-closes. Null config = 10 min. 0 disables. */
export function getIdleCloseMs(): number {
  const configured = readAuthConfig()?.browserIdleCloseMs;
  if (configured === null || configured === undefined) return DEFAULT_IDLE_CLOSE_MS;
  return configured;
}

/**
 * The browser the agent will drive, or throw a clear ActionError telling the
 * caller what to do. Used at the edge of every action so failures are legible.
 */
export function requireBrowser(): DetectedBrowser {
  if (!isBrowserEnabled()) {
    throw new ActionError(
      'unsupported',
      'The agent browser is disabled.',
      'Enable it in Settings or with `flow browser` config.',
    );
  }
  const resolved = resolveChromium(getConfiguredChromiumPath());
  if (!resolved) {
    throw new ActionError(
      'unsupported',
      'No Chromium-family browser found (Chrome, Brave, Edge, or Chromium).',
      'Install one and run `flow browser doctor`.',
    );
  }
  return resolved;
}

export interface ProfileInfo {
  name: string;
  path: string;
  isDefault: boolean;
}

/**
 * The agent browser profiles that exist on disk. Each is a separate logged-in
 * identity (its own cookie jar). The `agent` profile is the default. Pass
 * `profile=<name>` to any browser action to use a different one.
 */
export function listBrowserProfiles(): ProfileInfo[] {
  const dir = getBrowserProfilesDir();
  const currentDefault = getDefaultProfile();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, path: path.join(dir, d.name), isDefault: d.name === currentDefault }));
}

/** Snapshot of browser config for status output and the Settings picker. */
export function browserConfigSummary() {
  return {
    enabled: isBrowserEnabled(),
    headlessDefault: getHeadlessDefault(),
    chromiumPath: getConfiguredChromiumPath(),
    defaultProfile: getDefaultProfile(),
    detected: detectBrowsers(),
  };
}
