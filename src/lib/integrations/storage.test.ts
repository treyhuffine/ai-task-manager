import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aesGcmSecretBox, generateSecretKey } from '@integrations/engine/crypto';
import { CONFIG_DIR_ENV } from '@/lib/config/paths';
import { getIntegrationsDir, migrateIntegrationCallback, migrateIntegrationStorage } from './storage';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-storage-'));
  vi.stubEnv(CONFIG_DIR_ENV, dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('integration storage conversion', () => {
  it('moves the complete encrypted store, preserving decryption and disabled settings on retry', async () => {
    const oldDir = path.join(dir, 'connectors');
    fs.mkdirSync(oldDir, { mode: 0o700 });
    const key = generateSecretKey();
    const sealed = await aesGcmSecretBox({ key }).seal({ accessToken: 'saved-token' });
    fs.writeFileSync(path.join(oldDir, 'key'), key, { mode: 0o600 });
    fs.writeFileSync(path.join(oldDir, 'connections.json'), JSON.stringify(sealed), { mode: 0o600 });
    fs.writeFileSync(path.join(oldDir, 'auth-configs.json'), JSON.stringify([
      { config: { oauth: { redirectUri: 'https://home.example/api/connectors/callback?app=1' } }, sealedSecret: sealed },
      { config: { oauth: { redirectUri: 'https://relay.example/oauth/callback' } } },
    ]));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: 1, connectorRequestsEnabled: false, localToken: 'keep-token', unknownSetting: 7 }));

    const next = getIntegrationsDir();
    migrateIntegrationStorage();
    expect(next).toBe(path.join(dir, 'integrations'));
    expect(fs.existsSync(oldDir)).toBe(false);
    const savedKey = fs.readFileSync(path.join(next, 'key'), 'utf8');
    expect(savedKey).toBe(key);
    expect(await aesGcmSecretBox({ key: savedKey }).open(JSON.parse(fs.readFileSync(path.join(next, 'connections.json'), 'utf8')))).toEqual({ accessToken: 'saved-token' });
    const apps = JSON.parse(fs.readFileSync(path.join(next, 'auth-configs.json'), 'utf8'));
    expect(apps[0].config.oauth.redirectUri).toBe('https://home.example/api/integrations/callback?app=1');
    expect(apps[0].sealedSecret).toEqual(sealed);
    expect(apps[1].config.oauth.redirectUri).toBe('https://relay.example/oauth/callback');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))).toEqual({ version: 1, integrationRequestsEnabled: false, localToken: 'keep-token', unknownSetting: 7 });
    expect(fs.statSync(path.join(next, 'key')).mode & 0o777).toBe(0o600);
  });

  it('refuses to merge stores or create a replacement key when both names exist', () => {
    for (const name of ['connectors', 'integrations']) {
      fs.mkdirSync(path.join(dir, name));
      fs.writeFileSync(path.join(dir, name, 'key'), name);
    }
    expect(() => getIntegrationsDir()).toThrow('Both integration stores exist');
    expect(fs.readFileSync(path.join(dir, 'connectors', 'key'), 'utf8')).toBe('connectors');
    expect(fs.readFileSync(path.join(dir, 'integrations', 'key'), 'utf8')).toBe('integrations');
  });

  it('keeps an explicit new preference when removing the old field', () => {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ integrationRequestsEnabled: false, connectorRequestsEnabled: true }));
    migrateIntegrationStorage();
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))).toEqual({ integrationRequestsEnabled: false });
  });

  it('preserves a disabled choice when another config writer initialized the new field to null', () => {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ integrationRequestsEnabled: null, connectorRequestsEnabled: false }));
    migrateIntegrationStorage();
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))).toEqual({ integrationRequestsEnabled: false });
  });

  it('handles a fresh home without creating a key', () => {
    expect(getIntegrationsDir()).toBe(path.join(dir, 'integrations'));
    expect(fs.existsSync(path.join(dir, 'integrations'))).toBe(false);
  });

  it('only rewrites exact former callback paths', () => {
    expect(migrateIntegrationCallback('https://home.example/api/connectors/mcp-oauth/builtin_twitter')).toBe('https://home.example/api/integrations/mcp-oauth/builtin_twitter');
    for (const uri of ['not a URL', 'https://home.example/api/connectors/callback/extra', 'https://relay.example/oauth/callback']) expect(migrateIntegrationCallback(uri)).toBe(uri);
  });
});
