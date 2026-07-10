import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resetDb } from '@/lib/db';
import { updateUserState } from '@/lib/db/queries';
import { GET } from './route';

/**
 * Focused (note/task) chats seed model + effort from the user's saved defaults
 * the same way orchestrator chats do — a per-entity new chat should start with
 * the last selection, not reset to Default/Effort. Real throwaway DB; migration
 * cost is paid in the hook so cold-start doesn't flake the first test.
 */

const TEST_DB = path.join(os.tmpdir(), `flow-doc-seed-test-${process.pid}.db`);
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

function wipe() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

beforeEach(() => {
  wipe();
  process.env.FLOW_DB_PATH = TEST_DB;
  resetDb();
});

afterAll(wipe);

describe('GET /api/document-chat — seeds model + effort from defaults', () => {
  it('a fresh focused chat inherits defaultAgentModel + defaultAgentEffort', async () => {
    updateUserState({
      defaultAgentHarness: 'claude',
      defaultAgentModel: 'sonnet',
      defaultAgentEffort: 'medium',
    });

    const req = new Request('http://test/api/document-chat?entityType=task&entityId=task_seed_1');
    const { session } = await (await GET(req)).json();
    expect(session.surfaceKind).toBe('task');
    expect(session.model).toBe('sonnet');
    expect(session.effort).toBe('medium');
  });

  it('null defaults resolve to an explicit provider tuple', async () => {
    const req = new Request('http://test/api/document-chat?entityType=note&entityId=note_seed_1');
    const { session } = await (await GET(req)).json();
    expect(session.model).toBe('opus');
    expect(session.effort).toBe('medium');
  });
});
