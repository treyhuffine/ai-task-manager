import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demoEnvironment } from './config';
import { assertExistingInstallation, installationEnvironment, localInstallation, readInstallation, saveInstallation } from './installation';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-association-'))); directories.push(dir);
  return dir;
}
it('canonicalizes selected paths and preserves advanced paths only for an explicit association', () => {
  const dir = fixture(); const target = path.join(dir, 'data'); fs.mkdirSync(target); fs.symlinkSync(target, path.join(dir, 'alias'));
  const identity = localInstallation({ root: path.join(dir, 'alias'), database: path.join(dir, "database with 'quotes.db"), config: path.join(dir, 'settings'), work: path.join(dir, 'work') });
  expect(identity.root).toBe(target);
  const environment = demoEnvironment('/repo', { ...installationEnvironment(identity), RI_DB_PATH: '/unrelated' }, 'production');
  expect(environment.RI_DB_PATH).toBe(identity.database);
  expect(environment.RI_CONFIG_DIR).toBe(identity.config);
  expect(environment.RI_WORK_DIR).toBe(identity.work);
  expect(demoEnvironment('/repo', { NODE_ENV: 'test', RI_DESKTOP_DATABASE: identity.database }, 'production').RI_DB_PATH).toBe('');
  expect(demoEnvironment('/repo', { NODE_ENV: 'test', RI_DESKTOP_STATE_DIR: dir }, 'production').RI_DESKTOP_ROOT).toBe(path.join(dir, 'home'));
  expect(demoEnvironment('/repo', { NODE_ENV: 'test', RI_DESKTOP_STATE_DIR: dir, RI_DESKTOP_ROOT: target }, 'production').RI_DESKTOP_ROOT).toBe(target);
});
it('persists only a complete private identity and rejects ambiguous or extra path fields', () => {
  const dir = fixture(); const file = path.join(dir, 'selection.json');
  const identity = localInstallation({ root: dir });
  saveInstallation(file, identity);
  expect(readInstallation(file)).toEqual(identity);
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  expect(() => localInstallation({ root: 'relative' })).toThrow('absolute');
  expect(() => localInstallation({ root: dir, database: dir })).toThrow('separate');
  expect(() => localInstallation({ root: dir, token: 'untrusted' })).toThrow('Unknown');
  fs.writeFileSync(file, JSON.stringify({ format: 2, identity }));
  expect(() => readInstallation(file)).toThrow('unsupported');
});
it('does not create a database or folders while verifying existing installation paths', () => {
  const dir = fixture(); const identity = localInstallation({ root: dir });
  expect(() => assertExistingInstallation(identity)).toThrow();
  expect(fs.readdirSync(dir)).toEqual([]);
  expect(() => assertExistingInstallation(identity, { allowMissingDatabase: true })).toThrow();
  fs.mkdirSync(identity.config); fs.mkdirSync(identity.work);
  expect(() => assertExistingInstallation(identity, { allowMissingDatabase: true })).not.toThrow();
  expect(fs.existsSync(identity.database)).toBe(false);
  expect(() => assertExistingInstallation(identity)).toThrow();
  fs.writeFileSync(identity.database, 'sqlite checked separately');
  expect(() => assertExistingInstallation(identity)).not.toThrow();
});
