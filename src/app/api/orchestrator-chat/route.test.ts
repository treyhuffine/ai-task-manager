import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resetDb } from '@/lib/db';
import { updateUserState } from '@/lib/db/queries';
import { GET } from './route';

/**
 * New orchestrator chats seed their model + effort from the user's saved
 * defaults (`user_state.defaultAgentModel` / `defaultAgentEffort`), which the
 * composer writes on every pick. This is what makes a selection "stick" across
 * new chats instead of snapping back to Default/Effort. Runs against a real
 * throwaway DB so the schema column, the seeding read, and persistence are all
 * exercised together. The first `resetDb()` pays the full migration cost — kept
 * in the hook (with generous timeouts) so cold-start under parallel workers
 * doesn't flake the first test body.
 */

const TEST_DB = path.join(os.tmpdir(), `flow-orch-seed-test-${process.pid}.db`);
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

describe('GET /api/orchestrator-chat — seeds model + effort from defaults', () => {
  it('a fresh chat inherits defaultAgentModel + defaultAgentEffort', async () => {
    updateUserState({ defaultAgentModel: 'opus', defaultAgentEffort: 'high' });

    const { session } = await (await GET()).json();
    expect(session.model).toBe('opus');
    expect(session.effort).toBe('high');
  });

  it('null defaults → null model + effort (use the harness default)', async () => {
    const { session } = await (await GET()).json();
    expect(session.model).toBeNull();
    expect(session.effort).toBeNull();
  });

  it('defaults only seed NEW chats — an existing active chat is returned untouched', async () => {
    // First GET creates the chat with the defaults at that moment (null).
    const first = await (await GET()).json();
    expect(first.session.effort).toBeNull();

    // Changing the default later must not reach back into the live chat —
    // its per-session effort is the source of truth once created.
    updateUserState({ defaultAgentEffort: 'max' });
    const second = await (await GET()).json();
    expect(second.session.id).toBe(first.session.id);
    expect(second.session.effort).toBeNull();
  });
});
