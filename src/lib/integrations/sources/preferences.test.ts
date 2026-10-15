import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newRemoteUserId, newSourceId, PreferencesUnavailableError, preferencesPath, readPreferences, updatePreferences } from './preferences';
import { deleteSourceCredential, openSourceCredential, saveSourceCredential, sourceCredentialRevision } from './source-credentials';
import { EMPTY_PREFERENCES, type SourceEntry } from './types';

let dir: string;
let previous: string | undefined;

beforeEach(() => {
  previous = process.env.RI_CONFIG_DIR;
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-sources-'));
  process.env.RI_CONFIG_DIR = config;
  dir = path.join(config, 'integrations');
  fs.mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  if (previous === undefined) delete process.env.RI_CONFIG_DIR;
  else process.env.RI_CONFIG_DIR = previous;
});

function source(overrides: Partial<SourceEntry> = {}): SourceEntry {
  return { id: 'cmpabcd', kind: 'composio', label: 'Composio', enabled: true, remoteUserId: `ri-${'a'.repeat(32)}`, createdAt: '2026-10-15T00:00:00.000Z', ...overrides };
}

describe('preferences file', () => {
  it('treats a missing file as no saved preferences', () => {
    expect(readPreferences(dir)).toEqual({ status: 'missing', preferences: EMPTY_PREFERENCES });
  });

  it('writes a validated version 1 file and reads it back', () => {
    updatePreferences(prefs => {
      prefs.sources.push(source());
      prefs.preferredSourceId = 'cmpabcd';
      prefs.applicationMethods.gmail = { sourceId: 'cmpabcd' };
      prefs.applicationMethods.google_calendar = { kind: 'direct', providerId: 'google', authConfigId: 'user-google' };
    }, dir);
    const read = readPreferences(dir);
    expect(read.status).toBe('ok');
    expect(read.preferences.preferredSourceId).toBe('cmpabcd');
    expect(read.preferences.applicationMethods.google_calendar).toEqual({ kind: 'direct', providerId: 'google', authConfigId: 'user-google' });
    const text = fs.readFileSync(preferencesPath(dir), 'utf8');
    expect(text).not.toMatch(/apiKey|token|secret/i);
  });

  it('reports a malformed file, keeps direct behavior and never rewrites it', () => {
    fs.writeFileSync(preferencesPath(dir), '{ not json');
    const read = readPreferences(dir);
    expect(read.status).toBe('invalid');
    expect(read.preferences.sources).toEqual([]);
    expect(() => updatePreferences(prefs => { prefs.sources.push(source()); }, dir)).toThrow(PreferencesUnavailableError);
    expect(fs.readFileSync(preferencesPath(dir), 'utf8')).toBe('{ not json');
  });

  it('reports an unsupported version without rewriting it', () => {
    const body = JSON.stringify({ version: 2, sources: [] });
    fs.writeFileSync(preferencesPath(dir), body);
    const read = readPreferences(dir);
    expect(read).toMatchObject({ status: 'unsupported', version: 2 });
    expect(() => updatePreferences(() => {}, dir)).toThrow(/version 2/);
    expect(fs.readFileSync(preferencesPath(dir), 'utf8')).toBe(body);
  });

  it('rejects a method that matches both shapes', () => {
    fs.writeFileSync(preferencesPath(dir), JSON.stringify({
      ...EMPTY_PREFERENCES, applicationMethods: { gmail: { sourceId: 'cmpabcd', kind: 'direct', providerId: 'google' } },
    }));
    expect(readPreferences(dir).status).toBe('invalid');
  });

  it('refuses a change that would leave the file invalid', () => {
    updatePreferences(prefs => { prefs.sources.push(source()); }, dir);
    expect(() => updatePreferences(prefs => { prefs.sources.push(source()); }, dir)).toThrow(/invalid/);
    expect(readPreferences(dir).preferences.sources).toHaveLength(1);
  });

  it('applies concurrent partial changes against the current revision', () => {
    updatePreferences(prefs => { prefs.sources.push(source()); }, dir);
    // Two writers that each change one field: neither loses the other's change.
    updatePreferences(prefs => { prefs.preferredSourceId = 'cmpabcd'; }, dir);
    updatePreferences(prefs => { prefs.applicationMethods.gmail = { kind: 'direct', providerId: 'google' }; }, dir);
    const prefs = readPreferences(dir).preferences;
    expect(prefs.preferredSourceId).toBe('cmpabcd');
    expect(prefs.applicationMethods.gmail).toEqual({ kind: 'direct', providerId: 'google' });
  });

  it('never reuses a current or retired source id', () => {
    const prefs = { ...structuredClone(EMPTY_PREFERENCES), sources: [source()], retiredSourceIds: ['cmpefgh'] };
    for (let i = 0; i < 200; i += 1) {
      const id = newSourceId(prefs);
      expect(id).toMatch(/^cmp[a-z2-7]{4}$/);
      expect(['cmpabcd', 'cmpefgh']).not.toContain(id);
    }
    expect(newRemoteUserId()).toMatch(/^ri-[a-f0-9]{32}$/);
    expect(newRemoteUserId()).not.toBe(newRemoteUserId());
  });
});

describe('source credentials', () => {
  it('seals the key, rotates its revision and deletes it', async () => {
    const first = await saveSourceCredential('cmpabcd', { apiKey: 'ak_test_secret' }, dir);
    const raw = fs.readFileSync(path.join(dir, 'source-credentials.json'), 'utf8');
    expect(raw).not.toContain('ak_test_secret');
    expect(await openSourceCredential('cmpabcd', dir)).toEqual({ apiKey: 'ak_test_secret', revision: first });
    const second = await saveSourceCredential('cmpabcd', { apiKey: 'ak_test_rotated' }, dir);
    expect(second).not.toBe(first);
    expect(sourceCredentialRevision('cmpabcd', dir)).toBe(second);
    deleteSourceCredential('cmpabcd', dir);
    expect(await openSourceCredential('cmpabcd', dir)).toBeNull();
  });
});
