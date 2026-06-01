/**
 * Multi-service worktree config (§10). A worktree that runs more than one
 * service (a web app + its API, say) declares them in `flow.preview.json` at
 * the worktree root:
 *
 *   {
 *     "services": [
 *       { "name": "web", "command": "pnpm dev:web", "primary": true,
 *         "env": { "NEXT_PUBLIC_API_URL": "{api}" } },
 *       { "name": "api", "command": "pnpm dev:api" }
 *     ]
 *   }
 *
 * Each service gets its own worktree-scoped preview (stable port + DNS name
 * `<worktree>-<service>`). `env` injects *sibling* preview URLs into a
 * service's child env: `{api}` is replaced with the `api` service's resolved
 * URL **for the current reachability mode** — so a web app opened from a
 * phone talks to the API's public (beamd) URL, not `localhost`.
 *
 * The `primary` service is the one the preview pane shows (defaults to the
 * first). When this file is absent, the worktree is single-service and uses
 * the workspace's default `previewCommand` (the common case).
 */

import fs from 'node:fs';
import path from 'node:path';
import { isValidPreviewLabel } from './preview-name';

export const SERVICES_CONFIG_FILENAME = 'flow.preview.json';

export interface WorktreeServiceConfig {
  /** Service name — a DNS label; becomes the `<worktree>-<name>` suffix. */
  name: string;
  /** Dev command for this service. */
  command: string;
  /** The service shown in the preview pane. Defaults to the first service. */
  primary?: boolean;
  /** Sibling URLs to inject: `{ ENV_VAR: "{otherServiceName}" }`. */
  env?: Record<string, string>;
}

/**
 * Read + validate the worktree's service config. Returns null when the file
 * is absent or malformed (→ single-service fallback). Throws nothing.
 */
export function readWorktreeServices(cwd: string): WorktreeServiceConfig[] | null {
  const file = path.join(cwd, SERVICES_CONFIG_FILENAME);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // no config → single-service
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[preview] ${SERVICES_CONFIG_FILENAME} is not valid JSON; ignoring.`);
    return null;
  }
  const services = (parsed as { services?: unknown })?.services;
  if (!Array.isArray(services)) return null;

  const seen = new Set<string>();
  const out: WorktreeServiceConfig[] = [];
  for (const s of services) {
    if (!s || typeof s !== 'object') continue;
    const rec = s as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    const command = typeof rec.command === 'string' ? rec.command.trim() : '';
    if (!name || !command) continue;
    if (!isValidPreviewLabel(name)) {
      console.warn(`[preview] service name "${name}" is not a valid DNS label; skipping.`);
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    const env =
      rec.env && typeof rec.env === 'object' && !Array.isArray(rec.env)
        ? Object.fromEntries(
            Object.entries(rec.env as Record<string, unknown>).filter(
              ([, v]) => typeof v === 'string',
            ) as [string, string][],
          )
        : undefined;
    out.push({ name, command, primary: rec.primary === true, env });
  }
  if (out.length === 0) return null;
  return out;
}

/** The service the pane shows: the one marked primary, else the first. */
export function primaryService(services: WorktreeServiceConfig[]): WorktreeServiceConfig {
  return services.find((s) => s.primary) ?? services[0];
}

/**
 * Substitute `{serviceName}` placeholders in a service's env block with the
 * resolved sibling URLs. Unknown placeholders are left untouched (and warned).
 */
export function injectSiblingEnv(
  env: Record<string, string> | undefined,
  siblingUrls: Map<string, string>,
): Record<string, string> {
  if (!env) return {};
  const out: Record<string, string> = {};
  for (const [key, template] of Object.entries(env)) {
    out[key] = template.replace(/\{([a-z0-9-]+)\}/gi, (match, svc: string) => {
      const url = siblingUrls.get(svc);
      if (!url) {
        console.warn(`[preview] env ${key} references unknown service "${svc}"`);
        return match;
      }
      return url;
    });
  }
  return out;
}
