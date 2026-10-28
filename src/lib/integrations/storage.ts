import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir, getConfigPath } from '@/lib/config/paths';
import { atomicWriteFile, withFileLock } from '@/lib/config/atomic-file';
import { aesGcmSecretBox, generateSecretKey } from '@integrations/engine/crypto';
import type { SecretBox } from '@integrations/engine';

/** Convert stored app callbacks once. External relay/proxy callbacks keep their address. */
export function migrateIntegrationCallback(uri: string): string {
  let url: URL;
  try { url = new URL(uri); } catch { return uri; }
  if (!/^\/api\/connectors\/(callback\/?|mcp-oauth\/[^/]+\/?)$/.test(url.pathname)) return uri;
  url.pathname = url.pathname.replace('/api/connectors/', '/api/integrations/');
  return url.href;
}

/**
 * One-time local data conversion, serialized across processes. Move the whole
 * encrypted store, including its key. Never merge two independently keyed stores.
 * A failed/interrupted conversion can be retried without losing the source.
 */
export function migrateIntegrationStorage(): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(/* turbopackIgnore: true */ configDir)) return;
  withFileLock(path.join(/* turbopackIgnore: true */ configDir, 'integrations-migration'), () => {
    const oldDir = path.join(/* turbopackIgnore: true */ configDir, 'connectors');
    const dir = path.join(/* turbopackIgnore: true */ configDir, 'integrations');
    if (fs.existsSync(/* turbopackIgnore: true */ oldDir)) {
      if (!fs.lstatSync(/* turbopackIgnore: true */ oldDir).isDirectory()) throw new Error('The old integration store must be a directory. Preserve it and repair the path before starting.');
      if (fs.existsSync(/* turbopackIgnore: true */ dir)) throw new Error(`Both integration stores exist. Preserve ${oldDir} and ${dir}, and choose one complete store including its encryption key before starting.`);
      fs.renameSync(oldDir, dir);
    }

    const appsFile = path.join(/* turbopackIgnore: true */ dir, 'auth-configs.json');
    if (fs.existsSync(/* turbopackIgnore: true */ appsFile)) {
      const apps = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ appsFile, 'utf8')) as Array<{ config?: { oauth?: { redirectUri?: string } } }>;
      let changed = false;
      for (const app of apps) {
        const oauth = app.config?.oauth;
        if (typeof oauth?.redirectUri !== 'string') continue;
        const next = migrateIntegrationCallback(oauth.redirectUri);
        if (next !== oauth.redirectUri) { oauth.redirectUri = next; changed = true; }
      }
      if (changed) atomicWriteFile(appsFile, JSON.stringify(apps, null, 2) + '\n');
    }

    // The "Agents can ask to connect accounts" switch is retired: agents may always ask, and the
    // card in the chat is the control (docs/connecting-from-chat.md). Drop its stored choice under
    // either name it was saved as.
    const configFile = getConfigPath();
    if (fs.existsSync(/* turbopackIgnore: true */ configFile)) {
      withFileLock(configFile, () => {
        const config = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ configFile, 'utf8')) as Record<string, unknown>;
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid local configuration. Preserve it and repair it before starting.');
        const retired = ['connectorRequestsEnabled', 'integrationRequestsEnabled'].filter((key) => Object.hasOwn(config, key));
        if (retired.length === 0) return;
        for (const key of retired) delete config[key];
        atomicWriteFile(configFile, JSON.stringify(config, null, 2) + '\n');
      });
    }
  });
}

const ready = new Set<string>();

/** Every integration store entry point converts old data before it can create a new key. */
export function getIntegrationsDir(): string {
  const configDir = getConfigDir();
  if (!ready.has(configDir)) {
    migrateIntegrationStorage();
    ready.add(configDir);
  }
  return path.join(/* turbopackIgnore: true */ configDir, 'integrations');
}

/** Best-effort tighten a path's mode (no-op on filesystems/platforms that reject chmod). */
function hardenMode(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode);
  } catch {
    /* best-effort: some filesystems (e.g. mounted volumes) reject chmod */
  }
}

/** Read (or lazily create) the at-rest encryption key. Mode 0600, never synced. */
export function getOrCreateKey(dir: string): string {
  const keyPath = path.join(/* turbopackIgnore: true */ dir, 'key');
  try {
    const existing = fs.readFileSync(/* turbopackIgnore: true */ keyPath, 'utf8').trim();
    if (existing) {
      // Re-harden on every boot: a key file restored from backup or pre-created could be too open.
      hardenMode(dir, 0o700);
      hardenMode(keyPath, 0o600);
      return existing;
    }
  } catch {
    /* fall through to create */
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  hardenMode(dir, 0o700); // mkdir mode is umask-masked; enforce it
  const key = generateSecretKey();
  try {
    // `wx`: two processes creating a brand-new home must not each write a different key.
    fs.writeFileSync(keyPath, key, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const winner = fs.readFileSync(/* turbopackIgnore: true */ keyPath, 'utf8').trim();
    if (!winner) throw new Error(`The integration key at ${keyPath} is empty. Preserve the integration store and repair it before starting.`);
    return winner;
  }
  hardenMode(keyPath, 0o600);
  return key;
}

/**
 * A secret box over the home's integration key, for stores that sit beside the connection store
 * (managed source credentials, connect attempts). Interchangeable with the runtime's: the seal is
 * derived from the same key file.
 */
export function getIntegrationSecretBox(): SecretBox {
  const dir = getIntegrationsDir();
  return aesGcmSecretBox({ key: getOrCreateKey(dir) });
}
