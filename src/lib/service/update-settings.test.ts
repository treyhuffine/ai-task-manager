import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { releasePolicy, releasePreferences, updateReleasePreferences } from './release-trust';
import { MaintenanceWindowSchema, UpdateActionSchema, UpdatePreferencesSchema } from './update-settings';
import { getRuntimeInstallDir } from './paths';

let root: string;
let file: string;
const publisher = { format: 1, feed: 'https://publisher.example/stable.json', publicKey: 'publisher public key', channel: 'stable', automaticDownload: true, metered: false };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-update-settings-'));
  vi.stubEnv('RI_ROOT', path.join(root, 'home'));
  vi.stubEnv('RI_INSTALL_ROOT', path.join(root, 'installed'));
  file = path.join(getRuntimeInstallDir(), 'release-policy.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(publisher));
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

it('persists download preferences without replacing trust anchors or other preferences', () => {
  expect(updateReleasePreferences({ metered: true })).toEqual({ channel: 'stable', automaticDownload: true, metered: true });
  expect(updateReleasePreferences({ automaticDownload: false })).toEqual({ channel: 'stable', automaticDownload: false, metered: true });
  expect(releasePolicy()).toEqual({ ...publisher, automaticDownload: false, metered: true });
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  expect(releasePreferences()).not.toHaveProperty('feed');
  expect(releasePreferences()).not.toHaveProperty('publicKey');
});

it.each([{ feed: 'https://attacker.example' }, { publicKey: 'attacker' }, { channel: 'beta' }, { automaticDownload: true, url: 'https://attacker.example' }, { automaticDownload: 'true' }, {}, { automaticDownload: undefined }])('refuses renderer-controlled policy mutation %j', input => {
  expect(() => updateReleasePreferences(input)).toThrow();
  expect(releasePolicy()).toEqual(publisher);
});

it('cannot create publisher configuration through preference controls', () => {
  fs.unlinkSync(file);
  expect(releasePreferences()).toBeNull();
  expect(() => updateReleasePreferences({ metered: true })).toThrow('no release publisher');
  expect(fs.existsSync(file)).toBe(false);
});

it('refuses malformed disk policy instead of treating strings as enabled booleans', () => {
  fs.writeFileSync(file, JSON.stringify({ ...publisher, automaticDownload: 'false' }));
  expect(() => releasePolicy()).toThrow();
});

it('normalizes valid time zones and keeps the allowed action surface narrow', () => {
  expect(MaintenanceWindowSchema.parse({ hour: 23, durationHours: 3, timeZone: ' UTC ' })).toEqual({ hour: 23, durationHours: 3, timeZone: 'UTC' });
  expect(UpdateActionSchema.parse({ action: 'when-idle', window: { hour: 3, durationHours: 2, timeZone: 'America/Denver' } }).window?.hour).toBe(3);
  expect(UpdatePreferencesSchema.parse({ automaticDownload: false, metered: true })).toEqual({ automaticDownload: false, metered: true });
});

it.each([
  { hour: -1, durationHours: 1, timeZone: 'UTC' }, { hour: 24, durationHours: 1, timeZone: 'UTC' },
  { hour: 3, durationHours: 0, timeZone: 'UTC' }, { hour: 3, durationHours: 13, timeZone: 'UTC' },
  { hour: 3.5, durationHours: 2, timeZone: 'UTC' }, { hour: 3, durationHours: 2, timeZone: 'Invalid/Zone' },
  { hour: 3, durationHours: 2, timeZone: '' },
])('rejects invalid maintenance window %j', window => { expect(() => MaintenanceWindowSchema.parse(window)).toThrow(); });

it.each(['apply', 'download', 'check', 'later'])('rejects a misleading schedule on %s', action => {
  expect(() => UpdateActionSchema.parse({ action, window: { hour: 3, durationHours: 2, timeZone: 'UTC' } })).toThrow('only to Update when idle');
});
