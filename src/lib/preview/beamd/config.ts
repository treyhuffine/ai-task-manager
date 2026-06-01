/**
 * beamd client config — the dedicated `--config` file Flow passes to every
 * beamd invocation.
 *
 * This is the **automation path**: it bypasses beamd's interactive profile
 * store (`~/.beamd/`) entirely, so Flow keeps its own `{server, token}` out
 * of the user's `$HOME` and never collides with their own `beamd login`.
 * We also pin a Flow-specific `agent_socket` so Flow's detached tunnel agent
 * is isolated from any interactive beamd agent the user runs.
 *
 *   beamd <cmd> --config <getBeamdConfigPath()>
 *
 * See the beamd repo's `docs/consuming-beamd.md` §2.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ensureAppRoot, getAppRoot } from '@/lib/config/paths';

export interface BeamdClientConfig {
  server: string;
  token: string;
  /** Skip edge TLS verification — only for a self-hosted self-signed edge.
   *  Propagated to the agent via BEAMD_INSECURE (beamd 0.0.2+). */
  insecureSkipVerify?: boolean;
}

/** `<app-root>/beamd.yaml` — the dedicated client config we pass via --config. */
export function getBeamdConfigPath(): string {
  return path.join(getAppRoot(), 'beamd.yaml');
}

/**
 * Flow's isolated detached-agent socket. Kept at the app root (short path —
 * Unix socket paths cap around 104 bytes) so Flow's tunnel agent never
 * shares a socket with the user's interactive beamd agent.
 */
export function getBeamdAgentSocketPath(): string {
  return path.join(getAppRoot(), 'beamd-agent.sock');
}

export function beamdConfigExists(): boolean {
  return fs.existsSync(getBeamdConfigPath());
}

/** Minimal YAML scalar quoting — double-quoted with the two escapes yaml.v3 needs. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Write the beamd client config (0600). Server + token come from the
 * settings panel; the agent socket is always Flow's isolated one.
 */
export function writeBeamdConfig(config: BeamdClientConfig): void {
  ensureAppRoot();
  const body =
    `# Managed by Flow — the beamd automation config (passed via --config).\n` +
    `# Do not edit by hand; set the server + token in Flow's preview settings.\n` +
    `server: ${yamlString(config.server)}\n` +
    `token: ${yamlString(config.token)}\n` +
    `agent_socket: ${yamlString(getBeamdAgentSocketPath())}\n` +
    (config.insecureSkipVerify ? `insecure_skip_verify: true\n` : '');
  const p = getBeamdConfigPath();
  fs.writeFileSync(p, body, { mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    // Best-effort on platforms without POSIX perms.
  }
}

/** Remove the beamd config (e.g. when the user clears the server/token). */
export function clearBeamdConfig(): void {
  try {
    fs.unlinkSync(getBeamdConfigPath());
  } catch {
    // Already gone — fine.
  }
}

/**
 * Best-effort read of the configured server for display in settings (we
 * never read the token back out to the client). Parses the simple
 * `key: "value"` lines we write — no YAML dependency needed.
 */
export function readBeamdServer(): string | null {
  try {
    const raw = fs.readFileSync(getBeamdConfigPath(), 'utf8');
    const match = raw.match(/^server:\s*(.+)$/m);
    if (!match) return null;
    return unquoteYaml(match[1].trim());
  } catch {
    return null;
  }
}

/** Whether the config opts out of edge TLS verification (self-signed edges). */
export function readBeamdInsecure(): boolean {
  try {
    const raw = fs.readFileSync(getBeamdConfigPath(), 'utf8');
    return /^insecure_skip_verify:\s*true\s*$/m.test(raw);
  } catch {
    return false;
  }
}

function unquoteYaml(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
}
