import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_DIR_ENV } from '@/lib/config/paths';
import {
  clearCursorApiKey,
  cursorCredentialStatus,
  openCursorApiKey,
  setCursorApiKey,
} from './credentials';

describe('Cursor credential store', () => {
  let directory: string;
  let previousConfig: string | undefined;
  let previousCursorKey: string | undefined;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-cursor-credentials-'));
    previousConfig = process.env[CONFIG_DIR_ENV];
    previousCursorKey = process.env.CURSOR_API_KEY;
    process.env[CONFIG_DIR_ENV] = directory;
    delete process.env.CURSOR_API_KEY;
  });

  afterEach(() => {
    if (previousConfig === undefined) delete process.env[CONFIG_DIR_ENV];
    else process.env[CONFIG_DIR_ENV] = previousConfig;
    if (previousCursorKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = previousCursorKey;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('seals the key on disk and only opens it at the process boundary', async () => {
    await setCursorApiKey('cursor-secret-value');

    expect(cursorCredentialStatus()).toMatchObject({ configured: true, source: 'flow_store' });
    expect(await openCursorApiKey()).toBe('cursor-secret-value');

    const store = path.join(directory, 'agents', 'credentials.json');
    const key = path.join(directory, 'agents', 'key');
    expect(fs.readFileSync(store, 'utf8')).not.toContain('cursor-secret-value');
    expect(fs.statSync(store).mode & 0o777).toBe(0o600);
    expect(fs.statSync(key).mode & 0o777).toBe(0o600);
  });

  it('falls back to the environment after the stored key is removed', async () => {
    await setCursorApiKey('stored-key');
    process.env.CURSOR_API_KEY = 'environment-key';
    expect(clearCursorApiKey()).toMatchObject({ configured: true, source: 'environment' });
    expect(await openCursorApiKey()).toBe('environment-key');
  });
});
