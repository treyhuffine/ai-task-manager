import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir, getConfigPath } from '@/lib/config/paths';
import { atomicWriteFile, withFileLock } from '@/lib/config/atomic-file';

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
  if (!fs.existsSync(configDir)) return;
  withFileLock(path.join(configDir, 'integrations-migration'), () => {
    const oldDir = path.join(configDir, 'connectors');
    const dir = path.join(configDir, 'integrations');
    if (fs.existsSync(oldDir)) {
      if (!fs.lstatSync(oldDir).isDirectory()) throw new Error('The old integration store must be a directory. Preserve it and repair the path before starting.');
      if (fs.existsSync(dir)) throw new Error(`Both integration stores exist. Preserve ${oldDir} and ${dir}, and choose one complete store including its encryption key before starting.`);
      fs.renameSync(oldDir, dir);
    }

    const appsFile = path.join(dir, 'auth-configs.json');
    if (fs.existsSync(appsFile)) {
      const apps = JSON.parse(fs.readFileSync(appsFile, 'utf8')) as Array<{ config?: { oauth?: { redirectUri?: string } } }>;
      let changed = false;
      for (const app of apps) {
        const oauth = app.config?.oauth;
        if (typeof oauth?.redirectUri !== 'string') continue;
        const next = migrateIntegrationCallback(oauth.redirectUri);
        if (next !== oauth.redirectUri) { oauth.redirectUri = next; changed = true; }
      }
      if (changed) atomicWriteFile(appsFile, JSON.stringify(apps, null, 2) + '\n');
    }

    const configFile = getConfigPath();
    if (fs.existsSync(configFile)) {
      withFileLock(configFile, () => {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8')) as Record<string, unknown>;
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid local configuration. Preserve it and repair it before starting.');
        if (!Object.hasOwn(config, 'connectorRequestsEnabled')) return;
        if (config.integrationRequestsEnabled == null) config.integrationRequestsEnabled = config.connectorRequestsEnabled;
        delete config.connectorRequestsEnabled;
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
  return path.join(configDir, 'integrations');
}
