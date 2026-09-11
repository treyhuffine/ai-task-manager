import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConnectorRedirectUri, getMcpOAuthRedirectUrl } from './runtime';
import { PUBLIC_BASE_URL_ENV } from '@/lib/server-runtime/record';

const saved = {
  pub: process.env[PUBLIC_BASE_URL_ENV],
  cfg: process.env.RI_CONFIG_DIR,
  work: process.env.RI_WORK_DIR,
  explicit: process.env.CONNECTORS_REDIRECT_URI,
};
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-oauth-'));
  process.env.RI_CONFIG_DIR = path.join(tmp, '.config'); // no tunnel/static configured
  process.env.RI_WORK_DIR = path.join(tmp, '.work'); // no runtime record
  delete process.env.CONNECTORS_REDIRECT_URI;
});

afterEach(() => {
  for (const [k, v] of Object.entries({
    [PUBLIC_BASE_URL_ENV]: saved.pub,
    RI_CONFIG_DIR: saved.cfg,
    RI_WORK_DIR: saved.work,
    CONNECTORS_REDIRECT_URI: saved.explicit,
  })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('connector OAuth redirect URIs under HTTP/2', () => {
  it('uses the public HTTPS origin, not the private Next port', () => {
    // In the gateway'd server process PORT is the private port; the launcher
    // sets the public origin override. The callback must use the public origin.
    process.env[PUBLIC_BASE_URL_ENV] = 'https://localhost:4224';
    process.env.PORT = '53210'; // private Next port — must NOT appear
    try {
      expect(getConnectorRedirectUri().startsWith('https://localhost:4224/')).toBe(true);
      expect(getConnectorRedirectUri()).not.toContain('53210');
      expect(getMcpOAuthRedirectUrl('srv1')).toBe('https://localhost:4224/api/connectors/mcp-oauth/srv1');
    } finally {
      delete process.env.PORT;
    }
  });
});
