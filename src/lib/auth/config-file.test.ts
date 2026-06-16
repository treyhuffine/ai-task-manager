import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_SHORT_ID } from '@/constants/app';
import {
  getAuthConfigDir,
  getAuthConfigPath,
  readAuthConfig,
  writeAuthConfig,
} from './config-file';

const isPosix = process.platform !== 'win32';

let tmpHome: string;
let prevHome: string | undefined;
let prevUserProfile: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-config-test-'));
  prevHome = process.env.HOME;
  prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = prevUserProfile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('path helpers', () => {
  it('getAuthConfigDir is the .config dir under HOME + APP_SHORT_ID', () => {
    expect(getAuthConfigDir()).toBe(path.join(tmpHome, APP_SHORT_ID, '.config'));
  });

  it('getAuthConfigPath is config.json in the .config dir', () => {
    expect(getAuthConfigPath()).toBe(
      path.join(tmpHome, APP_SHORT_ID, '.config', 'config.json'),
    );
  });
});

describe('readAuthConfig', () => {
  it('returns null when the file does not exist', () => {
    expect(readAuthConfig()).toBeNull();
  });

  it('returns null and logs on malformed JSON', () => {
    const dir = getAuthConfigDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getAuthConfigPath(), 'not json');
    expect(readAuthConfig()).toBeNull();
  });

  it('fills in missing fields with nulls', () => {
    const dir = getAuthConfigDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getAuthConfigPath(), JSON.stringify({}));
    expect(readAuthConfig()).toEqual({
      version: 1,
      localToken: null,
      tunnelUrl: null,
      staticUrl: null,
      onboardedAt: null,
      voiceEnabled: null,
      lastPort: null,
    });
  });

  it('reads back what was written', () => {
    writeAuthConfig({ localToken: 'tok-1', tunnelUrl: 'https://tun.example' });
    expect(readAuthConfig()).toEqual({
      version: 1,
      localToken: 'tok-1',
      tunnelUrl: 'https://tun.example',
      staticUrl: null,
      onboardedAt: null,
      voiceEnabled: null,
      lastPort: null,
    });
  });
});

describe('writeAuthConfig', () => {
  it('creates the auth dir and the config file if missing', () => {
    writeAuthConfig({ localToken: 'tok-1' });
    expect(fs.existsSync(getAuthConfigDir())).toBe(true);
    expect(fs.existsSync(getAuthConfigPath())).toBe(true);
  });

  it('merges with existing config (preserves unspecified fields)', () => {
    writeAuthConfig({ localToken: 'tok-1', tunnelUrl: 'https://a' });
    writeAuthConfig({ tunnelUrl: 'https://b' });
    expect(readAuthConfig()).toEqual({
      version: 1,
      localToken: 'tok-1',
      tunnelUrl: 'https://b',
      staticUrl: null,
      onboardedAt: null,
      voiceEnabled: null,
      lastPort: null,
    });
  });

  it('returns the merged config', () => {
    const returned = writeAuthConfig({ localToken: 'tok-1' });
    expect(returned).toEqual({
      version: 1,
      localToken: 'tok-1',
      tunnelUrl: null,
      staticUrl: null,
      onboardedAt: null,
      voiceEnabled: null,
      lastPort: null,
    });
  });

  it.skipIf(!isPosix)('writes dir mode 0700 and file mode 0600', () => {
    writeAuthConfig({ localToken: 'tok-1' });
    const dirMode = fs.statSync(getAuthConfigDir()).mode & 0o777;
    const fileMode = fs.statSync(getAuthConfigPath()).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });
});
