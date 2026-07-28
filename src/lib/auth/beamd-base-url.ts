/**
 * The app's own beamd tunnel — the URL remote devices use to reach this host.
 *
 * The tunnel name is a single DNS label and is **globally unique per beamd
 * edge**, so the default (derived from the app short id) collides the moment
 * one account runs the app on two machines: the second `open` comes back
 * `name_taken`. That's why the name is overridable, in precedence order:
 *
 *   1. `FLOW_TUNNEL_NAME` env  — headless boxes, docker, CI.
 *   2. `tunnelName` in config.json — the Advanced field in settings.
 *   3. `<app-short-id>` (`-dev` in development) — the default.
 *
 * An override that isn't a valid DNS label is ignored rather than mangled:
 * beamd would reject it at open time, and a silently rewritten hostname is
 * worse than falling back to a name the user can see.
 */

import { APP_SHORT_ID } from '@/constants/app';
import { getTunnelName, setRemoteBaseUrl } from '@/lib/auth/bootstrap';
import { beamdCheck, beamdOpen } from '@/lib/preview/beamd/cli';
import { isValidPreviewLabel, previewName } from '@/lib/preview/preview-name';

export interface BeamdBaseUrlResult {
  url: string;
  name: string;
  port: number;
}

/** Env override, checked before config.json. */
export const TUNNEL_NAME_ENV = 'FLOW_TUNNEL_NAME';

/** The name used when nothing is overridden — stable per install + env. */
export function defaultBeamdTunnelName(env = process.env.NODE_ENV): string {
  return previewName(env === 'development' ? `${APP_SHORT_ID}-dev` : APP_SHORT_ID);
}

/**
 * Trim + lowercase a user-supplied name. Deliberately does NOT rewrite
 * invalid characters — validation is the caller's job via
 * {@link isValidPreviewLabel} so a typo surfaces as an error, not as a
 * different hostname than the one the user typed.
 */
export function normalizeTunnelName(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Resolve a stored/env override against the default. Pure — the testable core. */
export function resolveBeamdTunnelName(
  custom: string | null | undefined,
  env = process.env.NODE_ENV,
): string {
  const cleaned = normalizeTunnelName(custom ?? '');
  if (cleaned && isValidPreviewLabel(cleaned)) return cleaned;
  return defaultBeamdTunnelName(env);
}

/** The override actually configured on this machine (env wins), or null. */
export function customBeamdTunnelName(): string | null {
  const fromEnv = normalizeTunnelName(process.env[TUNNEL_NAME_ENV] ?? '');
  if (fromEnv) return fromEnv;
  return getTunnelName();
}

/** True when the effective name comes from the env var (settings can't change it). */
export function tunnelNameIsEnvLocked(): boolean {
  return normalizeTunnelName(process.env[TUNNEL_NAME_ENV] ?? '').length > 0;
}

/** The name this machine's app tunnel opens under, right now. */
export function appBeamdTunnelName(env = process.env.NODE_ENV): string {
  return resolveBeamdTunnelName(customBeamdTunnelName(), env);
}

/**
 * Open (or re-open — beamd is idempotent per name) the app tunnel and persist
 * the returned URL as the remote base URL. `opts.name` overrides the resolved
 * name, which lets a rename open under the new label *before* anything is
 * persisted, so a failed rename leaves no half-applied state.
 */
export async function openAndSaveBeamdBaseUrl(
  port: number,
  opts: { name?: string } = {},
): Promise<BeamdBaseUrlResult> {
  const name = opts.name ?? appBeamdTunnelName();
  await beamdCheck();
  const opened = await beamdOpen(port, name);
  const url = setRemoteBaseUrl(opened.url);
  return { url, name, port };
}
