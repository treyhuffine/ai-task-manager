/**
 * Idempotent local-host bootstrap.
 *
 * On first run (or after a reset):
 *   1. Create an api_keys row for the host machine (device_type = 'host').
 *   2. Persist the plaintext token to ~/<APP_SHORT_ID>/config.json so
 *      `pnpm auth:pair` can reprint the URL on demand.
 *
 * On subsequent runs: if the config file's token matches an existing DB row,
 * do nothing. Otherwise rotate (create a new row + overwrite the config).
 */

import os from 'node:os';
import { PAIRING_TOKEN_FRAGMENT_KEY } from '@/constants/app';
import { readAuthConfig, writeAuthConfig } from '@/lib/auth/config-file';
import { hashToken } from '@/lib/auth/tokens';
import { createApiKey, findApiKeyByHash } from '@/lib/db/queries';
import { getRunningPort, setRunningPort } from '@/lib/auth/port';

// Re-exported so existing importers (`@/lib/auth/bootstrap`) keep working.
export { getRunningPort, setRunningPort };

export interface LocalTokenInfo {
  plaintext: string;
  pairingUrl: string;
  created: boolean;
}

/**
 * Stable local hostname fronting the dev server (e.g. `https://flow.localhost`
 * via portless). Persisted in config.json by `start --portless` so out-of-process
 * commands like `pair` reconstruct the same URL.
 */
export function getStaticUrl(): string | null {
  return readAuthConfig()?.staticUrl ?? null;
}

export function setStaticUrl(url: string | null): void {
  writeAuthConfig({ staticUrl: url });
}

export function getLocalBaseUrl(): string {
  return getStaticUrl() ?? `http://localhost:${getRunningPort()}`;
}

/**
 * First non-loopback IPv4 address of this machine, or null if none. Used to
 * build a pair URL that same-network devices (phones on WiFi, etc.) can
 * actually reach — `localhost` in a QR is useless because the scanning
 * device hits its own loopback.
 */
export function getLanIp(): string | null {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

export function getLanBaseUrl(): string | null {
  const ip = getLanIp();
  return ip ? `http://${ip}:${getRunningPort()}` : null;
}

export function buildPairingUrl(token: string, baseUrl = getLocalBaseUrl()): string {
  return `${baseUrl}/#${PAIRING_TOKEN_FRAGMENT_KEY}=${token}`;
}

/**
 * Remote base URL ("tunnel URL") — the hostname external devices hit to reach
 * this host. Stored in ~/<APP_SHORT_ID>/config.json. Optional: when unset,
 * remote pairing has to fall back to localhost + manual token entry.
 */
export function getRemoteBaseUrl(): string | null {
  return readAuthConfig()?.tunnelUrl ?? null;
}

export function setRemoteBaseUrl(raw: string): string {
  const normalized = normalizeBaseUrl(raw);
  writeAuthConfig({ tunnelUrl: normalized });
  return normalized;
}

export function clearRemoteBaseUrl(): void {
  // writeAuthConfig ignores undefined; set explicitly to null.
  writeAuthConfig({ tunnelUrl: null });
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Base URL cannot be empty');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  // Validate.
  const parsed = new URL(withScheme);
  return `${parsed.protocol}//${parsed.host}`;
}

export function ensureLocalToken(): LocalTokenInfo {
  const existing = readAuthConfig();
  if (existing?.localToken) {
    const row = findApiKeyByHash(hashToken(existing.localToken));
    if (row && !row.revoked_at) {
      return {
        plaintext: existing.localToken,
        pairingUrl: buildPairingUrl(existing.localToken),
        created: false,
      };
    }
  }

  const { token } = createApiKey({
    name: `${os.hostname()} (host)`,
    device_type: 'host',
    description: 'Auto-generated local host token',
  });

  writeAuthConfig({ localToken: token.plaintext });

  return {
    plaintext: token.plaintext,
    pairingUrl: buildPairingUrl(token.plaintext),
    created: true,
  };
}
