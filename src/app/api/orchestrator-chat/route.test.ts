import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resetDb } from '@/lib/db';
import { getUserState, updateUserState } from '@/lib/db/queries';
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
    updateUserState({
      defaultAgentHarness: 'claude',
      defaultAgentModel: 'opus',
      defaultAgentEffort: 'high',
    });

    const { session } = await (await GET(new Request('http://localhost/api'))).json();
    expect(session.model).toBe('opus');
    expect(session.effort).toBe('high');
  });

  it('null defaults resolve to an explicit provider tuple', async () => {
    const { session } = await (await GET(new Request('http://localhost/api'))).json();
    expect(session.model).toBe('opus');
    expect(session.effort).toBe('medium');
    expect(getUserState()).toMatchObject({
      defaultAgentHarness: 'claude',
      defaultAgentModel: 'opus',
      defaultAgentEffort: 'medium',
    });
  });

  it('does not send a saved Codex model to the Claude runner', async () => {
    updateUserState({
      defaultAgentHarness: 'claude',
      defaultAgentModel: 'gpt-5.5',
      defaultAgentEffort: 'ultra',
    });

    const { session } = await (await GET(new Request('http://localhost/api'))).json();
    expect(session.model).toBe('opus');
    // Effort resolves against the provider, not the rejected model. `ultra` is
    // Claude's top rung too (it goes out as `--effort ultracode`), so repairing
    // the model must not drag a perfectly valid effort down with it.
    expect(session.effort).toBe('ultra');
  });

  it('defaults only seed NEW chats — an existing active chat is returned untouched', async () => {
    // First GET creates the chat with the explicit defaults at that moment.
    const first = await (await GET(new Request('http://localhost/api'))).json();
    expect(first.session.effort).toBe('medium');

    // Changing the default later must not reach back into the live chat —
    // its per-session effort is the source of truth once created.
    updateUserState({ defaultAgentEffort: 'max' });
    const second = await (await GET(new Request('http://localhost/api'))).json();
    expect(second.session.id).toBe(first.session.id);
    expect(second.session.effort).toBe('medium');
  });
});
