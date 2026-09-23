import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Caller identity (docs/agents-view-spec.md Phase 4). A credential proves a
 * chat session was started by this app: only a process holding the local
 * token can mint one. Everything that isn't a valid credential for an
 * existing chat resolves to no actor.
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-session-credential-'));
const TEST_DB = path.join(ROOT, 'data.db');
const TOKEN = 'tok_credential_test';
const saved = { root: process.env.RI_ROOT, db: process.env.RI_DB_PATH, config: process.env.RI_CONFIG_DIR };

beforeAll(() => {
  process.env.RI_ROOT = ROOT;
  process.env.RI_DB_PATH = TEST_DB;
  process.env.RI_CONFIG_DIR = path.join(ROOT, '.config');
  fs.mkdirSync(process.env.RI_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.RI_CONFIG_DIR, 'config.json'), JSON.stringify({ version: 1, localToken: TOKEN }));
});

afterAll(() => {
  for (const [key, value] of [['RI_ROOT', saved.root], ['RI_DB_PATH', saved.db], ['RI_CONFIG_DIR', saved.config]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(ROOT, { recursive: true, force: true });
});

async function load() {
  return import('./session-credential');
}

describe('sessionCredential / verifySessionCredential', () => {
  it('round-trips a session id under the same token', async () => {
    const { sessionCredential, verifySessionCredential } = await load();
    const credential = sessionCredential('chat-1', 'secret')!;
    expect(credential.startsWith('chat-1.')).toBe(true);
    expect(verifySessionCredential(credential, 'secret')).toBe('chat-1');
  });

  it('rejects a credential minted with another token', async () => {
    const { sessionCredential, verifySessionCredential } = await load();
    expect(verifySessionCredential(sessionCredential('chat-1', 'other-token'), 'secret')).toBeNull();
  });

  it('rejects a signature moved onto another session id', async () => {
    const { sessionCredential, verifySessionCredential } = await load();
    const signature = sessionCredential('chat-1', 'secret')!.split('.').pop();
    expect(verifySessionCredential(`chat-2.${signature}`, 'secret')).toBeNull();
  });

  it('rejects malformed values', async () => {
    const { verifySessionCredential } = await load();
    for (const value of ['', 'chat-1', 'chat-1.', '.sig', 42, null, undefined, { id: 'chat-1' }]) {
      expect(verifySessionCredential(value, 'secret')).toBeNull();
    }
  });

  it('mints and verifies nothing without a token', async () => {
    const { sessionCredential, verifySessionCredential } = await load();
    expect(sessionCredential('chat-1', null)).toBeNull();
    expect(verifySessionCredential(sessionCredential('chat-1', 'secret'), null)).toBeNull();
  });

  it('uses the local token by default', async () => {
    const { sessionCredential, verifySessionCredential } = await load();
    const credential = sessionCredential('chat-1');
    expect(verifySessionCredential(credential, TOKEN)).toBe('chat-1');
    expect(verifySessionCredential(credential)).toBe('chat-1');
  });
});

describe('sessionCredentialFromHeaders', () => {
  it('reads the header from Headers, plain records in any casing, and array values', async () => {
    const { sessionCredentialFromHeaders } = await load();
    expect(sessionCredentialFromHeaders(new Headers({ 'X-Ri-Session': 'a.b' }))).toBe('a.b');
    expect(sessionCredentialFromHeaders({ 'x-ri-session': 'a.b' })).toBe('a.b');
    expect(sessionCredentialFromHeaders({ 'X-RI-SESSION': 'a.b' })).toBe('a.b');
    expect(sessionCredentialFromHeaders({ 'x-ri-session': ['a.b', 'c.d'] })).toBe('a.b');
    expect(sessionCredentialFromHeaders({ authorization: 'Bearer x' })).toBeNull();
    expect(sessionCredentialFromHeaders(undefined)).toBeNull();
  });
});

describe('actorFromSessionCredential', () => {
  it('names an existing chat, with its execution, and nothing for unknown or forged ones', async () => {
    const { getDb, resetDb } = await import('@/lib/db');
    resetDb();
    getDb();
    const q = await import('@/lib/db/queries');
    const ws = q.createWorkspace({ name: 'ri', cwd: ROOT, isGit: false, filesToCopy: [], status: 'active' });
    const { session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Work' });

    const { actorFromSessionCredential, sessionCredential } = await load();
    expect(actorFromSessionCredential(sessionCredential(session.id))).toEqual({
      source: 'ai',
      sessionId: session.id,
      executionId: session.executionId,
    });
    expect(actorFromSessionCredential(sessionCredential('no-such-chat'))).toBeUndefined();
    expect(actorFromSessionCredential(`${session.id}.forged`)).toBeUndefined();
    expect(actorFromSessionCredential(session.id)).toBeUndefined();
    expect(actorFromSessionCredential(undefined)).toBeUndefined();
  });
});
