import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { feedFile, releasePolicy, releasePolicyFile, releasePreferences, updateReleasePreferences } from './release-trust';
import { MaintenanceWindowSchema, UpdateActionSchema, UpdatePreferencesSchema } from './update-settings';

let root: string;
let file: string;
const publisher = { format: 1, feed: 'https://publisher.example/feed/', publicKey: 'publisher public key' };
const preferences = { channel: 'stable', auto: true, metered: false };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-update-settings-'));
  vi.stubEnv('RI_ROOT', path.join(root, 'home'));
  vi.stubEnv('RI_INSTALL_ROOT', path.join(root, 'installed'));
  file = releasePolicyFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(publisher));
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

it('keeps a person\'s choices apart from what the release ships', () => {
  expect(updateReleasePreferences({ metered: true })).toEqual({ ...preferences, metered: true });
  expect(updateReleasePreferences({ auto: false })).toEqual({ ...preferences, auto: false, metered: true });
  expect(updateReleasePreferences({ channel: 'latest' })).toEqual({ channel: 'latest', auto: false, metered: true });
  expect(releasePolicy()).toEqual({ ...publisher, channel: 'latest', auto: false, metered: true });
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(publisher);
  expect(releasePreferences()).not.toHaveProperty('feed');
  expect(releasePreferences()).not.toHaveProperty('publicKey');
});

it.each([{ feed: 'https://attacker.example' }, { publicKey: 'attacker' }, { channel: 'beta' }, { auto: true, url: 'https://attacker.example' }, { auto: 'true' }, {}, { metered: 'yes' }])('refuses renderer-controlled policy mutation %j', input => {
  expect(() => updateReleasePreferences(input)).toThrow();
  expect(releasePolicy()).toEqual({ ...publisher, ...preferences });
});

it('cannot create publisher configuration through preference controls', () => {
  fs.unlinkSync(file);
  expect(releasePolicy()).toBeNull();
  updateReleasePreferences({ metered: true });
  expect(releasePolicy()).toBeNull();
  expect(fs.existsSync(file)).toBe(false);
});

it('finds each file in the feed by name and platform', () => {
  expect(feedFile({ feed: 'https://publisher.example/feed' }, 'stable', 'darwin', 'arm64')).toBe('https://publisher.example/feed/stable-darwin-arm64.json');
  expect(feedFile({ feed: 'https://publisher.example/feed/' }, '0.2.0', 'linux', 'x64')).toBe('https://publisher.example/feed/0.2.0-linux-x64.json');
});

it('refuses malformed disk policy instead of treating strings as enabled booleans', () => {
  fs.writeFileSync(file, JSON.stringify({ ...publisher, feed: 'not a url' }));
  expect(() => releasePolicy()).toThrow();
});

it('normalizes valid time zones and keeps the allowed action surface narrow', () => {
  expect(MaintenanceWindowSchema.parse({ hour: 23, durationHours: 3, timeZone: ' UTC ' })).toEqual({ hour: 23, durationHours: 3, timeZone: 'UTC' });
  expect(UpdateActionSchema.parse({ action: 'when-idle', window: { hour: 3, durationHours: 2, timeZone: 'America/Denver' } }).window?.hour).toBe(3);
  expect(UpdatePreferencesSchema.parse({ auto: false, metered: true })).toEqual({ auto: false, metered: true });
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
