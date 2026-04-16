/**
 * Idempotent local-host bootstrap.
 *
 * On first run (or after a reset):
 *   1. Create an api_keys row for the host machine (device_type = 'host').
 *   2. Persist the plaintext token to ~/.<APP_SHORT_ID>/config.json so
 *      `pnpm auth:pair` can reprint the URL on demand.
 *
 * On subsequent runs: if the config file's token matches an existing DB row,
 * do nothing. Otherwise rotate (create a new row + overwrite the config).
 */

import os from 'node:os';
import { readAuthConfig, writeAuthConfig } from '@/lib/auth/config-file';
import { hashToken } from '@/lib/auth/tokens';
import { createApiKey, findApiKeyByHash } from '@/lib/db/queries';

export interface LocalTokenInfo {
  plaintext: string;
  pairingUrl: string;
  created: boolean;
}

export function getLocalBaseUrl(): string {
  const port = process.env.PORT ?? '4224';
  return `http://localhost:${port}`;
}

export function buildPairingUrl(token: string, baseUrl = getLocalBaseUrl()): string {
  return `${baseUrl}/#t=${token}`;
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
